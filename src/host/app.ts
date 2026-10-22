import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { BoardStore } from '../domain/store.js';
import { canTransition } from '../domain/workflow.js';
import { QuestionIndex } from '../questions/indexer.js';
import type { BoardSnapshot, Command, PendingTransition, ProjectInput, QuestionRound, Attention } from '../shared/types.js';
import { EMPTY_ATTENTION } from '../shared/types.js';
import type { GitPort, SessionPort } from '../shared/ports.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import { WorktreeCoordinator } from './worktrees.js';

function isEvent(value:unknown):value is {type:string;seq:number;data:unknown}{return Boolean(value&&typeof value==='object'&&'type'in value&&typeof value.type==='string'&&'seq'in value&&typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&'data'in value);}
export interface AppOptions { history?: (sessionId:string)=>Promise<readonly unknown[]>; signal?:AbortSignal; report?:(error:unknown)=>void }
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
 constructor(readonly store:BoardStore,readonly sessions:SessionPort,readonly git:GitPort,private readonly options:AppOptions={}){
  this.worktrees=new WorktreeCoordinator(store,sessions,git,{signal:options.signal});
  this.disposers.push(store.subscribe(()=>{this.changed();void this.dispatchPending().catch(error=>options.report?.(error));}));
  this.disposers.push(this.questions.subscribe(()=>this.changed()));
 }
 private changed():void{if(this.disposed)return;this.sequence++;for(const listener of this.listeners){try{listener();}catch(error){this.options.report?.(error);}}}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 async initialize():Promise<void>{
  const state=this.store.snapshot();
  await Promise.allSettled([...new Set(state.tasks.flatMap(t=>t.sessionIds))].map(id=>this.prepareQuestions(id)));
  for(const task of state.tasks){if(task.pendingTransition?.status==='sending')await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.status==='sending'){t.pendingTransition.status='failed';t.pendingTransition.error={code:'DELIVERY_UNCERTAIN',message:'A prior prompt admission was interrupted. Retry explicitly; the same native request identity will be reused.'};}});}
  for(const task of this.store.snapshot().tasks){const p=task.pendingTransition;if(p?.status==='waiting'&&p.worktreeRequest&&!task.operation&&task.worktree?.status!=='ready'){try{await this.worktrees.request(task.id,{kind:'create',...p.worktreeRequest});}catch(error){await this.failPending(task.id,p.id,error);}}}
  await this.worktrees.resumePending();await this.dispatchPending();
 }
 async prepareQuestions(sessionId:string):Promise<void>{
  if(this.prepared.has(sessionId))return this.prepared.get(sessionId);
  const work=(async()=>{if(this.options.history){for(const event of await this.options.history(sessionId))if(isEvent(event))this.questions.apply(sessionId,event);}})();
  this.prepared.set(sessionId,work);
  try{await work;}catch(error){this.prepared.delete(sessionId);throw error;}
 }
 async rounds(sessionId:string):Promise<QuestionRound[]>{await this.prepareQuestions(sessionId);return structuredClone([...this.questions.getRounds(sessionId)]);}
 private retryActivity():void{
  // Canonical events can precede idle state; expire reads made during the existing debounce and publish a newer sequence.
  if(this.disposed||this.activityTimer!==undefined)return;
  this.activityTimer=setTimeout(()=>{this.activityTimer=undefined;void this.worktrees.resumePending().then(()=>this.dispatchPending()).catch(error=>this.options.report?.(error)).finally(()=>{if(this.disposed)return;this.attention.clear();this.changed();});},50);
 }
 observe(sessionId:string,event:unknown):void{
  if(this.disposed)return;
  if(isEvent(event))this.questions.apply(sessionId,event);this.attention.delete(sessionId);this.changed();this.retryActivity();
 }
 activityChanged():void{if(this.disposed)return;this.attention.clear();this.changed();this.retryActivity();}
 async snapshot():Promise<BoardSnapshot>{
  const sequence=this.sequence;const state=this.store.snapshot();const questionRounds=structuredClone([...this.questions.getRounds()]);const attention:Record<string,Attention>={};
  for(const task of state.tasks){const value={...EMPTY_ATTENTION};for(const id of task.sessionIds){if(!this.attention.has(id)){const pending:Promise<Attention>=this.sessions.attention(id).catch(()=>{if(this.attention.get(id)===pending)this.attention.delete(id);return {...EMPTY_ATTENTION,failed:true};});this.attention.set(id,pending);}const item=await this.attention.get(id)!;value.running ||= item.running;value.unread ||= item.unread;value.awaitingReply ||= item.awaitingReply||this.questions.pending(id);value.failed ||= item.failed;}attention[task.id]=value;}
  return {state,attention,sequence,questionRounds};
 }
 async branches(taskId:string):Promise<string[]>{const task=this.store.requireTask(taskId);return this.git.branches(this.store.requireProject(task.projectId),task.sessionIds);}
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
 private async project(input:ProjectInput):Promise<ProjectInput>{
  const projectPath=await realpath(input.projectPath);const gitRootPath=await realpath(input.gitRootPath);
  invariant((await stat(projectPath)).isDirectory()&&(await stat(gitRootPath)).isDirectory(),'INVALID_PROJECT_PATH','Project and Git root must be existing directories.');
  const relative=path.relative(gitRootPath,projectPath);
  invariant(relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'INVALID_PROJECT_PATH','Project path must be inside its configured Git root.');
  return {...input,projectPath,gitRootPath};
 }
 private assertContext(taskId:string):void{const task=this.store.requireTask(taskId);invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the task context operation before admitting another conversation or execution.');}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.commandTail.then(run);this.commandTail=result.then(()=>undefined,()=>undefined);return result;}
 createConversation(taskId:string):Promise<string>{return this.serial(()=>this.createConversationNow(taskId));}
 private async createConversationNow(taskId:string):Promise<string>{
  this.assertContext(taskId);const before=this.store.requireTask(taskId);const project=this.store.requireProject(before.projectId);const id=await this.sessions.create(project.projectPath);
  try{if(before.effectiveCwd!==project.projectPath)await this.sessions.setDirectory(id,before.effectiveCwd);this.assertContext(taskId);const current=this.store.requireTask(taskId);invariant(current.effectiveCwd===before.effectiveCwd,'CONTEXT_CHANGED','Task directory changed while the conversation was being created.');await this.store.addSession(taskId,id);return id;}
  catch(error){try{await this.sessions.archive(id);}catch(archiveError){this.options.report?.(archiveError);}throw error;}
 }
 createTask(input:{projectId:string;title:string;description:string}){return this.serial(()=>this.createTaskNow(input));}
 private async createTaskNow(input:{projectId:string;title:string;description:string}){
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  const project=this.store.requireProject(input.projectId);const id=await this.sessions.create(project.projectPath);
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
   case 'workflow.save':await this.store.setWorkflow(command.yaml,command.expectedRevision);break;
   case 'task.create':{const value=await this.createTaskNow(command);commandReceipt={kind:'task',id:value.id};break;}
   case 'task.edit':await this.store.editTask(command.taskId,{...(command.title!==undefined?{title:command.title}:{}),...(command.description!==undefined?{description:command.description}:{})},command.expectedRevision);break;
   case 'conversation.create':{const id=await this.createConversationNow(command.taskId);commandReceipt={kind:'conversation',id};break;}
   case 'conversation.close':await this.store.closeSession(command.taskId,command.sessionId);break;
   case 'conversation.reopen':await this.store.reopenSession(command.taskId,command.sessionId);break;
   case 'note.save':{const value=await this.saveNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'task.archive':{
    const task=this.store.requireTask(command.taskId);invariant(!task.operation&&!task.pendingTransition,'TASK_BUSY','Resolve pending task operations before archiving.');
    invariant((await Promise.all(task.sessionIds.map(id=>this.sessions.isIdle(id)))).every(Boolean),'TASK_BUSY','Wait for all conversations to become idle before archiving.');await this.store.archiveTask(command.taskId);break;
   }
   case 'task.restore':await this.store.restoreTask(command.taskId);break;
   case 'task.delete':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'delete');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm task data/worktree removal and native conversation archiving.');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'delete',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'worktree.create':this.assertContext(command.taskId);invariant(!this.store.requireTask(command.taskId).pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'create',mode:command.mode,path:command.path,branchName:command.branchName,sourceBranch:command.sourceBranch});break;
   case 'worktree.attach':this.assertContext(command.taskId);invariant(!this.store.requireTask(command.taskId).pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'attach',path:command.path});break;
   case 'worktree.remove':this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'remove');invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm removal of the worktree while preserving the task and branch.');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'remove',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath});break;
   case 'operation.retry':{
    const task=this.store.requireTask(command.taskId);if(task.operation){await this.worktrees.retry(command.taskId);const current=this.store.requireTask(command.taskId);if(!current.operation&&current.pendingTransition?.worktreeRequest&&current.pendingTransition.status==='failed')await this.store.transact(d=>{const p=d.tasks.find(t=>t.id===command.taskId)!.pendingTransition!;p.status='waiting';delete p.error;});}else if(task.pendingTransition){await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===command.taskId)!;if(t.pendingTransition){t.pendingTransition.status='waiting';delete t.pendingTransition.error;}});}await this.dispatchPending();break;
   }
   case 'operation.return':await this.clearPending(command.taskId);await this.worktrees.returnToBase(command.taskId);break;
   case 'task.move':await this.move(command);break;
  }
  await this.dispatchPending();const snapshot=await this.snapshot();return {...snapshot,...(commandReceipt?{commandReceipt}:{})};
 }
 private assertDestructiveTarget(taskId:string,expected:string|null,kind:'delete'|'remove'):void{const task=this.store.requireTask(taskId);invariant((task.worktree?.path??null)===expected,'WORKTREE_CHANGED','The worktree changed since this confirmation was displayed.');invariant(!task.operation||(task.operation.phase==='failed'&&task.operation.request.kind===kind),'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before replacing its intent.');}
 private async clearPending(taskId:string):Promise<void>{const task=this.store.requireTask(taskId);invariant(task.pendingTransition?.status!=='sending','EXECUTION_ADMISSION_PENDING','Wait until native prompt admission completes.');if(task.pendingTransition)await this.store.transact(d=>{delete d.tasks.find(t=>t.id===taskId)!.pendingTransition;});}
 private requireReviewedInstruction(actual:string|undefined,expected:string|undefined):string{
  invariant(typeof actual==='string'&&actual.trim().length>0&&typeof expected==='string'&&expected===actual,'INSTRUCTION_CHANGED','The workflow instruction changed or was not reviewed. Review the current instruction before running.');
  return actual;
 }
 private async move(command:Extract<Command,{type:'task.move'}>):Promise<void>{
  this.assertContext(command.taskId);const state=this.store.snapshot();const task=this.store.requireTask(command.taskId);const column=state.workflow.columns.find(c=>c.id===command.columnId);
  const approvedInstruction=command.mode==='run'?this.requireReviewedInstruction(column?.onEnterPrompt,command.expectedInstruction):undefined;
  invariant(!task.pendingTransition,'TASK_BUSY','Resolve the already confirmed transition first.');
  if(command.worktree)invariant(!task.worktree,'WORKTREE_EXISTS','Manage the existing worktree in Git rather than replacing it through a transition.');
  invariant(column&&canTransition(state.workflow,task.columnId,column.id),'TRANSITION_NOT_ALLOWED','This workflow transition is not allowed.');
  invariant(!(command.sessionId&&command.newConversation),'INVALID_TARGET','Choose one existing conversation or a new conversation.');
  let sessionId=command.sessionId;
  if(command.mode==='run'){
   if(command.newConversation)sessionId=await this.createConversationNow(task.id);
   invariant(sessionId&&this.store.requireTask(task.id).sessionIds.includes(sessionId),'INVALID_TARGET','Select a conversation belonging to this task.');
  }
  const pending:PendingTransition={id:randomUUID(),fromColumnId:task.columnId,columnId:column.id,mode:command.mode,status:'waiting',...(sessionId?{sessionId}:{}),...(command.worktree?{worktreeRequest:structuredClone(command.worktree)}:{}),...(command.mode==='run'?{text:['Task: '+task.title+' ('+task.id+')','','Description:',task.description,'','Workflow stage: '+column.name,'',approvedInstruction].join(String.fromCharCode(10))}: {})};
  await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(!t.operation&&!t.pendingTransition&&t.columnId===task.columnId,'REVISION_CONFLICT','Task changed before the transition could be admitted.');t.pendingTransition=pending;});
  if(command.worktree){
   try{await this.worktrees.request(task.id,{kind:'create',...command.worktree});}
   catch(error){await this.failPending(task.id,pending.id,error);throw error;}
  }
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
    await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(t.pendingTransition?.id===pending.id&&!t.operation,'REVISION_CONFLICT','Task context changed during transition.');invariant(t.columnId===pending.fromColumnId||t.columnId===pending.columnId,'REVISION_CONFLICT','Task column changed during transition.');if(t.columnId!==pending.columnId)invariant(canTransition(d.workflow,t.columnId,pending.columnId),'TRANSITION_NOT_ALLOWED','The workflow no longer permits this transition.');t.columnId=pending.columnId;t.position=Math.min(0,...d.tasks.filter(x=>x.id!==t.id&&x.columnId===t.columnId).map(x=>x.position))-1;if(pending.mode==='run')t.pendingTransition.status='sending';else delete t.pendingTransition;});
    if(pending.mode==='run'){
     invariant(pending.sessionId&&pending.text,'INVALID_TARGET','Confirmed execution is missing its target or instruction.');
     await this.assertExecutionContext(pending.sessionId);
     await this.sessions.send(pending.sessionId,pending.text,pending.id);
     await this.store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.id===pending.id)delete t.pendingTransition;});
    }
   }catch(error){await this.failPending(task.id,pending.id,error);this.options.report?.(error);}
  }}while(this.driveAgain&&!this.disposed);}finally{this.driving=false;}
 }
 async close():Promise<void>{if(this.disposed)return;this.disposed=true;if(this.activityTimer!==undefined)clearTimeout(this.activityTimer);for(const dispose of this.disposers)dispose();this.listeners.clear();this.worktrees.dispose();await this.commandTail;await this.drivePromise?.catch(error=>this.options.report?.(error));this.questions.dispose();await this.worktrees.settle();}
}
