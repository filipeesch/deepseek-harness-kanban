import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { BoardStore } from '../domain/store.js';
import { canTransition } from '../domain/workflow.js';
import { QuestionIndex } from '../questions/indexer.js';
import type { BoardSettings, BoardSnapshot, BoardState, Command, PendingTransition, Project, ProjectInput, QuestionRound, Task, Attention } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import type { GitPort, SessionPort, WorkspacePort } from '../shared/ports.js';
import type { QuestionStore } from './question-storage.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import { WorktreeCoordinator } from './worktrees.js';
import { isAbsolutePath } from '../domain/validation.js';
import { taskTitleSlug, worktreePathForBranch } from '../shared/worktree-name.js';

async function pathExists(value:string):Promise<boolean>{try{await lstat(value);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function isEvent(value:unknown):value is {type:string;seq:number;data:unknown}{return Boolean(value&&typeof value==='object'&&'type'in value&&typeof value.type==='string'&&'seq'in value&&typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&'data'in value);}
function userPromptTime(event:unknown):number|undefined{
 if(!isEvent(event)||event.type!=='user/message')return undefined;
 const source=(event.data as {source?:{kind?:unknown}}|null)?.source;
 if(source?.kind!=='user')return undefined;
 const time=(event as {time?:unknown}).time;
 return typeof time==='number'&&Number.isFinite(time)?time:Date.now();
}
export interface AppOptions { history?: (sessionId:string)=>Promise<readonly unknown[]>; signal?:AbortSignal; report?:(error:unknown)=>void; questionStore?:QuestionStore }
/** Coordinates domain commands while the host continues to own sessions and execution. */
export class KanbanApp {
 readonly questions=new QuestionIndex();
 readonly worktrees:WorktreeCoordinator;
 private readonly listeners=new Set<()=>void>();
 private readonly prepared=new Map<string,Promise<void>>();
 private readonly attention=new Map<string,Promise<Attention>>();
 private readonly disposers:Array<()=>void>=[];
 private sequence=0; private disposed=false; private driving=false; private driveAgain=false; private drivePromise:Promise<void>|undefined; private commandTail:Promise<void>=Promise.resolve();
 private activityTimer:ReturnType<typeof setTimeout>|undefined;
 private readonly saveTimers=new Map<string,ReturnType<typeof setTimeout>>();
 constructor(readonly store:BoardStore,readonly sessions:SessionPort,readonly git:GitPort,private readonly options:AppOptions={},private readonly workspaces?:WorkspacePort){
  this.worktrees=new WorktreeCoordinator(store,sessions,git,{signal:options.signal,onTaskDeleted:async task=>{try{await this.cleanupWorktreeWorkspace(task);}catch(error){this.options.report?.(error);}}});
  this.disposers.push(store.subscribe(()=>{this.changed();void this.dispatchPending().catch(error=>options.report?.(error));}));
  this.disposers.push(this.questions.subscribe(()=>this.changed()));
 }
 private changed():void{if(this.disposed)return;this.sequence++;for(const listener of this.listeners){try{listener();}catch(error){this.options.report?.(error);}}}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 async initialize():Promise<void>{
  await this.reconcileWorkspaces();
  const state=this.store.snapshot();
  await Promise.allSettled([...new Set(state.tasks.flatMap(t=>t.sessionIds))].map(id=>this.prepareQuestions(id)));
  await this.reconcileInstructionPending();
  for(const task of state.tasks){if(task.pendingTransition?.status==='sending')await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.status==='sending'){t.pendingTransition.status='failed';t.pendingTransition.error={code:'DELIVERY_UNCERTAIN',message:'A prior prompt admission was interrupted. Retry explicitly; the same native request identity will be reused.'};}});}
  for(const task of this.store.snapshot().tasks){const p=task.pendingTransition;if(p?.status==='waiting'&&p.worktreeRequest&&!task.operation&&task.worktree?.status!=='ready'){try{await this.worktrees.request(task.id,{kind:'create',...p.worktreeRequest});}catch(error){await this.failPending(task.id,p.id,error);}}}
  await this.worktrees.resumePending();await this.dispatchPending();
 }
 async prepareQuestions(sessionId:string):Promise<void>{
  if(this.prepared.has(sessionId))return this.prepared.get(sessionId);
  const work=(async()=>{
   const record=this.options.questionStore?.load(sessionId);
   if(record!==undefined){try{this.questions.restoreSession(record);}catch(error){this.options.report?.(error);}}
   if(this.options.history){for(const event of await this.options.history(sessionId))if(isEvent(event))this.questions.apply(sessionId,event);}
   this.schedulePersist(sessionId);
  })();
  this.prepared.set(sessionId,work);
  try{await work;}catch(error){this.prepared.delete(sessionId);throw error;}
 }
 private schedulePersist(sessionId:string):void{
  const store=this.options.questionStore;if(!store||this.disposed)return;
  const existing=this.saveTimers.get(sessionId);if(existing!==undefined)clearTimeout(existing);
  this.saveTimers.set(sessionId,setTimeout(()=>{this.saveTimers.delete(sessionId);void this.persistSession(sessionId);},250));
 }
 private async persistSession(sessionId:string):Promise<void>{
  const store=this.options.questionStore;if(!store)return;
  const record=this.questions.serializeSession(sessionId);if(record===undefined)return;
  try{await store.save(sessionId,record);}catch(error){this.options.report?.(error);}
 }
 /** Dismissal must be durable before the host reports success. */
 private async persistSessionStrict(sessionId:string):Promise<void>{
  const store=this.options.questionStore;if(!store)return;
  const record=this.questions.serializeSession(sessionId);if(record===undefined)return;
  await store.save(sessionId,record);
 }
 private async flushQuestions():Promise<void>{
  const ids=[...this.saveTimers.keys()];
  for(const timer of this.saveTimers.values())clearTimeout(timer);
  this.saveTimers.clear();
  await Promise.allSettled(ids.map(sessionId=>this.persistSession(sessionId)));
 }
 async rounds(sessionId:string):Promise<QuestionRound[]>{await this.prepareQuestions(sessionId);return structuredClone([...this.questions.getRounds(sessionId)]);}
 async dismissQuestions(sessionId:string,roundId:string):Promise<QuestionRound[]>{
  await this.prepareQuestions(sessionId);
  const rounds=this.questions.getRounds(sessionId);
  const target=rounds.find(round=>round.id===roundId);
  if(!target||target.answered)throw new KanbanError('QUESTION_ROUND_NOT_FOUND','The question round is not available for dismissal.');
  const unresolved=rounds.filter(round=>!round.answered);
  const turns=unresolved.map(round=>Number(round.turnId));
  this.questions.dismiss(sessionId,unresolved.map(round=>round.id));
  const existing=this.saveTimers.get(sessionId);
  if(existing!==undefined){clearTimeout(existing);this.saveTimers.delete(sessionId);}
  try{await this.persistSessionStrict(sessionId);}
  catch(error){
   this.questions.undismiss(sessionId,turns);
   this.schedulePersist(sessionId);
   this.options.report?.(error);
   throw new KanbanError('STORAGE_SAVE_FAILED','The question dismissal could not be saved.');
  }
  return structuredClone([...this.questions.getRounds(sessionId)]);
 }
 private retryActivity():void{
  // Canonical events can precede idle state; expire reads made during the existing debounce and publish a newer sequence.
  if(this.disposed||this.activityTimer!==undefined)return;
  this.activityTimer=setTimeout(()=>{this.activityTimer=undefined;void this.worktrees.resumePending().then(()=>this.dispatchPending()).catch(error=>this.options.report?.(error)).finally(()=>{if(this.disposed)return;this.attention.clear();this.changed();});},50);
 }
 observe(sessionId:string,event:unknown):void{
  if(this.disposed)return;
  const promptTime=userPromptTime(event);if(promptTime!==undefined)this.clearInstructionPending(sessionId,promptTime);
  if(isEvent(event)&&this.questions.apply(sessionId,event))this.schedulePersist(sessionId);this.attention.delete(sessionId);this.changed();this.retryActivity();
 }
 private clearInstructionPending(sessionId:string,time:number):void{
  const task=this.store.snapshot().tasks.find(value=>value.sessionIds.includes(sessionId));const marker=task?.instructionPending;
  if(!task||!marker||marker.columnId!==task.columnId||marker.enteredAt>time)return;
  void this.store.transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);const pending=current?.instructionPending;if(!current||!pending||pending.columnId!==current.columnId||pending.enteredAt>time)return;delete current.instructionPending;}).catch(error=>this.options.report?.(error));
 }
 private async reconcileInstructionPending():Promise<void>{
  if(!this.options.history)return;
  for(const task of this.store.snapshot().tasks){
   const marker=task.instructionPending;if(!marker||marker.columnId!==task.columnId)continue;
   let prompted=false;
   for(const sessionId of task.sessionIds){
    try{const events=await this.options.history(sessionId);if(events.some(event=>{const time=userPromptTime(event);return time!==undefined&&time>=marker.enteredAt;})){prompted=true;break;}}
    catch(error){this.options.report?.(error);}
   }
   if(prompted)await this.store.transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);if(current?.instructionPending?.enteredAt===marker.enteredAt)delete current.instructionPending;});
  }
 }
 activityChanged():void{if(this.disposed)return;this.attention.clear();this.changed();this.retryActivity();}
 async snapshot():Promise<BoardSnapshot>{
  const sequence=this.sequence;const state=this.store.snapshot();const questionRounds=structuredClone([...this.questions.getRounds()]);const attention:Record<string,Attention>={};
  for(const task of state.tasks){const value={...EMPTY_ATTENTION};for(const id of task.sessionIds){if(!this.attention.has(id)){const pending:Promise<Attention>=this.sessions.attention(id).catch(()=>{if(this.attention.get(id)===pending)this.attention.delete(id);return {...EMPTY_ATTENTION,failed:true};});this.attention.set(id,pending);}const item=await this.attention.get(id)!;value.running ||= item.running;value.unread ||= item.unread;value.awaitingReply ||= item.awaitingReply||this.questions.pending(id);value.failed ||= item.failed;}attention[task.id]=value;}
  return {state,attention,sequence,questionRounds};
 }
 async branches(taskId:string):Promise<string[]>{const task=this.store.requireTask(taskId);return this.git.branches(this.store.requireProject(task.projectId),task.sessionIds);}
 async worktreeDefault(taskId:string):Promise<{branchName:string;path:string}>{
  const state=this.store.snapshot();const task=this.store.requireTask(taskId,state);const project=this.store.requireProject(task.projectId,state);const basePath=state.settings?.worktreeBasePath;const slug=taskTitleSlug(task.title);
  const branches=await this.git.branches(project,task.sessionIds);const occupied=new Set<string>();
  for(const other of state.tasks){if(other.worktree?.path)occupied.add(other.worktree.path);for(const entry of other.unclaimedWorktrees??[])occupied.add(entry.path);const attempt=other.operation?.createAttempt;if(attempt?.path)occupied.add(attempt.path);const pending=other.pendingTransition?.worktreeRequest;if(pending?.path)occupied.add(pending.path);}
  for(let index=1;index<=100;index++){
   const branchName=index===1?slug:slug+'-'+index;if(branches.includes(branchName))continue;if(!basePath)return {branchName,path:''};
   const path=worktreePathForBranch(basePath,branchName);if(!path)throw new KanbanError('INVALID_WORKTREE_PATH','The task title cannot be converted into a usable worktree path.');
   if(occupied.has(path)||await pathExists(path))continue;return {branchName,path};
  }
  throw new KanbanError('WORKTREE_NAME_UNAVAILABLE','Could not derive an available worktree name from the task title.');
 }
 async inferProject(path:string):Promise<{projectPath:string;gitRootPath:string}>{return this.git.discover(path);}
 async assertExecutionContext(sessionId:string):Promise<void>{
  const state=this.store.snapshot();const task=state.tasks.find(value=>value.sessionIds.includes(sessionId));if(!task)return;
  const project=this.store.requireProject(task.projectId,state);
  // Returning to base retains the ready binding without keeping that tree active.
  const atBase=task.effectiveCwd===project.projectPath;const root=!atBase&&task.worktree?.status==='ready'?task.worktree.path:undefined;
  invariant(atBase||root!==undefined,'CONTEXT_MISMATCH','The active task directory is neither its configured project nor a ready worktree. Restore the expected context before running.');
  const expected=await this.git.projectDirectory(project,root);
  invariant(expected===task.effectiveCwd,'CONTEXT_MISMATCH','The recorded task directory no longer matches its active project or worktree. Restore the expected context before running.');
  await this.sessions.validateDirectory(sessionId,expected);
  const latestState=this.store.snapshot();const latest=this.store.requireTask(task.id,latestState);const latestProject=this.store.requireProject(latest.projectId,latestState);
  const latestRoot=latest.effectiveCwd!==latestProject.projectPath&&latest.worktree?.status==='ready'?latest.worktree.path:undefined;
  invariant(latest.projectId===project.id&&latestProject.projectPath===project.projectPath&&latestProject.gitRootPath===project.gitRootPath&&latest.sessionIds.includes(sessionId)&&latest.effectiveCwd===expected&&latestRoot===root,'CONTEXT_CHANGED','The task context changed while execution was being validated. Review its directory before retrying.');
 }
 private async settings(input:BoardSettings,expectedRevision?:number):Promise<BoardSettings>{
  invariant(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Settings input must be a mapping.');
  invariant(Object.keys(input).every(key=>key==='worktreeBasePath'),'INVALID_INPUT','Unsupported board setting.');
  const raw=input.worktreeBasePath;if(raw===undefined||(typeof raw==='string'&&!raw.trim()))return this.store.saveSettings({},expectedRevision);
  invariant(typeof raw==='string','INVALID_INPUT','Worktree base path must be text.');const base=raw.trim();invariant(isAbsolutePath(base),'INVALID_INPUT','Worktree base path must be an absolute path.');
  let resolved:string;try{resolved=await realpath(base);}catch{throw new KanbanError('INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.',{path:base});}
  invariant((await stat(resolved)).isDirectory(),'INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.');
  return this.store.saveSettings({worktreeBasePath:resolved},expectedRevision);
 }
 private async project(input:ProjectInput):Promise<ProjectInput>{
  const projectPath=await realpath(input.projectPath);const gitRootPath=await realpath(input.gitRootPath);
  invariant((await stat(projectPath)).isDirectory()&&(await stat(gitRootPath)).isDirectory(),'INVALID_PROJECT_PATH','Project and Git root must be existing directories.');
  const relative=path.relative(gitRootPath,projectPath);
  invariant(relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'INVALID_PROJECT_PATH','Project path must be inside its configured Git root.');
  return {...input,projectPath,gitRootPath};
 }
 private async ensureProjectWorkspace(project:Project):Promise<string|undefined>{
  if(!this.workspaces)return undefined;
  if(project.workspaceId&&this.workspaces.get(project.workspaceId))return project.workspaceId;
  const ensured=await this.workspaces.ensure(project.projectPath,project.name);
  if(project.workspaceId!==ensured.workspace.id||project.workspaceOwned!==ensured.owned)await this.store.setProjectWorkspace(project.id,ensured.workspace.id,ensured.owned);
  return ensured.workspace.id;
 }
 private async ensureWorktreeWorkspace(task:Task,project:Project):Promise<string|undefined>{
  if(!this.workspaces)return undefined;
  if(task.effectiveCwd===project.projectPath)return this.ensureProjectWorkspace(project);
  if(task.worktreeWorkspaceId&&this.workspaces.get(task.worktreeWorkspaceId))return task.worktreeWorkspaceId;
  const title=project.name+' · '+(task.worktree?.branch??path.basename(task.effectiveCwd));
  const ensured=await this.workspaces.ensure(task.effectiveCwd,title);
  if(task.worktreeWorkspaceId!==ensured.workspace.id||task.worktreeWorkspaceOwned!==ensured.owned)await this.store.setTaskWorktreeWorkspace(task.id,ensured.workspace.id,ensured.owned);
  return ensured.workspace.id;
 }
 private async reconcileWorkspaces():Promise<void>{
  if(!this.workspaces)return;
  for(const task of this.store.snapshot().tasks){
   const project=this.store.requireProject(task.projectId);
   try{await this.ensureProjectWorkspace(project);await this.ensureWorktreeWorkspace(task,project);}
   catch(error){this.options.report?.(error);}
   for(const sessionId of task.sessionIds){
    try{
     const directory=await this.sessions.directory(sessionId);
     if(directory!==project.projectPath)await this.workspaces.ensure(directory,project.name+' · '+path.basename(directory));
    }catch(error){this.options.report?.(error);}
   }
  }
 }
 private async cleanupWorktreeWorkspace(task:Task):Promise<void>{
  if(!this.workspaces||!task.worktreeWorkspaceId||!task.worktreeWorkspaceOwned)return;
  const info=this.workspaces.get(task.worktreeWorkspaceId);
  if(!info)return;
  if(info.sessionIds.some(id=>!task.sessionIds.includes(id)))return;
  if(this.store.snapshot().tasks.some(other=>other.id!==task.id&&other.worktreeWorkspaceId===task.worktreeWorkspaceId))return;
  await this.workspaces.delete(task.worktreeWorkspaceId);
 }
 private assertContext(taskId:string):void{const task=this.store.requireTask(taskId);invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the task context operation before admitting another conversation or execution.');}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.commandTail.then(run);this.commandTail=result.then(()=>undefined,()=>undefined);return result;}
 createConversation(taskId:string):Promise<string>{return this.serial(()=>this.createConversationNow(taskId));}
 private async createConversationNow(taskId:string):Promise<string>{
  this.assertContext(taskId);const before=this.store.requireTask(taskId);const project=this.store.requireProject(before.projectId);const workspaceId=await this.ensureWorktreeWorkspace(before,project);const id=await this.sessions.create(project.projectPath,workspaceId);
  try{if(before.effectiveCwd!==project.projectPath)await this.sessions.setDirectory(id,before.effectiveCwd);this.assertContext(taskId);const current=this.store.requireTask(taskId);invariant(current.effectiveCwd===before.effectiveCwd,'CONTEXT_CHANGED','Task directory changed while the conversation was being created.');await this.store.addSession(taskId,id);return id;}
  catch(error){try{await this.sessions.archive(id);}catch(archiveError){this.options.report?.(archiveError);}throw error;}
 }
 createTask(input:{projectId:string;title:string;description:string}){return this.serial(()=>this.createTaskNow(input));}
 private async createTaskNow(input:{projectId:string;title:string;description:string}){
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  const project=this.store.requireProject(input.projectId);const workspaceId=await this.ensureProjectWorkspace(project);const id=await this.sessions.create(project.projectPath,workspaceId);
  try{return await this.store.createTask(input,id);}catch(error){try{await this.sessions.archive(id);}catch(archiveError){this.options.report?.(archiveError);}throw error;}
 }
 saveNote(input:Extract<Command,{type:'note.save'}>){return this.serial(()=>this.saveNoteNow(input));}
 private async saveNoteNow(input:Extract<Command,{type:'note.save'}>){invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');return this.store.saveNote(input.taskId,{id:input.noteId,content:input.content,tags:input.tags});}
 command(command:Command):Promise<BoardSnapshot>{return this.serial(()=>this.execute(command));}
 private async execute(command:Command):Promise<BoardSnapshot>{
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  let commandReceipt:BoardSnapshot['commandReceipt'];
  switch(command.type){
   case 'project.save':{const value=await this.store.saveProject(await this.project(command.project),command.expectedRevision);commandReceipt={kind:'project',id:value.id};break;}
   case 'project.delete':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the project registration.');await this.store.deleteProject(command.projectId,command.expectedRevision);break;
   case 'workflow.save':await this.store.setWorkflow(command.yaml,command.expectedRevision);break;
   case 'settings.save':await this.settings(command.settings,command.expectedRevision);break;
   case 'task.create':{const value=await this.createTaskNow(command);commandReceipt={kind:'task',id:value.id};break;}
   case 'task.edit':await this.store.editTask(command.taskId,{...(command.title!==undefined?{title:command.title}:{}),...(command.description!==undefined?{description:command.description}:{})},command.expectedRevision);break;
   case 'conversation.create':{const id=await this.createConversationNow(command.taskId);commandReceipt={kind:'conversation',id};break;}
   case 'conversation.close':await this.store.closeSession(command.taskId,command.sessionId);break;
   case 'conversation.reopen':await this.store.reopenSession(command.taskId,command.sessionId);break;
   case 'note.save':{const value=await this.saveNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'task.delete':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'delete');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm task data/worktree removal and native conversation archiving.');if(command.requireIdle)await this.assertBatchDeletable(command.taskId);await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'delete',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'worktree.create':this.assertContext(command.taskId);invariant(!this.store.requireTask(command.taskId).pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'create',mode:command.mode,path:command.path,branchName:command.branchName,sourceBranch:command.sourceBranch});break;
   case 'worktree.attach':this.assertContext(command.taskId);invariant(!this.store.requireTask(command.taskId).pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'attach',path:command.path});break;
   case 'worktree.remove':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'remove');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm removal of the worktree while preserving the task and branch.');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'remove',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'operation.retry':{
    const task=this.store.requireTask(command.taskId);if(task.operation){await this.worktrees.retry(command.taskId);const current=this.store.requireTask(command.taskId);if(!current.operation&&current.pendingTransition?.worktreeRequest&&current.pendingTransition.status==='failed')await this.store.transact(d=>{const p=d.tasks.find(t=>t.id===command.taskId)!.pendingTransition!;p.status='waiting';delete p.error;});}else if(task.pendingTransition){await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===command.taskId)!;if(t.pendingTransition){t.pendingTransition.status='waiting';delete t.pendingTransition.error;}});}await this.dispatchPending();break;
   }
   case 'operation.return':await this.clearPending(command.taskId);await this.worktrees.returnToBase(command.taskId);break;
   case 'task.move':await this.move(command);break;
   case 'task.runInstruction':await this.runInstruction(command);break;
  }
  await this.dispatchPending();const snapshot=await this.snapshot();return {...snapshot,...(commandReceipt?{commandReceipt}:{})};
 }
 private assertDestructiveTarget(taskId:string,expected:string|null,kind:'delete'|'remove'):void{const task=this.store.requireTask(taskId);invariant((task.worktree?.path??null)===expected,'WORKTREE_CHANGED','The worktree changed since this confirmation was displayed.');invariant(!task.operation||(task.operation.phase==='failed'&&task.operation.request.kind===kind),'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before replacing its intent.');}
 private async assertBatchDeletable(taskId:string):Promise<void>{
  const task=this.store.requireTask(taskId);
  invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before deleting this task.');
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the confirmed workflow action before deleting this task.');
  invariant((await Promise.all(task.sessionIds.map(id=>this.sessions.isIdle(id)))).every(Boolean),'TASK_BUSY','Wait for every conversation to become idle before deleting this task.');
  if(task.worktree){const project=this.store.requireProject(task.projectId);const tree=await this.git.inspect(project,task.worktree.path,task.sessionIds);if(tree.dirty)throw new KanbanError('DISCARD_REQUIRED','Confirm discarding local worktree changes before deleting this task.',{path:tree.path});}
 }
 private async clearPending(taskId:string):Promise<void>{const task=this.store.requireTask(taskId);invariant(task.pendingTransition?.status!=='sending','EXECUTION_ADMISSION_PENDING','Wait until native prompt admission completes.');if(task.pendingTransition)await this.store.transact(d=>{delete d.tasks.find(t=>t.id===taskId)!.pendingTransition;});}
 private requireReviewedInstruction(actual:string|undefined,expected:string|undefined):string{
  invariant(typeof actual==='string'&&actual.trim().length>0&&typeof expected==='string'&&expected===actual,'INSTRUCTION_CHANGED','The workflow instruction changed or was not reviewed. Review the current instruction before running.');
  return actual;
 }
 private placeTask(state:BoardState,taskId:string,columnId:string,beforeTaskId:string|null):void{
  const task=state.tasks.find(value=>value.id===taskId);invariant(task,'TASK_NOT_FOUND','Task does not exist.');
  const sourceColumnId=task.columnId;
  const destination=state.tasks.filter(value=>value.columnId===columnId&&value.id!==taskId).sort((left,right)=>left.position-right.position||left.createdAt.localeCompare(right.createdAt));
  const requestedIndex=beforeTaskId?destination.findIndex(value=>value.id===beforeTaskId):-1;
  const index=requestedIndex>=0?requestedIndex:destination.length;
  task.columnId=columnId;
  if(sourceColumnId!==columnId){
   const destinationColumn=state.workflow.columns.find(value=>value.id===columnId);
   if(destinationColumn?.onEnterPrompt?.trim())task.instructionPending={columnId,enteredAt:Date.now()};
   else delete task.instructionPending;
  }
  destination.splice(index,0,task);
  destination.forEach((value,position)=>{value.position=position;});
  if(sourceColumnId!==columnId)state.tasks.filter(value=>value.columnId===sourceColumnId).sort((left,right)=>left.position-right.position||left.createdAt.localeCompare(right.createdAt)).forEach((value,position)=>{value.position=position;});
 }
 private async move(command:Extract<Command,{type:'task.move'}>):Promise<void>{
  this.assertContext(command.taskId);const state=this.store.snapshot();const task=this.store.requireTask(command.taskId);const column=state.workflow.columns.find(c=>c.id===command.columnId);
  const sameColumn=task.columnId===column?.id;
  const approvedInstruction=command.mode==='run'?this.requireReviewedInstruction(column?.onEnterPrompt,command.expectedInstruction):undefined;
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the already confirmed transition first.');
  if(command.worktree)invariant(!task.worktree,'WORKTREE_EXISTS','Manage the existing worktree in Git rather than replacing it through a transition.');
  invariant(column,'INVALID_TARGET','The destination stage does not exist.');
  if(sameColumn)invariant(command.mode==='move'&&!command.worktree,'INVALID_TARGET','A same-stage reorder is a move-only operation.');
  else invariant(canTransition(state.workflow,task.columnId,column.id),'TRANSITION_NOT_ALLOWED','This workflow transition is not allowed.');
  invariant(!(command.sessionId&&command.newConversation),'INVALID_TARGET','Choose one existing conversation or a new conversation.');
  if(command.beforeTaskId!==undefined&&command.beforeTaskId!==null){
   const anchor=state.tasks.find(candidate=>candidate.id===command.beforeTaskId);
   invariant(anchor&&anchor.id!==task.id&&anchor.columnId===column.id,'INVALID_TARGET','The placement anchor must be another task in the destination stage.');
  }
  let sessionId=command.sessionId;
  if(command.mode==='run'){
   if(command.newConversation)sessionId=await this.createConversationNow(task.id);
   invariant(sessionId&&this.store.requireTask(task.id).sessionIds.includes(sessionId),'INVALID_TARGET','Select a conversation belonging to this task.');
  }
  const pending:PendingTransition={id:randomUUID(),fromColumnId:task.columnId,columnId:column.id,mode:command.mode,status:'waiting',...(sessionId?{sessionId}:{}),...(command.beforeTaskId!==undefined?{beforeTaskId:command.beforeTaskId}:{}),...(command.worktree?{worktreeRequest:structuredClone(command.worktree)}:{}),...(command.mode==='run'?{text:approvedInstruction as string}: {})};
  await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(!t.operation&&!t.pendingTransition&&t.columnId===task.columnId,'REVISION_CONFLICT','Task changed before the transition could be admitted.');t.pendingTransition=pending;});
  if(command.worktree){
   try{await this.worktrees.request(task.id,{kind:'create',...command.worktree});}
   catch(error){await this.failPending(task.id,pending.id,error);throw error;}
  }
 }
 private async runInstruction(command:Extract<Command,{type:'task.runInstruction'}>):Promise<void>{
  this.assertContext(command.taskId);const state=this.store.snapshot();const task=this.store.requireTask(command.taskId,state);
  invariant(task.columnId===command.columnId,'TASK_MOVED','The task moved to another stage. Review the current stage before running its instruction.');
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');
  const column=state.workflow.columns.find(c=>c.id===command.columnId);
  invariant(column,'INVALID_TARGET','The destination stage does not exist.');
  const instruction=this.requireReviewedInstruction(column.onEnterPrompt,command.expectedInstruction);
  const sessionId=task.sessionIds.find(id=>!task.closedSessionIds.includes(id))??await this.createConversationNow(task.id);
  await this.assertExecutionContext(sessionId);
  await this.sessions.send(sessionId,instruction);
  await this.store.transact(d=>{const current=d.tasks.find(value=>value.id===command.taskId);if(current?.instructionPending?.columnId===command.columnId)delete current.instructionPending;});
 }
 private async failPending(taskId:string,id:string,error:unknown):Promise<void>{await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===taskId);if(t?.pendingTransition?.id===id){t.pendingTransition.status='failed';t.pendingTransition.error=problem(error);}});}
 private dispatchPending():Promise<void>{
  if(this.disposed)return Promise.resolve();
  if(this.drivePromise){this.driveAgain=true;return this.drivePromise;}
  const running=Promise.resolve().then(()=>this.drainPending());
  this.drivePromise=running.finally(()=>{this.drivePromise=undefined;});
  return this.drivePromise;
 }
 private async drainPending():Promise<void>{
  if(this.disposed)return;if(this.driving){this.driveAgain=true;return;}this.driving=true;
  try{do{this.driveAgain=false;for(const task of this.store.snapshot().tasks){const pending=task.pendingTransition;if(!pending||pending.status!=='waiting'||task.operation||(pending.worktreeRequest&&task.worktree?.status!=='ready'))continue;
   try{
    await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(t.pendingTransition?.id===pending.id&&!t.operation,'REVISION_CONFLICT','Task context changed during transition.');invariant(t.columnId===pending.fromColumnId||t.columnId===pending.columnId,'REVISION_CONFLICT','Task column changed during transition.');if(t.columnId!==pending.columnId)invariant(canTransition(d.workflow,t.columnId,pending.columnId),'TRANSITION_NOT_ALLOWED','The workflow no longer permits this transition.');this.placeTask(d,t.id,pending.columnId,pending.beforeTaskId??null);if(pending.mode==='run')t.pendingTransition.status='sending';else delete t.pendingTransition;});
    if(pending.mode==='run'){
     invariant(pending.sessionId&&pending.text,'INVALID_TARGET','Confirmed execution is missing its target or instruction.');
     await this.assertExecutionContext(pending.sessionId);
     await this.sessions.send(pending.sessionId,pending.text,pending.id);
     await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.id===pending.id)delete t.pendingTransition;});
    }
   }catch(error){await this.failPending(task.id,pending.id,error);this.options.report?.(error);}
  }}while(this.driveAgain&&!this.disposed);}finally{this.driving=false;}
 }
 async close():Promise<void>{if(this.disposed)return;await this.flushQuestions();this.disposed=true;if(this.activityTimer!==undefined)clearTimeout(this.activityTimer);for(const dispose of this.disposers)dispose();this.listeners.clear();this.worktrees.dispose();await this.commandTail;await this.drivePromise?.catch(error=>this.options.report?.(error));this.questions.dispose();await this.worktrees.settle();}
}
