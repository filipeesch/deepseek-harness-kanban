import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { canTransition, transitionAccess } from '../domain/transitions.js';
import { entryInstruction, nextEnteredAt } from '../domain/stage-entry.js';
import type { BoardSettings, Command, HostSnapshot, HubState, HubTask, NewTask, PendingTransition, Project, ProjectInput, ProjectLocation, QuestionRound } from '../shared/types.js';
import type { GitPort, ProjectProbe, SessionPort, WorkspacePort } from '../shared/ports.js';
import type { QuestionStore } from './question-storage.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import { WorktreeCoordinator } from './worktrees.js';
import { AttentionCoordinator } from './attention.js';
import { isAbsolutePath } from '../domain/validation.js';
import { isGitProject, requireGitProject } from '../shared/project.js';
import { containsPath } from './git.js';
import { taskTitleSlug, worktreePathForBranch } from '../shared/worktree-name.js';
import { ownedSessionIds } from '../domain/session-lineage.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { requiresWorktreeDecision } from '../shared/worktree-decision.js';
import { HubRepository, HubStore } from './hub-repository.js';
import type { LocatedTask } from './hub-repository.js';
import { RepositoryWorktreeStore, TaskLocator } from './task-locator.js';
import { QuestionIndex } from '../questions/indexer.js';
import * as operations from '../domain/hub-operations.js';

async function pathExists(value:string):Promise<boolean>{try{await lstat(value);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function isEvent(value:unknown):value is {type:string;seq:number;data:unknown}{return Boolean(value&&typeof value==='object'&&'type'in value&&typeof value.type==='string'&&'seq'in value&&typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&'data'in value);}
function userPromptTime(event:unknown):number|undefined{
 if(!isEvent(event)||event.type!=='user/message')return undefined;
 const source=(event.data as {source?:{kind?:unknown}}|null)?.source;
 if(source?.kind!=='user')return undefined;
 const time=(event as {time?:unknown}).time;
 return typeof time==='number'&&Number.isFinite(time)?time:Date.now();
}
export interface AppOptions { history?: (sessionId:string)=>Promise<readonly unknown[]>; signal?:AbortSignal; report?:(error:unknown)=>void; questionStore?:QuestionStore; probe?:ProjectProbe }
/** Coordinates Hub-scoped commands while the host continues to own sessions and execution. */
export class KanbanApp {
 readonly questions=new QuestionIndex();
 readonly worktrees:WorktreeCoordinator;
 readonly locator:TaskLocator;
 private readonly listeners=new Set<()=>void>();
 private readonly prepared=new Map<string,Promise<void>>();
 private readonly attention:AttentionCoordinator;
 private readonly disposers:Array<()=>void>=[];
 private sequence=0; private disposed=false; private driving=false; private driveAgain=false; private drivePromise:Promise<void>|undefined; private commandTail:Promise<void>=Promise.resolve();
 private readonly saveTimers=new Map<string,ReturnType<typeof setTimeout>>();
 constructor(readonly hubs:HubRepository,readonly sessions:SessionPort,readonly git:GitPort,private readonly options:AppOptions={},private readonly workspaces?:WorkspacePort){
  this.locator=new TaskLocator(hubs);
  this.worktrees=new WorktreeCoordinator(new RepositoryWorktreeStore(hubs),sessions,git,{signal:options.signal,onTaskDeleted:async task=>{try{await this.cleanupWorktreeWorkspace(task as HubTask);}catch(error){this.options.report?.(error);}}});
  this.attention=new AttentionCoordinator({source:{read:id=>this.sessions.facts(id)},tasks:()=>this.locator.all().map(located=>({id:located.task.id,sessionIds:located.task.sessionIds})),pendingQuestion:id=>this.questions.pending(id),refreshWorktrees:async()=>{await this.worktrees.resumePending();await this.dispatchPending();},onChange:()=>this.changed(),report:error=>this.options.report?.(error)});
  this.disposers.push(hubs.subscribe(()=>{this.changed();void this.dispatchPending().catch(error=>options.report?.(error));}));
  this.disposers.push(this.questions.subscribe(()=>this.changed()));
 }
 /** The first/default Hub facade retained for single-Hub callers and tests. */
 get store():HubStore{return this.hubs.defaultHub();}
 private hubStore(hubId?:string):HubStore{return this.hubs.hub(this.hubs.resolveHubId(hubId));}
 private locatedTask(taskId:string):LocatedTask{return this.hubs.requireTask(taskId);}
 private changed():void{if(this.disposed)return;this.sequence++;for(const listener of this.listeners){try{listener();}catch(error){this.options.report?.(error);}}}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 async initialize():Promise<void>{
  await this.reconcileWorkspaces();
  const tasks=this.locator.all();
  await Promise.allSettled([...new Set(tasks.flatMap(l=>l.task.sessionIds))].map(id=>this.prepareQuestions(id)));
  await this.reconcileInstructionPending();
  for(const located of tasks){const task=located.task;if(task.pendingTransition?.status==='sending')await this.hubStore(located.hubId).transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.status==='sending'){t.pendingTransition.status='failed';t.pendingTransition.error={code:'DELIVERY_UNCERTAIN',message:'A prior prompt admission was interrupted. Retry explicitly; the same native request identity will be reused.'};}});}
  for(const located of this.locator.all()){const task=located.task;const p=task.pendingTransition;if(p?.status==='waiting'&&p.worktreeRequest&&!task.operation&&task.worktree?.status!=='ready'){try{await this.worktrees.request(task.id,{kind:'create',...p.worktreeRequest});}catch(error){await this.failPending(located.hubId,task.id,p.id,error);}}}
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
 observe(sessionId:string,event:unknown):void{
  if(this.disposed)return;
  const promptTime=userPromptTime(event);if(promptTime!==undefined)this.clearInstructionPending(sessionId,promptTime);
  if(isEvent(event)&&this.questions.apply(sessionId,event))this.schedulePersist(sessionId);this.attention.touch(sessionId);this.changed();
 }
 private clearInstructionPending(sessionId:string,time:number):void{
  const located=this.locator.bySession(sessionId);const task=located?.task;const marker=task?.instructionPending;
  if(!located||!task||!marker||marker.columnId!==task.columnId||marker.enteredAt>time)return;
  void this.hubStore(located.hubId).transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);const pending=current?.instructionPending;if(!current||!pending||pending.columnId!==current.columnId||pending.enteredAt>time)return;delete current.instructionPending;}).catch(error=>this.options.report?.(error));
 }
 private async reconcileInstructionPending():Promise<void>{
  if(!this.options.history)return;
  for(const located of this.locator.all()){
   const task=located.task;const marker=task.instructionPending;if(!marker||marker.columnId!==task.columnId)continue;
   let prompted=false;
   for(const sessionId of task.sessionIds){
    try{const events=await this.options.history(sessionId);if(events.some(event=>{const time=userPromptTime(event);return time!==undefined&&time>=marker.enteredAt;})){prompted=true;break;}}
    catch(error){this.options.report?.(error);}
   }
   if(prompted)await this.hubStore(located.hubId).transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);if(current?.instructionPending?.enteredAt===marker.enteredAt)delete current.instructionPending;});
  }
 }
 activityChanged():void{if(this.disposed)return;this.attention.touch();this.changed();}
 sessionActivity(sessionId?:string):void{if(this.disposed)return;this.attention.touch(sessionId);this.changed();}
 async snapshot(refreshAttention=false):Promise<HostSnapshot>{
  if(refreshAttention){this.attention.invalidate();this.sequence++;}
  const sequence=this.sequence;const state=this.hubs.snapshot();
  const conversations=await this.attention.project(this.locator.all().map(located=>({id:located.task.id,sessionIds:located.task.sessionIds})));
  return {state,conversations,sequence};
 }
 async branches(taskId:string):Promise<string[]>{const located=this.locatedTask(taskId);return this.git.branches(requireGitProject(located.project),located.task.sessionIds);}
 async worktreeDefault(taskId:string):Promise<{branchName:string;path:string}>{
  const located=this.locatedTask(taskId);const project=requireGitProject(located.project);const state=this.hubs.snapshot();const basePath=state.settings.worktreeBasePath;const slug=taskTitleSlug(located.task.title);
  const branches=await this.git.branches(project,located.task.sessionIds);const occupied=new Set<string>();
  for(const other of this.locator.all().map(value=>value.task)){if(other.worktree?.path)occupied.add(other.worktree.path);for(const entry of other.unclaimedWorktrees??[])occupied.add(entry.path);const attempt=other.operation?.createAttempt;if(attempt?.path)occupied.add(attempt.path);const pending=other.pendingTransition?.worktreeRequest;if(pending?.path)occupied.add(pending.path);}
  for(let index=1;index<=100;index++){
   const branchName=index===1?slug:slug+'-'+index;if(branches.includes(branchName))continue;if(!basePath)return {branchName,path:''};
   const pathValue=worktreePathForBranch(basePath,branchName);if(!pathValue)throw new KanbanError('INVALID_WORKTREE_PATH','The task title cannot be converted into a usable worktree path.');
   if(occupied.has(pathValue)||await pathExists(pathValue))continue;return {branchName,path:pathValue};
  }
  throw new KanbanError('WORKTREE_NAME_UNAVAILABLE','Could not derive an available worktree name from the task title.');
 }
 async detectProject(pathValue:string):Promise<ProjectLocation>{const probe=this.options.probe;invariant(probe,'PROJECT_PROBE_UNAVAILABLE','Project detection is unavailable in this host.');return probe.inspect(pathValue);}
 async assertExecutionContext(sessionId:string):Promise<void>{
  const located=this.locator.bySession(sessionId);if(!located)return;const task=located.task;const project=located.project;
  if(!isGitProject(project)){
   // Without a Git root the recorded directory cannot be re-derived; it must still be the project path or its retained checkout.
   const expected=task.effectiveCwd;
   invariant(expected===project.projectPath||(task.worktree!==null&&containsPath(task.worktree.path,expected)),'CONTEXT_MISMATCH','The active task directory is neither its configured project nor its retained checkout. Restore the expected context before running.');
   await this.sessions.validateDirectory(sessionId,expected);
   const latest=this.locator.bySession(sessionId);
   invariant(latest&&latest.hubId===located.hubId&&latest.task.projectId===task.projectId&&latest.project.projectPath===project.projectPath&&latest.task.sessionIds.includes(sessionId)&&latest.task.effectiveCwd===expected,'CONTEXT_CHANGED','The task context changed while execution was being validated. Review its directory before retrying.');
   return;
  }
  const gitProject=requireGitProject(project);
  const atBase=task.effectiveCwd===project.projectPath;const root=!atBase&&task.worktree?.status==='ready'?task.worktree.path:undefined;
  invariant(atBase||root!==undefined,'CONTEXT_MISMATCH','The active task directory is neither its configured project nor a ready worktree. Restore the expected context before running.');
  const expected=await this.git.projectDirectory(gitProject,root);
  invariant(expected===task.effectiveCwd,'CONTEXT_MISMATCH','The recorded task directory no longer matches its active project or worktree. Restore the expected context before running.');
  await this.sessions.validateDirectory(sessionId,expected);
  const latest=this.locator.bySession(sessionId);
  invariant(latest&&latest.hubId===located.hubId&&latest.task.projectId===task.projectId&&latest.project.projectPath===project.projectPath&&latest.project.gitRootPath===project.gitRootPath&&latest.task.sessionIds.includes(sessionId)&&latest.task.effectiveCwd===expected,'CONTEXT_CHANGED','The task context changed while execution was being validated. Review its directory before retrying.');
 }
 private async settings(input:BoardSettings,expectedRevision?:number):Promise<BoardSettings>{
  invariant(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Settings input must be a mapping.');
  invariant(Object.keys(input).every(key=>key==='worktreeBasePath'),'INVALID_INPUT','Unsupported board setting.');
  const raw=input.worktreeBasePath;if(raw===undefined||(typeof raw==='string'&&!raw.trim()))return this.hubs.saveSettings({},expectedRevision);
  invariant(typeof raw==='string','INVALID_INPUT','Worktree base path must be text.');const base=raw.trim();invariant(isAbsolutePath(base),'INVALID_INPUT','Worktree base path must be an absolute path.');
  let resolved:string;try{resolved=await realpath(base);}catch{throw new KanbanError('INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.',{path:base});}
  invariant((await stat(resolved)).isDirectory(),'INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.');
  return this.hubs.saveSettings({worktreeBasePath:resolved},expectedRevision);
 }
 private async project(input:ProjectInput):Promise<ProjectInput>{
  const projectPath=await realpath(input.projectPath);
  invariant((await stat(projectPath)).isDirectory(),'INVALID_PROJECT_PATH','The project path must be an existing directory.');
  invariant(input.gitRootPath===undefined||typeof input.gitRootPath==='string','INVALID_INPUT','Git root must be text.');
  const requestedGitRoot=typeof input.gitRootPath==='string'&&input.gitRootPath.trim()?input.gitRootPath.trim():undefined;
  if(requestedGitRoot===undefined){const {gitRootPath:_gitRootPath,...rest}=input;return {...rest,projectPath};}
  const gitRootPath=await realpath(requestedGitRoot);
  invariant((await stat(gitRootPath)).isDirectory(),'INVALID_PROJECT_PATH','The Git root must be an existing directory.');
  const relative=path.relative(gitRootPath,projectPath);
  invariant(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)),'INVALID_PROJECT_PATH','Project path must be inside its configured Git root.');
  const probe=this.options.probe;
  invariant(probe,'PROJECT_PROBE_UNAVAILABLE','Project detection is unavailable in this host.');
  const location=await probe.inspect(projectPath);
  if(location.kind!=='git')throw new KanbanError('INVALID_GIT_ROOT','The project path is not inside a Git repository.',{path:projectPath});
  if(location.gitRootPath!==gitRootPath)throw new KanbanError('INVALID_GIT_ROOT','The Git root must be the repository top-level directory.',{configured:gitRootPath,actual:location.gitRootPath});
  return {...input,projectPath,gitRootPath};
 }
 private async ensureProjectWorkspace(hubId:string,project:Project):Promise<string|undefined>{
  if(!this.workspaces)return undefined;
  if(project.workspaceId&&this.workspaces.get(project.workspaceId))return project.workspaceId;
  const ensured=await this.workspaces.ensure(project.projectPath,project.name);
  if(project.workspaceId!==ensured.workspace.id||project.workspaceOwned!==ensured.owned)await this.hubStore(hubId).setProjectWorkspace(project.id,ensured.workspace.id,ensured.owned);
  return ensured.workspace.id;
 }
 private async ensureWorktreeWorkspace(hubId:string,task:HubTask,project:Project):Promise<string|undefined>{
  if(!this.workspaces)return undefined;
  if(task.effectiveCwd===project.projectPath)return this.ensureProjectWorkspace(hubId,project);
  if(task.worktreeWorkspaceId&&this.workspaces.get(task.worktreeWorkspaceId))return task.worktreeWorkspaceId;
  const title=project.name+' · '+(task.worktree?.branch??path.basename(task.effectiveCwd));
  const ensured=await this.workspaces.ensure(task.effectiveCwd,title);
  if(task.worktreeWorkspaceId!==ensured.workspace.id||task.worktreeWorkspaceOwned!==ensured.owned)await this.hubStore(hubId).setTaskWorktreeWorkspace(task.id,ensured.workspace.id,ensured.owned);
  return ensured.workspace.id;
 }
 private async reconcileWorkspaces():Promise<void>{
  if(!this.workspaces)return;
  for(const located of this.locator.all()){
   const {task,project,hubId}=located;
   if(task.sessionIds.length>0){try{await this.ensureProjectWorkspace(hubId,project);await this.ensureWorktreeWorkspace(hubId,task,project);}
   catch(error){this.options.report?.(error);}}
   for(const sessionId of task.sessionIds){
    try{
     const directory=await this.sessions.directory(sessionId);
     if(directory!==project.projectPath)await this.workspaces.ensure(directory,project.name+' · '+path.basename(directory));
    }catch(error){this.options.report?.(error);}
   }
  }
 }
 private async cleanupWorktreeWorkspace(task:HubTask):Promise<void>{
  if(!this.workspaces||!task.worktreeWorkspaceId||!task.worktreeWorkspaceOwned)return;
  const info=this.workspaces.get(task.worktreeWorkspaceId);
  if(!info)return;
  const owned=ownedSessionIds(task.sessionIds,(await this.sessions.topology()).lineage);
  if(info.sessionIds.some(id=>!owned.has(id)))return;
  if(this.locator.all().some(other=>other.task.id!==task.id&&other.task.worktreeWorkspaceId===task.worktreeWorkspaceId))return;
  await this.workspaces.delete(task.worktreeWorkspaceId);
 }
 private assertContext(taskId:string):void{const task=this.locatedTask(taskId).task;invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the task context operation before admitting another conversation or execution.');}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.commandTail.then(run);this.commandTail=result.then(()=>undefined,()=>undefined);return result;}
 createConversation(taskId:string):Promise<string>{return this.serial(()=>this.createConversationNow(taskId));}
 private async createConversationNow(taskId:string,options:{allowUndecided?:boolean}={}):Promise<string>{
  this.assertContext(taskId);const located=this.locatedTask(taskId);const store=this.hubs.hub(located.hubId);const before=located.task;const project=located.project;
  invariant(options.allowUndecided===true||!requiresWorktreeDecision(before,project),'WORKTREE_DECISION_REQUIRED','Choose whether to create a worktree or continue in the base project before starting the first conversation.');
  const workspaceId=await this.ensureWorktreeWorkspace(located.hubId,before,project);const id=await this.sessions.create(project.projectPath,workspaceId);
  try{if(before.effectiveCwd!==project.projectPath)await this.sessions.setDirectory(id,before.effectiveCwd);this.assertContext(taskId);const current=store.requireTask(taskId);invariant(current.effectiveCwd===before.effectiveCwd,'CONTEXT_CHANGED','Task directory changed while the conversation was being created.');await store.addSession(taskId,id);return id;}
  catch(error){try{await this.sessions.archive(id);}catch(archiveError){this.options.report?.(archiveError);}throw error;}
 }
 createTask(input:NewTask){return this.serial(()=>this.createTaskNow(input));}
 private async createTaskNow(input:NewTask&{hubId?:string}){
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  let hubId:string;let hub:HubState;let project:Project|undefined;let boardId=input.boardId;
  if(input.hubId){hubId=this.hubs.resolveHubId(input.hubId);hub=this.hubs.requireHub(hubId);project=hub.projects.find(value=>value.id===input.projectId);invariant(project,'PROJECT_NOT_FOUND','Project does not exist in the selected Hub.');}
  else if(input.boardId){const found=this.hubs.list().find(value=>value.boards.some(board=>board.id===input.boardId));invariant(found,'BOARD_NOT_FOUND','Board does not exist.');hubId=found.id;hub=found;project=hub.projects.find(value=>value.id===input.projectId);invariant(project,'PROJECT_NOT_FOUND','Project does not exist in the board Hub.');}
  else{const located=this.locator.project(input.projectId);invariant(located,'PROJECT_NOT_FOUND','Project does not exist.');hubId=located.hubId;hub=located.hub;project=located.project;}
  boardId??=hub.boards[0]?.id;invariant(boardId,'BOARD_NOT_FOUND','The Hub has no board.');invariant(hub.boards.some(board=>board.id===boardId),'BOARD_NOT_FOUND','Board does not exist in the selected Hub.');
  const store=this.hubs.hub(hubId);
  return store.createTask({...input,boardId});
 }
 saveNote(input:Extract<Command,{type:'note.save'}>){return this.serial(()=>this.saveNoteNow(input));}
 private async saveNoteNow(input:Extract<Command,{type:'note.save'}>) {invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');const located=this.locatedTask(input.taskId);return this.hubs.hub(located.hubId).saveNote(input.taskId,{id:input.noteId,content:input.content,tags:input.tags});}
 command(command:Command):Promise<HostSnapshot>{return this.serial(()=>this.execute(command));}
 private async execute(command:Command):Promise<HostSnapshot>{
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  let commandReceipt:HostSnapshot['commandReceipt'];
  switch(command.type){
   case 'hub.create':{const hub=await this.hubs.createHub(command.name);commandReceipt={kind:'hub',id:hub.id};break;}
   case 'hub.rename':{await this.hubs.renameHub(command.hubId,command.name,command.expectedRevision);break;}
   case 'hub.delete':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the Hub and its task-free projects.');await this.hubs.deleteHub(command.hubId);break;
   case 'board.create':{const board=await this.hubStore(command.hubId).addBoard(command.name);commandReceipt={kind:'board',id:board.id};break;}
   case 'board.rename':{await this.hubStore(command.hubId).renameBoard(command.boardId,command.name,command.expectedRevision);break;}
   case 'board.delete':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the board.');await this.hubStore(command.hubId).deleteBoard(command.boardId,command.expectedRevision);break;
   case 'board.workflow.save':await this.hubStore(command.hubId).saveBoardWorkflow(command.boardId,command.yaml,command.expectedRevision);break;
   case 'project.save':{const store=this.hubStore(command.hubId);const value=await store.saveProject(await this.project(command.project),command.expectedRevision);commandReceipt={kind:'project',id:value.id};break;}
   case 'project.delete':{const store=this.hubStore(command.hubId);invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the project registration.');await store.deleteProject(command.projectId,command.expectedRevision);break;}
   case 'workflow.save':await this.hubStore(command.hubId).setWorkflow(command.yaml,command.expectedRevision);break;
   case 'settings.save':await this.settings(command.settings,command.expectedRevision);break;
   case 'task.create':{const value=await this.createTaskNow(command);commandReceipt={kind:'task',id:value.id};break;}
   case 'task.edit':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).editTask(command.taskId,{...(command.title!==undefined?{title:command.title}:{}),...(command.description!==undefined?{description:command.description}:{})},command.expectedRevision);break;}
   case 'conversation.create':{const id=await this.createConversationNow(command.taskId);commandReceipt={kind:'conversation',id};break;}
   case 'conversation.close':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).closeSession(command.taskId,command.sessionId);break;}
   case 'conversation.reopen':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).reopenSession(command.taskId,command.sessionId);break;}
   case 'note.save':{const value=await this.saveNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'task.delete':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'delete');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm task data/worktree removal and native conversation archiving.');if(command.requireIdle)await this.assertBatchDeletable(command.taskId);await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'delete',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'worktree.create':this.assertContext(command.taskId);invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'create',mode:command.mode,path:command.path,branchName:command.branchName,sourceBranch:command.sourceBranch});break;
   case 'worktree.attach':this.assertContext(command.taskId);invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'attach',path:command.path});break;
   case 'worktree.dismiss':{this.assertContext(command.taskId);const located=this.locatedTask(command.taskId);invariant(isGitProject(located.project),'PROJECT_NOT_GIT','Worktree choices require a Git-backed project.');invariant(!located.task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');invariant(!located.task.worktree,'WORKTREE_EXISTS','The task already has a worktree.');if(located.task.worktreeDismissed!==true)await this.hubs.hub(located.hubId).dismissWorktree(command.taskId);break;}
   case 'worktree.remove':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'remove');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm removal of the worktree while preserving the task and branch.');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'remove',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'operation.retry':{
    const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const task=located.task;if(task.operation){await this.worktrees.retry(command.taskId);const current=store.snapshot().tasks.find(t=>t.id===command.taskId);if(current&&!current.operation&&current.pendingTransition?.worktreeRequest&&current.pendingTransition.status==='failed')await store.transact(d=>{const p=d.tasks.find(t=>t.id===command.taskId)!.pendingTransition!;p.status='waiting';delete p.error;});}else if(task.pendingTransition){await store.transact(d=>{const t=d.tasks.find(t=>t.id===command.taskId)!;if(t.pendingTransition){t.pendingTransition.status='waiting';delete t.pendingTransition.error;}});}await this.dispatchPending();break;
   }
   case 'operation.return':await this.clearPending(command.taskId);await this.worktrees.returnToBase(command.taskId);break;
   case 'task.move':await this.move(command);break;
   case 'task.runInstruction':await this.runInstruction(command);break;
  }
  await this.dispatchPending();const snapshot=await this.snapshot();return {...snapshot,...(commandReceipt?{commandReceipt}:{})};
 }
 private assertDestructiveTarget(taskId:string,expected:string|null,kind:'delete'|'remove'):void{const task=this.locatedTask(taskId).task;invariant((task.worktree?.path??null)===expected,'WORKTREE_CHANGED','The worktree changed since this confirmation was displayed.');invariant(!task.operation||(task.operation.phase==='failed'&&task.operation.request.kind===kind),'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before replacing its intent.');}
 private async assertBatchDeletable(taskId:string):Promise<void>{
  const located=this.locatedTask(taskId);const task=located.task;
  invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before deleting this task.');
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the confirmed workflow action before deleting this task.');
  invariant((await Promise.all(task.sessionIds.map(id=>this.sessions.isIdle(id)))).every(Boolean),'TASK_BUSY','Wait for every conversation to become idle before deleting this task.');
  if(task.worktree&&isGitProject(located.project)){const tree=await this.git.inspect(requireGitProject(located.project),task.worktree.path,task.sessionIds);if(tree.dirty)throw new KanbanError('DISCARD_REQUIRED','Confirm discarding local worktree changes before deleting this task.',{path:tree.path});}
 }
 private async clearPending(taskId:string):Promise<void>{const located=this.locatedTask(taskId);const task=located.task;invariant(task.pendingTransition?.status!=='sending','EXECUTION_ADMISSION_PENDING','Wait until native prompt admission completes.');if(task.pendingTransition)await this.hubs.hub(located.hubId).transact(d=>{delete d.tasks.find(t=>t.id===taskId)!.pendingTransition;});}
 private requireReviewedInstruction(actual:string|undefined,expected:string|undefined):string{
  invariant(typeof actual==='string'&&actual.trim().length>0&&typeof expected==='string'&&expected===actual,'INSTRUCTION_CHANGED','The workflow instruction changed or was not reviewed. Review the current instruction before running.');
  return actual;
 }
 private async move(command:Extract<Command,{type:'task.move'}>):Promise<void>{
  this.assertContext(command.taskId);const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const state=store.snapshot();const task=located.task;const board=state.boards.find(b=>b.id===task.boardId);invariant(board,'BOARD_NOT_FOUND','The task board does not exist.');const column=board.workflow.columns.find(c=>c.id===command.columnId);
  const sameColumn=task.columnId===column?.id;
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the already confirmed transition first.');
  invariant(column,'INVALID_TARGET','The destination stage does not exist.');
  const access=transitionAccess(board.workflow,task.columnId,column.id);
  if(!sameColumn)invariant(access==='allowed'||(access==='restricted'&&command.overrideTransition===true),'TRANSITION_NOT_ALLOWED',access==='restricted'?'This workflow transition requires explicit confirmation.':'This workflow transition is not allowed.');
  if(command.beforeTaskId!==undefined&&command.beforeTaskId!==null){
   const anchor=state.tasks.find(candidate=>candidate.id===command.beforeTaskId);
   invariant(anchor&&anchor.id!==task.id&&anchor.columnId===column.id&&anchor.boardId===board.id,'INVALID_TARGET','The placement anchor must be another task in the destination stage.');
  }
  const pending:PendingTransition={id:randomUUID(),fromColumnId:task.columnId,columnId:column.id,mode:'move',status:'waiting',...(access==='restricted'&&command.overrideTransition===true?{transitionOverride:true}:{}),...(command.beforeTaskId!==undefined?{beforeTaskId:command.beforeTaskId}:{})};
  await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(!t.operation&&!t.pendingTransition&&t.columnId===task.columnId,'REVISION_CONFLICT','Task changed before the transition could be admitted.');t.pendingTransition=pending;});
 }
 private async runInstruction(command:Extract<Command,{type:'task.runInstruction'}>):Promise<void>{
  this.assertContext(command.taskId);const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const state=store.snapshot();const task=located.task;
  invariant(task.columnId===command.columnId,'TASK_MOVED','The task moved to another stage. Review the current stage before running its instruction.');
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');
  const board=state.boards.find(b=>b.id===task.boardId);invariant(board,'BOARD_NOT_FOUND','The task board does not exist.');const column=board.workflow.columns.find(c=>c.id===command.columnId);
  invariant(column,'INVALID_TARGET','The destination stage does not exist.');
  invariant(task.instructionPending?.columnId===command.columnId&&task.instructionPending.enteredAt===command.expectedEnteredAt,'INSTRUCTION_ALREADY_RESOLVED','This stage entry was already resolved or replaced. Review the current entry before running.');
  const instruction=this.requireReviewedInstruction(entryInstruction(column),command.expectedInstruction);
  const sessionId=firstOpenSessionId(task)??await this.createConversationNow(task.id,{allowUndecided:true});
  await this.assertExecutionContext(sessionId);
  await this.sessions.send(sessionId,instruction);
  await store.transact(d=>{const current=d.tasks.find(value=>value.id===command.taskId);if(current?.instructionPending?.columnId===command.columnId&&current.instructionPending.enteredAt===command.expectedEnteredAt)delete current.instructionPending;});
 }
 private async failPending(hubId:string,taskId:string,id:string,error:unknown):Promise<void>{await this.hubs.hub(hubId).transact(d=>{const t=d.tasks.find(t=>t.id===taskId);if(t?.pendingTransition?.id===id){t.pendingTransition.status='failed';t.pendingTransition.error=problem(error);}});}
 private dispatchPending():Promise<void>{
  if(this.disposed)return Promise.resolve();
  if(this.drivePromise){this.driveAgain=true;return this.drivePromise;}
  const running=Promise.resolve().then(()=>this.drainPending());
  this.drivePromise=running.finally(()=>{this.drivePromise=undefined;});
  return this.drivePromise;
 }
 private async drainPending():Promise<void>{
  if(this.disposed)return;if(this.driving){this.driveAgain=true;return;}this.driving=true;
  try{do{this.driveAgain=false;for(const located of this.locator.all()){const task=located.task;const pending=task.pendingTransition;if(!pending||pending.status!=='waiting'||task.operation||(pending.worktreeRequest&&task.worktree?.status!=='ready'))continue;const store=this.hubs.hub(located.hubId);
   try{
    await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(t.pendingTransition?.id===pending.id&&!t.operation,'REVISION_CONFLICT','Task context changed during transition.');invariant(t.columnId===pending.fromColumnId||t.columnId===pending.columnId,'REVISION_CONFLICT','Task column changed during transition.');const board=d.boards.find(b=>b.id===t.boardId)!;if(t.columnId!==pending.columnId)invariant(pending.transitionOverride===true||canTransition(board.workflow,t.columnId,pending.columnId),'TRANSITION_NOT_ALLOWED','The workflow no longer permits this transition.');operations.placeTask(d,t.id,pending.columnId,pending.beforeTaskId??null,nextEnteredAt());if(pending.mode==='run')t.pendingTransition.status='sending';else delete t.pendingTransition;});
    if(pending.mode==='run'){
     invariant(pending.sessionId&&pending.text,'INVALID_TARGET','Confirmed execution is missing its target or instruction.');
     await this.assertExecutionContext(pending.sessionId);
     await this.sessions.send(pending.sessionId,pending.text,pending.id);
     await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.id===pending.id)delete t.pendingTransition;});
    }
   }catch(error){await this.failPending(located.hubId,task.id,pending.id,error);this.options.report?.(error);}
  }}while(this.driveAgain&&!this.disposed);}finally{this.driving=false;}
 }
 async close():Promise<void>{if(this.disposed)return;await this.flushQuestions();this.disposed=true;this.attention.dispose();for(const dispose of this.disposers)dispose();this.listeners.clear();this.worktrees.dispose();await this.commandTail;await this.drivePromise?.catch(error=>this.options.report?.(error));this.questions.dispose();await this.worktrees.settle();}
}
