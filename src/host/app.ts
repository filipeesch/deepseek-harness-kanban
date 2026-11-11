import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { canTransition, transitionAccess } from '../domain/transitions.js';
import { resolveTaskConversationModel } from '../domain/model-preference.js';
import type { SessionModelPort } from './session-model.js';
import { conversationStageActivity, persistedStageActivity } from '../shared/stage-activity.js';
import { entryInstruction, nextEnteredAt } from '../domain/stage-entry.js';
import { placementFromAnchor } from '../domain/placement.js';
import { AUTO_ADVANCE_SETTLE_MS, AutoAdvanceCoordinator } from './auto-advance.js';
import type { AutoAdvancePlan } from '../domain/auto-advance.js';
import { admitAutoAdvance } from './auto-advance-admission.js';
import { readPendingUserWork, withQuestionPending } from './pending-source.js';
import type { ConversationFactsSource } from './native-facts.js';
import type { AutoModePauseReason, Board, BoardSettings, Command, ConversationFacts, ConversationModelOutcome, FirstExecutionOutcome, FullHostSnapshot, HostSnapshot, HubState, HubTask, LocalDriveRequest, LocalDriveResult, NewTask, PendingTransition, Project, ProjectInput, ProjectLocation, QuestionRound, RetainedCheckout, RetainedCheckoutReason, SharingCommand, SnapshotRequest, Task, WorktreeDefaults } from '../shared/types.js';
import type { TaskMessagePreparation } from '../shared/task-message.js';
import type { GitPort, ProjectProbe, SessionPort, WorkspacePort } from '../shared/ports.js';
import type { QuestionStore } from './question-storage.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import { entryExists } from './paths.js';
import { WorktreeCoordinator } from './worktrees.js';
import { OperationQueue } from './operation-queue.js';
import { ProjectRelocationCoordinator } from './project-relocation.js';
import { RepositoryProjectRelocationStore } from './project-relocation-store.js';
import { bindingMatches } from './destructive-admission.js';
import { replaceableByDeletion } from '../shared/context-operation.js';
import { AttentionCoordinator, type AttentionTask } from './attention.js';
import { SnapshotAssembler } from './snapshot-assembler.js';
import { PendingTransitionIndex } from './pending-transition-index.js';
import { StartupReconciler } from './startup-reconciler.js';
import { PendingWorkRunner } from './pending-work.js';
import { PublishScheduler } from './publish-scheduler.js';
import { isGitProject, requireGitProject, requireProjectPath } from '../shared/project.js';
import { containsPath } from './git.js';
import { defaultWorktreeDestination, taskTitleSlug } from '../shared/worktree-name.js';
import { prepareFirstExecution } from './first-execution.js';
import { worktreeDecision } from '../domain/first-execution.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { admitStageInstruction, type StageInstructionDeps } from './stage-instruction.js';
import { requiresWorktreeDecision, unresolvedWorktreeBinding } from '../shared/worktree-decision.js';
import { HubRepository, HubStore } from './hub-repository.js';
import { BoardAdministration, type BoardSharingPort } from './board-administration.js';
import type { LocatedTask, TaskSummary } from './hub-repository.js';
import { RepositoryWorktreeStore, TaskLocator } from './task-locator.js';
import { QuestionIndex } from '../questions/indexer.js';
import * as operations from '../domain/hub-operations.js';
import type { HubSharingService } from './sharing/service.js';
import type { TeamFiles } from './team-files/service.js';
import type { SharingPollScheduler } from './sharing/scheduler.js';
import type { GoogleDriveLocalDiscovery } from './sharing/google-drive-local/discovery.js';
import { isAuthorizationCommand, type GoogleDriveAuthCoordinator } from './sharing/auth-coordinator.js';
import { WorkspaceCoordinator } from './workspace-coordinator.js';
import { resolveCanonicalPath } from './path-resolution.js';
import type { ScheduleRuntimePort } from './schedule-port.js';
import type { ModelCatalog } from '../shared/types.js';

async function pathExists(value:string):Promise<boolean>{try{await lstat(value);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function isEvent(value:unknown):value is {type:string;seq:number;data:unknown}{return Boolean(value&&typeof value==='object'&&'type'in value&&typeof value.type==='string'&&'seq'in value&&typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&'data'in value);}
function userPromptTime(event:unknown):number|undefined{
 if(!isEvent(event)||event.type!=='user/message')return undefined;
 const source=(event.data as {source?:{kind?:unknown}}|null)?.source;
 if(source?.kind!=='user')return undefined;
 const time=(event as {time?:unknown}).time;
 return typeof time==='number'&&Number.isFinite(time)?time:Date.now();
}
function boardSharingPort(sharing:HubSharingService):BoardSharingPort{
 return {
  view:hubId=>sharing.view(hubId),
  isBound:(hubId,boardId)=>sharing.isBound(hubId,boardId),
  noteLocalChange:hubId=>sharing.noteLocalChange(hubId),
  removeBoard:(hubId,boardId,scope,name)=>sharing.removeBoard(hubId,boardId,scope,name),
  publishBoard:(hubId,boardId)=>sharing.publishBoard(hubId,boardId),
  publishManifest:hubId=>sharing.publishManifest(hubId),
 };
}
/** One created conversation and, when its board named a default model, how that model fared. */
export interface CreatedConversation { sessionId: string; model?: ConversationModelOutcome }
export interface AppOptions { history?: (sessionId:string)=>Promise<readonly unknown[]>; signal?:AbortSignal; report?:(error:unknown)=>void; questionStore?:QuestionStore; probe?:ProjectProbe; /** Applies a board's default model to one conversation; absent means no board model is applied. */ models?:SessionModelPort; sharing?:HubSharingService; sharingAuth?:GoogleDriveAuthCoordinator; localDrive?:GoogleDriveLocalDiscovery; scheduler?:SharingPollScheduler; teamFiles?:TeamFiles; /** Whether a retained checkout directory still exists; defaults to a filesystem check. */ retainedCheckoutExists?:(path:string)=>Promise<boolean>; /** How long to wait between retained-checkout existence checks. */ retainedCheckoutPruneIntervalMs?:number }
/** Coordinates Hub-scoped commands while the host continues to own sessions and execution. */
export class KanbanApp {
 readonly questions=new QuestionIndex();
 readonly worktrees:WorktreeCoordinator;
 readonly relocations:ProjectRelocationCoordinator;
 private readonly operationQueue=new OperationQueue();
 readonly locator:TaskLocator;
 readonly boards:BoardAdministration;
 /** The team file surface, present only when the host wires a sharing service. */
 readonly teamFiles?:TeamFiles;
 private readonly listeners=new Set<()=>void>();
 private readonly prepared=new Map<string,Promise<void>>();
 private readonly attention:AttentionCoordinator;
 private readonly assembler:SnapshotAssembler;
 private readonly pendingTransitions=new PendingTransitionIndex();
 private readonly startup:StartupReconciler;
 private readonly pendingWork:PendingWorkRunner;
 private readonly publisher=new PublishScheduler({publish:()=>this.changed()});
 private readonly disposers:Array<()=>void>=[];
 private sequence=0; private disposed=false; private driving=false; private driveAgain=false; private drivePromise:Promise<void>|undefined; private commandTail:Promise<void>=Promise.resolve();
 private readonly saveTimers=new Map<string,ReturnType<typeof setTimeout>>();
 /** Transient, in-memory retention notices; the checkout itself lives on disk. */
 private readonly retainedCheckouts:RetainedCheckout[]=[];
 private readonly retainedCheckoutExists:(path:string)=>Promise<boolean>;
 private readonly retainedCheckoutPruneIntervalMs:number;
 private retainedPruneAt=0;
 private retainedPrune:Promise<void>|undefined;
 private retainedPruneTimer:ReturnType<typeof setTimeout>|undefined;
 private pruningRetained=false;
 private readonly autoAdvance:AutoAdvanceCoordinator;
 /** The one conversation-fact read every host consumer shares; the question projection is folded in here. */
 private readonly factsSource:ConversationFactsSource;
 private readonly workspaceCoordinator?:WorkspaceCoordinator;
 private scheduleRuntime:ScheduleRuntimePort|undefined;
 constructor(readonly hubs:HubRepository,readonly sessions:SessionPort,readonly git:GitPort,private readonly options:AppOptions={},private readonly workspaces?:WorkspacePort){
  this.locator=new TaskLocator(hubs);
  this.retainedCheckoutExists=options.retainedCheckoutExists??entryExists;
  this.retainedCheckoutPruneIntervalMs=options.retainedCheckoutPruneIntervalMs??15000;
  if(options.teamFiles)this.teamFiles=options.teamFiles;
  this.boards=new BoardAdministration({hubs,...(options.sharing?{sharing:boardSharingPort(options.sharing)}:{}),...(options.report?{report:options.report}:{}),activity:{inFlight:(hubId,boardId)=>this.boardActivity(hubId,boardId)}});
  this.factsSource=withQuestionPending({read:id=>this.sessions.facts(id)},this.questions);
  if(workspaces)this.workspaceCoordinator=new WorkspaceCoordinator({
   workspaces,sessions,store:{
    all:()=>this.locator.all().map(located=>({hubId:located.hubId,task:located.task,project:located.project})),
    setProjectWorkspace:async(hubId,projectId,workspaceId,owned)=>{await this.hubs.hub(hubId).setProjectWorkspace(projectId,workspaceId,owned);},
    setTaskWorktreeWorkspace:async(hubId,taskId,workspaceId,owned)=>{await this.hubs.hub(hubId).setTaskWorktreeWorkspace(taskId,workspaceId,owned);},
   },
   ...(options.report?{report:options.report}:{}),
  });
  this.worktrees=new WorktreeCoordinator(new RepositoryWorktreeStore(hubs),sessions,git,{signal:options.signal,queue:this.operationQueue,worktreeDefaults:{derive:async taskId=>this.worktreeDefaultsFor(this.locatedTask(taskId).task)},onTaskDeleted:async task=>{try{await this.workspaceCoordinator?.cleanup(task as HubTask);}catch(error){this.options.report?.(error);}},onCheckoutRetained:(task,project,retainedPath,reason)=>this.retainCheckout(task,project,retainedPath,reason)});
  this.relocations=new ProjectRelocationCoordinator(new RepositoryProjectRelocationStore(hubs),sessions,git,{queue:this.operationQueue,signal:options.signal,...(this.workspaceCoordinator?{workspaces:{bind:async(hubId,project)=>{await this.workspaceCoordinator!.rebindProject(hubId,project);}}}:{}),...(options.report?{report:options.report}:{})});
  this.pendingWork=new PendingWorkRunner({resumeWorktrees:async()=>{await this.worktrees.resumePending();},resumeRelocations:async()=>{await this.relocations.resumePending();},dispatchPending:async()=>{await this.dispatchPending();},report:error=>this.options.report?.(error)});
  this.attention=new AttentionCoordinator({source:this.factsSource,tasks:()=>this.attentionTasks(),runPendingWork:async()=>{await this.pendingWork.run();},onChange:()=>this.attentionChanged(),onFacts:()=>this.markChanged(),report:error=>this.options.report?.(error)});
  this.autoAdvance=new AutoAdvanceCoordinator({
   locateBySession:sessionId=>{const located=this.locator.bySession(sessionId);return located?{task:located.task,board:located.board}:undefined;},
   locate:taskId=>{const located=this.locator.byTask(taskId);return located?{task:located.task,board:located.board}:undefined;},
   facts:sessionId=>this.factsSource.read(sessionId),
   admit:(taskId,plan,isCurrent)=>this.admitAutoAdvance(taskId,plan,isCurrent),
   pause:(taskId,reason,message,expectedColumnId)=>this.pauseAutoMode(taskId,reason,message,expectedColumnId),
   schedule:callback=>setTimeout(callback,AUTO_ADVANCE_SETTLE_MS),
   cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
   report:error=>this.options.report?.(error),
  });
  this.assembler=new SnapshotAssembler({hubs,onChange:()=>this.markChanged(),...(options.report===undefined?{}:{report:options.report}),...(options.sharing===undefined?{}:{sharing:()=>options.sharing!.views()}),...(options.sharingAuth===undefined?{}:{sharingAuth:options.sharingAuth})});
  this.startup=new StartupReconciler({...(options.signal===undefined?{}:{signal:options.signal}),...(options.report===undefined?{}:{report:options.report})});
  this.pendingTransitions.refresh(this.locator.summaries());
  this.disposers.push(hubs.subscribe(()=>{this.assembler.invalidateState();this.pendingTransitions.refresh(this.locator.summaries());this.markChanged();void this.dispatchPending().catch(error=>options.report?.(error));}));
 }
 /** Attach the live schedule runtime once the app exists; commands require it. */
 attachScheduleRuntime(port:ScheduleRuntimePort):void{this.scheduleRuntime=port;}
 private requireScheduleRuntime():ScheduleRuntimePort{
  invariant(this.scheduleRuntime,'SCHEDULES_UNAVAILABLE','Session schedules are unavailable in this host.');
  return this.scheduleRuntime;
 }
 /**
  * The host model catalog for the settings editors. It is asked of the session model
  * port, which is what a board needs it for; the schedule runtime answers only when
  * this host wired no port, so reading the catalog to choose a board's default model
  * never depends on whether schedules are available.
  */
 async modelCatalog(refresh=false):Promise<ModelCatalog>{
  const models=this.options.models;
  if(models!==undefined)return models.catalog(refresh);
  return this.requireScheduleRuntime().modelCatalog(refresh);
 }
 /** The first/default Hub facade retained for single-Hub callers and tests. */
 get store():HubStore{return this.hubs.defaultHub();}
 private hubStore(hubId?:string):HubStore{return this.hubs.hub(this.hubs.resolveHubId(hubId));}
 private locatedTask(taskId:string):LocatedTask{return this.hubs.requireTask(taskId);}
 private changed():void{if(this.disposed)return;for(const listener of this.listeners){try{listener();}catch(error){this.options.report?.(error);}}}
 /**
  * Re-project one conversation's derived facts after a host-side change that emitted
  * no session event. This invalidates the facts cache and requests a publish only; it
  * deliberately does not run pending work, which a session-event touch also does.
  */
 private rederiveAttention(sessionId:string,immediate=false):void{
  if(this.disposed)return;
  this.attention.invalidate(sessionId);
  if(immediate){this.attentionChanged();return;}
  this.markChanged();
 }
 private markChanged():void{if(this.disposed)return;this.sequence++;this.publisher.request();}
 /** Record a transient retention notice once, after the deletion that retained the checkout completed. */
 private retainCheckout(task:Task,project:Project,retainedPath:string,reason:RetainedCheckoutReason):void{
  if(this.disposed)return;
  const index=this.retainedCheckouts.findIndex(value=>value.path===retainedPath);
  // A repeat retention replaces the entry so an existence check already running
  // cannot mistake the fresh notice for the record it captured.
  if(index>=0)this.retainedCheckouts[index]={path:retainedPath,projectId:project.id,taskTitle:task.title,reason};
  else this.retainedCheckouts.push({path:retainedPath,projectId:project.id,taskTitle:task.title,reason});
  this.armRetainedPrune();
  if(this.retainedCheckouts.length>20){
   const dropped=this.retainedCheckouts.shift();
   if(dropped)this.options.report?.(new KanbanError('RETAINED_CHECKOUT_DROPPED','The retained-checkout notice limit dropped an older path.',{path:dropped.path}));
  }
  this.markChanged();
 }
 /** Acknowledge retained checkouts the user dismissed; the directories themselves stay on disk. */
 private dismissRetainedCheckouts(paths:readonly string[]):void{
  if(this.disposed)return;
  const dismissed=new Set(paths);
  const kept=this.retainedCheckouts.filter(value=>!dismissed.has(value.path));
  if(kept.length===this.retainedCheckouts.length)return;
  this.retainedCheckouts.splice(0,this.retainedCheckouts.length,...kept);
  if(this.retainedCheckouts.length===0&&this.retainedPruneTimer!==undefined){clearTimeout(this.retainedPruneTimer);this.retainedPruneTimer=undefined;}
  this.markChanged();
 }
 /**
  * Start a retained-checkout existence check when one is due, otherwise keep a
  * periodic one armed. Either way the check runs off the awaited path, so a
  * snapshot never waits for the filesystem and an idle board still prunes.
  */
 private scheduleRetainedPrune():void{
  if(this.disposed||this.pruningRetained||this.retainedCheckoutPruneIntervalMs<0)return;
  if(this.retainedCheckouts.length===0)return;
  if(Date.now()-this.retainedPruneAt>=this.retainedCheckoutPruneIntervalMs){this.runRetainedPrune();return;}
  this.armRetainedPrune();
 }
 /** Arm the next periodic check; at most one timer exists while notices are retained. */
 private armRetainedPrune():void{
  if(this.disposed||this.pruningRetained||this.retainedPruneTimer!==undefined)return;
  if(this.retainedCheckouts.length===0)return;
  this.retainedPruneTimer=setTimeout(()=>{
   this.retainedPruneTimer=undefined;
   this.runRetainedPrune();
  },Math.max(this.retainedCheckoutPruneIntervalMs,0));
  this.retainedPruneTimer.unref?.();
 }
 /** Run one single-flight existence check, then re-arm while notices remain. */
 private runRetainedPrune():void{
  if(this.disposed||this.pruningRetained||this.retainedCheckouts.length===0)return;
  this.pruningRetained=true;
  this.retainedPruneAt=Date.now();
  // A microtask keeps the check off the snapshot's awaited path without a timer to clean up.
  this.retainedPrune=Promise.resolve().then(()=>this.pruneRetainedCheckouts()).catch(error=>{this.options.report?.(error);}).finally(()=>{this.pruningRetained=false;this.retainedPrune=undefined;this.armRetainedPrune();});
 }
 /**
  * Drop the retained notices whose directory is gone. The entries captured here
  * survive the check only by object identity, so a path recorded while the check
  * was running keeps its own notice.
  */
 private async pruneRetainedCheckouts():Promise<void>{
  if(this.disposed)return;
  const checked=new Set(this.retainedCheckouts);
  const missing=new Set<string>();
  for(const entry of checked){
   try{if(!await this.retainedCheckoutExists(entry.path))missing.add(entry.path);}
   catch{/* an unreadable path keeps its notice */}
  }
  if(this.disposed||missing.size===0)return;
  const kept=this.retainedCheckouts.filter(entry=>!(missing.has(entry.path)&&checked.has(entry)));
  if(kept.length===this.retainedCheckouts.length)return;
  this.retainedCheckouts.splice(0,this.retainedCheckouts.length,...kept);
  this.markChanged();
 }
 private attentionChanged():void{if(this.disposed)return;this.sequence++;this.publisher.request();this.publisher.flush();}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 private attentionTasks():AttentionTask[]{
  return this.locator.summaries().map(summary=>({id:summary.taskId,sessionIds:summary.sessionIds,closedSessionIds:summary.closedSessionIds,...(summary.autoModeEnabled?{priority:'active' as const}:{})}));
 }
 /**
  * Startup recovery: history-free repairs stay awaited, while the persisted question
  * projection is restored synchronously so an unanswered question still holds an
  * automatic advance. History replay and workspace reconciliation run in background.
  */
 async initialize():Promise<void>{
  const summaries=this.locator.summaries();
  for(const summary of summaries)for(const sessionId of summary.sessionIds)this.restoreQuestionProjection(sessionId);
  for(const summary of summaries){if(summary.hasPendingTransition)await this.repairInterruptedTransition(summary);}
  await this.worktrees.resumePending();
  await this.relocations.resumePending();
  await this.dispatchPending();
  this.scheduleStartupReconciliation(summaries);
 }
 /** Resolves when the background startup reconciliation and any retained checkout check have finished. */
 async whenSettled():Promise<void>{await this.startup.whenSettled();await this.retainedPrune;}
 private async repairInterruptedTransition(summary:TaskSummary):Promise<void>{
  const located=this.locator.byTask(summary.taskId);const task=located?.task;if(!located||!task)return;
  if(task.pendingTransition?.status==='sending')await this.hubStore(located.hubId).transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.status==='sending'){t.pendingTransition.status='failed';t.pendingTransition.error={code:'DELIVERY_UNCERTAIN',message:'A prior prompt admission was interrupted. Retry explicitly; the same native request identity will be reused.'};}});
  const p=task.pendingTransition;
  if(p?.status==='waiting'&&p.worktreeRequest&&!task.operation&&task.worktree?.status!=='ready'){try{await this.worktrees.request(task.id,{kind:'create',...p.worktreeRequest});}catch(error){await this.failPending(located.hubId,task.id,p.id,error);}}
 }
 private scheduleStartupReconciliation(summaries:readonly TaskSummary[]):void{
  const jobs:Array<()=>Promise<void>>=[];
  // Workspace provisioning and session-directory repair are background recovery;
  // the board must not wait for the workspace registry before its first snapshot.
  if(this.workspaceCoordinator)jobs.push(()=>this.workspaceCoordinator!.reconcile());
  for(const summary of summaries){
   for(const sessionId of summary.sessionIds)jobs.push(()=>this.prepareQuestions(sessionId));
   if(summary.instructionPending!==null)jobs.push(()=>this.reconcileTaskInstructionPending(summary.taskId));
  }
  this.startup.run(jobs);
 }
 private restoreQuestionProjection(sessionId:string):void{
  const record=this.options.questionStore?.load(sessionId);
  if(record===undefined)return;
  try{this.questions.restoreSession(record);}catch(error){this.options.report?.(error);}
 }
 async prepareQuestions(sessionId:string):Promise<void>{
  if(this.prepared.has(sessionId))return this.prepared.get(sessionId);
  const work=(async()=>{
   this.restoreQuestionProjection(sessionId);
   if(this.options.history){for(const event of await this.options.history(sessionId))if(isEvent(event))this.questions.apply(sessionId,event);}
   // A restored or replayed unanswered round changes the pending user work the
   // attention snapshot and the auto-mode hold derive from, without a live event.
   this.rederiveAttention(sessionId);
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
  // Dismissal consumes pending user work without a conversation event, so the derived
  // hold must be re-projected even when the task has no activity left to reconcile.
  this.rederiveAttention(sessionId,true);
  const existing=this.saveTimers.get(sessionId);
  if(existing!==undefined){clearTimeout(existing);this.saveTimers.delete(sessionId);}
  try{await this.persistSessionStrict(sessionId);}
  catch(error){
   this.questions.undismiss(sessionId,turns);
   this.rederiveAttention(sessionId,true);
   this.schedulePersist(sessionId);
   this.options.report?.(error);
   throw new KanbanError('STORAGE_SAVE_FAILED','The question dismissal could not be saved.');
  }
  return structuredClone([...this.questions.getRounds(sessionId)]);
 }
 observe(sessionId:string,event:unknown):void{
  if(this.disposed)return;
  const promptTime=userPromptTime(event);if(promptTime!==undefined)this.clearInstructionPending(sessionId,promptTime);
  const questionChanged=isEvent(event)&&this.questions.apply(sessionId,event);
  if(questionChanged)this.schedulePersist(sessionId);
  const taskRelevant=this.locator.hasSession(sessionId);
  if(taskRelevant)this.autoAdvance.observe(sessionId,event);
  if(taskRelevant)this.attention.touch(sessionId);
  if(taskRelevant&&!questionChanged)this.markChanged();
 }
 private clearInstructionPending(sessionId:string,time:number):void{
  const located=this.locator.bySession(sessionId);const task=located?.task;const marker=task?.instructionPending;
  if(!located||!task||!marker||marker.columnId!==task.columnId||marker.enteredAt>time)return;
  void this.hubStore(located.hubId).transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);const pending=current?.instructionPending;if(!current||!pending||pending.columnId!==current.columnId||pending.enteredAt>time)return;delete current.instructionPending;}).catch(error=>this.options.report?.(error));
 }
 private async reconcileTaskInstructionPending(taskId:string):Promise<void>{
  if(!this.options.history)return;
  const located=this.locator.byTask(taskId);if(!located)return;
  const task=located.task;const marker=task.instructionPending;if(!marker||marker.columnId!==task.columnId)return;
  let prompted=false;
  for(const sessionId of task.sessionIds){
   try{const events=await this.options.history(sessionId);if(events.some(event=>{const time=userPromptTime(event);return time!==undefined&&time>=marker.enteredAt;})){prompted=true;break;}}
   catch(error){this.options.report?.(error);}
  }
  if(prompted)await this.hubStore(located.hubId).transact(draft=>{const current=draft.tasks.find(value=>value.id===task.id);if(current?.instructionPending?.enteredAt===marker.enteredAt)delete current.instructionPending;});
 }
 activityChanged():void{if(this.disposed)return;this.attention.touch();this.markChanged();}
 /** The question-aware conversation facts shared by attention and scheduled archiving. */
 conversationFacts(sessionId:string):Promise<ConversationFacts>{return this.factsSource.read(sessionId);}
 /** The in-flight reasons one board reports: persisted task state plus the facts only the host can read. */
 private async boardActivity(hubId:string,boardId:string):Promise<readonly string[]>{
  const hub=this.hubs.requireHub(hubId);
  const tasks=hub.tasks.filter(task=>task.boardId===boardId);
  const reasons=new Set<string>();
  for(const task of tasks)for(const reason of persistedStageActivity(task))reasons.add(reason);
  const sessionIds=[...new Set(tasks.flatMap(task=>task.sessionIds))];
  for(const sessionId of sessionIds){
   let facts:ConversationFacts;
   try{facts=await this.factsSource.read(sessionId);}
   catch{continue;}
   const conversation=conversationStageActivity(facts);
   if(conversation.length>0){for(const reason of conversation)reasons.add(reason);break;}
  }
  return [...reasons];
 }
 sessionActivity(sessionId?:string):void{if(this.disposed)return;if(sessionId!==undefined&&!this.locator.hasSession(sessionId))return;this.attention.touch(sessionId);this.markChanged();}
 /**
  * One snapshot request. Presentation projects only resolved facts and schedules the
  * rest; an explicit refresh awaits only the conversations it was asked to re-read.
  */
 async snapshot(request:SnapshotRequest={},mode:'full'|'cache'='full'):Promise<FullHostSnapshot>{
  const tasks=this.attentionTasks();
  if(mode==='full'&&request.priorityTaskIds!==undefined&&request.priorityTaskIds.length>0){
   const wanted=new Set(request.priorityTaskIds);
   this.attention.prioritize(tasks.filter(task=>wanted.has(task.id)).flatMap(task=>task.sessionIds));
  }
  // The sequence belongs to this request: an older in-flight snapshot must not adopt a
  // newer revision just because it resolved later.
  let conversations:Record<string,ConversationFacts>;let sequence:number;
  if(mode==='cache'){sequence=this.sequence;conversations=this.attention.presentCache(tasks);}
  else if(request.refreshSessionIds!==undefined&&request.refreshSessionIds.length>0){sequence=++this.sequence;conversations=await this.attention.refresh(request.refreshSessionIds,tasks);}
  else{sequence=this.sequence;conversations=this.attention.present(tasks);}
  const parts=await this.assembler.assemble(conversations,{refreshAuth:request.refreshAuth===true,allowAuthRefresh:mode==='full'});
  const scheduleRuntime=this.scheduleRuntime?.runtime()??{};
  this.scheduleRetainedPrune();
  return {...parts,sequence,...(Object.keys(scheduleRuntime).length===0?{}:{scheduleRuntime}),...(this.retainedCheckouts.length===0?{}:{retainedCheckouts:this.retainedCheckouts.map(value=>({...value}))})};
 }
 /** Publish a new snapshot after publishing or authorization state changed outside a board command. */
 sharingChanged():void{this.assembler.invalidateAuth();this.assembler.invalidateSharing();this.markChanged();}
 /** Execute one publishing action, then reconcile automatic checks and return a fresh snapshot. */
 async sharingCommand(command:SharingCommand):Promise<FullHostSnapshot>{
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  if(isAuthorizationCommand(command)){
   const auth=this.options.sharingAuth;invariant(auth,'SHARING_UNAVAILABLE','Google Drive authorization is unavailable in this host.');
   await auth.command(command);
  }else{
   const sharing=this.options.sharing;invariant(sharing,'SHARING_UNAVAILABLE','Team settings are unavailable in this host.');
   await sharing.command(command);
  }
  this.options.scheduler?.sync();
  this.assembler.invalidateAuth();
  this.assembler.invalidateSharing();
  return this.snapshot({refreshAuth:true});
 }
 async branches(taskId:string):Promise<string[]>{const located=this.locatedTask(taskId);return this.git.branches(requireGitProject(located.project),located.task.sessionIds);}
 async worktreeDefault(taskId:string):Promise<WorktreeDefaults>{
  const located=this.locatedTask(taskId);return this.worktreeDefaultsFor(located.task);
 }
 private async worktreeDefaultsFor(task:HubTask):Promise<WorktreeDefaults>{
  const located=this.locator.byTask(task.id);invariant(located,'TASK_NOT_FOUND','Task does not exist.');
  const project=requireGitProject(located.project);const state=this.hubs.snapshot();const basePath=state.settings.worktreeBasePath;const slug=taskTitleSlug(task.title);
  const branches=await this.git.branches(project,task.sessionIds);const occupied=new Set<string>();
  for(const other of this.locator.summaries()){
   if(other.worktreePath)occupied.add(other.worktreePath);
   for(const pathValue of other.unclaimedWorktreePaths)occupied.add(pathValue);
   if(other.operationAttemptPath)occupied.add(other.operationAttemptPath);
   if(other.pendingWorktreePath)occupied.add(other.pendingWorktreePath);
  }
  for(let index=1;index<=100;index++){
   const branchName=index===1?slug:slug+'-'+index;if(branches.includes(branchName))continue;
   const pathValue=defaultWorktreeDestination({gitRootPath:project.gitRootPath,basePath,branchName});
   if(!pathValue)return {kind:'unavailable',reason:{code:'INVALID_WORKTREE_PATH',message:'The task title cannot be converted into a usable worktree path.'}};
   if(occupied.has(pathValue)||await pathExists(pathValue))continue;
   return {kind:'derived',branchName,path:pathValue,...(project.defaultBranch===undefined?{}:{sourceBranch:project.defaultBranch})};
  }
  return {kind:'unavailable',reason:{code:'WORKTREE_NAME_UNAVAILABLE',message:'Could not derive an available worktree name from the task title.'}};
 }
 async detectProject(pathValue:string):Promise<ProjectLocation>{const probe=this.options.probe;invariant(probe,'PROJECT_PROBE_UNAVAILABLE','Project detection is unavailable in this host.');return probe.inspect(pathValue);}
 async localDrive(request:LocalDriveRequest):Promise<LocalDriveResult>{
  const discovery=this.options.localDrive;invariant(discovery,'SHARING_UNAVAILABLE','Google Drive discovery is unavailable in this host.');
  return request.action==='roots'
   ? {action:'roots',discovery:request.refresh===true?await discovery.refresh():await discovery.roots()}
   : {action:'list',page:await discovery.browse(request.path)};
 }
 async assertExecutionContext(sessionId:string):Promise<void>{
  const located=this.locator.bySession(sessionId);if(!located)return;const task=located.task;const project=located.project;
  this.assertProjectRelocation(project,'running this task');
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
 /**
  * Prepare the conversation a cross-card message lands in: the first open
  * conversation, or a first conversation created after the default worktree when
  * the task has none. The whole preparation is serialized so a concurrent user
  * action cannot create a second conversation.
  */
 prepareMessageConversation(taskId:string):Promise<TaskMessagePreparation>{return this.serial(()=>this.prepareMessageConversationNow(taskId));}
 private async prepareMessageConversationNow(taskId:string):Promise<TaskMessagePreparation>{
  const located=this.locatedTask(taskId);const existing=firstOpenSessionId(located.task);
  if(existing!==undefined)return {sessionId:existing,createdConversation:false};
  const decision=worktreeDecision(located.task,located.project);
  invariant(decision!=='blocked','WORKTREE_BINDING_UNRESOLVED','Resolve the worktree binding in the Git section before messaging this task.');
  let createdWorktree:{path:string;branch:string}|undefined;
  if(decision==='create-default'){
   const defaults=await this.worktreeDefaultsFor(located.task);
   if(defaults.kind==='unavailable')throw new KanbanError(defaults.reason.code,defaults.reason.message,defaults.reason.details);
   await this.worktrees.request(located.task.id,{kind:'create',mode:'new',path:defaults.path,branchName:defaults.branchName,...(defaults.sourceBranch===undefined?{}:{sourceBranch:defaults.sourceBranch})});
   const current=this.locatedTask(taskId);
   createdWorktree=current.task.worktree?{path:current.task.worktree.path,branch:current.task.worktree.branch}:{path:defaults.path,branch:defaults.branchName};
  }
  // A concurrent path may have created a conversation while the worktree was prepared.
  const reopened=firstOpenSessionId(this.locatedTask(taskId).task);
  if(reopened!==undefined)return {sessionId:reopened,createdConversation:false,...(createdWorktree===undefined?{}:{createdWorktree})};
  const sessionId=(await this.createConversationNow(taskId,{ensureFirst:true})).sessionId;
  return {sessionId,createdConversation:true,...(createdWorktree===undefined?{}:{createdWorktree})};
 }
 /** The visible native workspace of one Hub project, provisioned on demand. */
 async ensureProjectWorkspace(hubId:string,projectId:string):Promise<string|undefined>{
  const project=this.hubStore(hubId).requireProject(projectId);
  return this.workspaceCoordinator?.ensureProject(hubId,project);
 }
 private async settings(input:BoardSettings,expectedRevision?:number):Promise<BoardSettings>{
  // One shared shape rule keeps the command path and the domain normalizer from diverging.
  const normalized=operations.normalizeSettings(input);const base=normalized.worktreeBasePath;
  if(base===undefined)return this.hubs.saveSettings({},expectedRevision);
  let resolved:string;try{resolved=await realpath(base);}catch{throw new KanbanError('INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.',{path:base});}
  invariant((await stat(resolved)).isDirectory(),'INVALID_WORKTREE_BASE_PATH','Worktree base path must be an existing directory.');
  return this.hubs.saveSettings({worktreeBasePath:resolved},expectedRevision);
 }
 private async project(input:ProjectInput):Promise<ProjectInput>{
  invariant(input.gitRootPath===undefined||typeof input.gitRootPath==='string','INVALID_INPUT','Git root must be text.');
  // One canonical resolution validates shape, existence, and alias resolution; the probe
  // decides the Git association instead of repeating the path checks.
  const projectPath=await resolveCanonicalPath(input.projectPath);
  invariant((await stat(projectPath)).isDirectory(),'INVALID_PROJECT_PATH','The project path must be an existing directory.');
  const requestedGitRoot=typeof input.gitRootPath==='string'&&input.gitRootPath.trim()?input.gitRootPath.trim():undefined;
  if(requestedGitRoot===undefined){const {gitRootPath:_gitRootPath,...rest}=input;return {...rest,projectPath};}
  const gitRootPath=await resolveCanonicalPath(requestedGitRoot);
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
 private assertContext(taskId:string):void{const task=this.locatedTask(taskId).task;invariant(!task.operation,'CONTEXT_OPERATION_PENDING','Resolve the task context operation before admitting another conversation or execution.');}
 /** A recorded project relocation owns every directory-changing action in its project. */
 private assertProjectRelocation(project:Project,action:string):void{invariant(!project.operation,'PROJECT_RELOCATING','Resolve the project relocation before '+action+'.');}
 /**
  * Put a new conversation on the model its board chose. A board default is a
  * convenience and never a gate: whatever the host answers, the conversation
  * someone asked for is still created, and the outcome rides on the receipt so
  * the client can say which model it actually starts on.
  */
 private async applyBoardDefaultModel(board:Board,sessionId:string):Promise<ConversationModelOutcome|undefined>{
  const models=this.options.models;
  const requested=resolveTaskConversationModel({boardModel:board.workflow.model});
  if(models===undefined||requested===undefined)return undefined;
  try{
   const outcome=await models.apply(sessionId,requested);
   return {requested,applied:outcome.applied,...(outcome.applied?{}:{reason:outcome.reason,...(outcome.inUse===undefined?{}:{inUse:outcome.inUse})})};
  }catch(error){
   // The port reports every refusal as an outcome, so this is a defect guard and
   // not a policy branch. Whatever it is, the conversation someone asked for is
   // still created and the fallback is still reported.
   this.options.report?.(error);
   return {requested,applied:false,reason:'failed'};
  }
 }
 private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.commandTail.then(run);this.commandTail=result.then(()=>undefined,()=>undefined);return result;}
 createConversation(taskId:string,options:{ensureFirst?:boolean}={}):Promise<string>{return this.serial(async()=>(await this.createConversationNow(taskId,options)).sessionId);}
 private async createConversationNow(taskId:string,options:{allowUndecided?:boolean;ensureFirst?:boolean}={}):Promise<CreatedConversation>{
  this.assertContext(taskId);const located=this.locatedTask(taskId);const store=this.hubs.hub(located.hubId);const before=located.task;const project=located.project;
  this.assertProjectRelocation(project,'creating a conversation');
  // A first-start request queued behind a message preparation must reuse the
  // conversation that preparation created; an explicit plus action never sets this.
  if(options.ensureFirst===true){const existing=firstOpenSessionId(before);if(existing!==undefined)return {sessionId:existing};}
  invariant(!(options.allowUndecided===true&&before.sessionIds.length===0&&unresolvedWorktreeBinding(before,project)),'WORKTREE_BINDING_UNRESOLVED','Resolve the worktree binding in the Git section before starting the first conversation.');
  invariant(options.allowUndecided===true||!requiresWorktreeDecision(before,project),'WORKTREE_DECISION_REQUIRED','Choose whether to create a worktree or continue in the base project before starting the first conversation.');
  const projectDirectory=requireProjectPath(project);const workspaceId=await this.workspaceCoordinator?.ensureTaskWorkspace(located.hubId,before,project);const id=await this.sessions.create(projectDirectory,workspaceId);
  try{
   if(before.effectiveCwd!==projectDirectory)await this.sessions.setDirectory(id,before.effectiveCwd);
   const model=await this.applyBoardDefaultModel(located.board,id);
   this.assertContext(taskId);const current=store.requireTask(taskId);invariant(current.effectiveCwd===before.effectiveCwd,'CONTEXT_CHANGED','Task directory changed while the conversation was being created.');await store.addSession(taskId,id);
   return {...(model===undefined?{}:{model}),sessionId:id};}
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
 startFirstExecution(taskId:string,request:{send:boolean;columnId:string;expectedEnteredAt?:number;expectedInstruction?:string}):Promise<{sessionId:string;sent:boolean}>{
  return this.serial(()=>this.startFirstExecutionNow(taskId,request));
 }
 /**
  * One serialized creation-and-start use case for agent-created cards. Reading the
  * board and the created entry inside the same serialization means a queued
  * workflow save cannot leave the tool deciding from a pre-create snapshot.
  */
 createTaskAndStart(input:NewTask&{hubId?:string},send:boolean):Promise<{task:HubTask;firstExecution:FirstExecutionOutcome}>{
  return this.serial(()=>this.createTaskAndStartNow(input,send));
 }
 private async createTaskAndStartNow(input:NewTask&{hubId?:string},send:boolean):Promise<{task:HubTask;firstExecution:FirstExecutionOutcome}>{
  const created=await this.createTaskNow(input);const located=this.locatedTask(created.id);const board=located.board;
  const initial=board.workflow.columns.find(column=>column.id===board.workflow.initialColumnId);
  const instruction=entryInstruction(initial);const marker=located.task.instructionPending;
  if(!send||initial===undefined||instruction===undefined||marker?.columnId!==initial.id){
   return {task:located.task,firstExecution:{status:'not-applicable'}};
  }
  try{
   await this.startFirstExecutionNow(created.id,{send:true,columnId:initial.id,expectedEnteredAt:marker.enteredAt,expectedInstruction:instruction});
   return {task:this.locatedTask(created.id).task,firstExecution:{status:'sent'}};
  }catch(error){
   return {task:this.locatedTask(created.id).task,firstExecution:{status:'failed',error:problem(error)}};
  }
 }
 /**
  * The one application entry for an automatic first execution. The preparation
  * creates the default worktree and the first conversation; `send` then dispatches
  * the stage instruction through the same admission as a user run action.
  */
 private async startFirstExecutionNow(taskId:string,request:{send:boolean;columnId:string;expectedEnteredAt?:number;expectedInstruction?:string}):Promise<{sessionId:string;sent:boolean;model?:ConversationModelOutcome}>{
  const located=this.locatedTask(taskId);const marker=located.task.instructionPending;
  invariant(located.task.columnId===request.columnId,'TASK_MOVED','The task moved to another stage. Review the current stage before starting its first execution.');
  invariant(marker!==undefined&&marker.columnId===request.columnId,'INSTRUCTION_ALREADY_RESOLVED','The stage entry is no longer unresolved.');
  const columnId=request.columnId;const instruction=entryInstruction(located.board.workflow.columns.find(column=>column.id===columnId));
  invariant(instruction!==undefined,'EMPTY_PROMPT','The stage has no entry instruction.');
  const expectedEnteredAt=request.expectedEnteredAt??marker.enteredAt;
  const prepared=await prepareFirstExecution({
   locate:value=>this.locatedTask(value),
   createWorktree:async(value,draft)=>{await this.worktrees.request(value,{kind:'create',...draft});},
   createConversation:value=>this.createConversationNow(value,{ensureFirst:true}),
  },{taskId,columnId,expectedEnteredAt,...(request.expectedInstruction===undefined?{}:{expectedInstruction:request.expectedInstruction})});
  if(!request.send)return {...prepared,sent:false};
  await admitStageInstruction(this.stageInstructionDeps(),{taskId,columnId,instruction,expectedEnteredAt,sessionId:prepared.sessionId});
  return {...prepared,sent:true};
 }
 saveNote(input:Extract<Command,{type:'note.save'}>){return this.serial(()=>this.saveNoteNow(input));}
 private async saveNoteNow(input:Extract<Command,{type:'note.save'}>) {invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');const located=this.locatedTask(input.taskId);return this.hubs.hub(located.hubId).saveNote(input.taskId,{id:input.noteId,content:input.content,tags:input.tags});}
 private async deleteNoteNow(input:Extract<Command,{type:'note.delete'}>) {invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');const located=this.locatedTask(input.taskId);return this.hubs.hub(located.hubId).deleteNote(input.taskId,input.noteId);}
 command(command:Command):Promise<FullHostSnapshot>{return this.serial(()=>this.execute(command));}
 /** The pause tools' port: run the command, then re-read the task it changed. */
 pauseTask(taskId:string,reason:string):Promise<LocatedTask>{return this.command({type:'task.pause',taskId,reason}).then(()=>this.locatedTask(taskId));}
 resumeTask(taskId:string):Promise<LocatedTask>{return this.command({type:'task.resume',taskId}).then(()=>this.locatedTask(taskId));}
 private async execute(command:Command):Promise<FullHostSnapshot>{
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  let commandReceipt:HostSnapshot['commandReceipt'];
  switch(command.type){
   case 'hub.create':{const hub=await this.hubs.createHub(command.name);commandReceipt={kind:'hub',id:hub.id};break;}
   case 'hub.rename':{await this.hubs.renameHub(command.hubId,command.name,command.expectedRevision);break;}
   case 'hub.delete':{
    invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the Hub and its task-free projects.');
    await this.hubs.deleteHub(command.hubId);
    try{await this.options.sharing?.removeHub(command.hubId);}catch(error){this.options.report?.(error);}
    this.options.scheduler?.sync();
    break;
   }
   case 'board.create':{const value=await this.boards.create({hubId:command.hubId,name:command.name},'never');commandReceipt={kind:'board',id:value.board.id};break;}
   case 'board.rename':{await this.boards.update({hubId:command.hubId,boardId:command.boardId,name:command.name,expectedRevision:command.expectedRevision},'never');break;}
   case 'board.delete':{await this.boards.remove({hubId:command.hubId,boardId:command.boardId,confirmed:command.confirmed,expectedRevision:command.expectedRevision,sharing:command.sharing},'never');break;}
   case 'board.workflow.save':await this.boards.saveWorkflow({hubId:command.hubId,boardId:command.boardId,yaml:command.yaml,expectedRevision:command.expectedRevision},'never');break;
   case 'board.stage.update':await this.boards.updateStage({hubId:command.hubId,boardId:command.boardId,stageId:command.stageId,patch:command.patch,expectedRevision:command.expectedRevision},'never');break;
   case 'board.projects.save':await this.boards.saveProjectScope({hubId:command.hubId,boardId:command.boardId,...(command.projectKeys===undefined?{}:{projectKeys:command.projectKeys}),...(command.expectedRevision===undefined?{}:{expectedRevision:command.expectedRevision})},'never');break;
   case 'project.save':{const store=this.hubStore(command.hubId);const state=this.hubs.requireHub(store.hubId);const existing=command.project.id===undefined?undefined:state.projects.find(project=>project.id===command.project.id);invariant(!existing?.operation,'PROJECT_BUSY','Resolve the recorded project relocation before saving the project.');const value=await store.saveProject(await this.project(command.project),command.expectedRevision);commandReceipt={kind:'project',id:value.id};break;}
   case 'project.relocate':{
    invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm the project relocation and its migration impact.');
    const store=this.hubStore(command.hubId);
    const found=this.hubs.findProject(command.project.id);invariant(found,'PROJECT_NOT_FOUND','Project does not exist.');invariant(found.hubId===store.hubId,'PROJECT_NOT_FOUND','Project does not exist in the selected Hub.');
    await this.relocations.request({...await this.project(command.project),id:command.project.id},command.expectedRevision);
    commandReceipt={kind:'project',id:command.project.id};
    break;
   }
   case 'project.relocationRetry':{const store=this.hubStore(command.hubId);const project=store.requireProject(command.projectId);invariant(project.id===command.projectId,'PROJECT_NOT_FOUND','Project does not exist in the selected Hub.');await this.relocations.retry(command.projectId);break;}
   case 'project.relocationCancel':{const store=this.hubStore(command.hubId);store.requireProject(command.projectId);await this.relocations.cancel(command.projectId);break;}
   case 'project.delete':{const store=this.hubStore(command.hubId);invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the project registration.');const project=store.requireProject(command.projectId);invariant(!project.operation,'PROJECT_BUSY','Resolve the project relocation before deleting the project.');await store.deleteProject(command.projectId,command.expectedRevision);break;}
   case 'settings.save':await this.settings(command.settings,command.expectedRevision);break;
   case 'task.create':{const value=await this.createTaskNow(command);commandReceipt={kind:'task',id:value.id};break;}
   case 'task.prepareFirstExecution':{const value=await this.startFirstExecutionNow(command.taskId,{send:false,columnId:command.columnId,expectedEnteredAt:command.expectedEnteredAt,...(command.expectedInstruction===undefined?{}:{expectedInstruction:command.expectedInstruction})});commandReceipt={kind:'conversation',id:value.sessionId,...(value.model===undefined?{}:{model:value.model})};break;}
   case 'task.edit':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).editTask(command.taskId,{...(command.title!==undefined?{title:command.title}:{}),...(command.description!==undefined?{description:command.description}:{})},command.expectedRevision);break;}
   case 'conversation.create':{const created=await this.createConversationNow(command.taskId,{ensureFirst:command.ensureFirst===true});commandReceipt={kind:'conversation',id:created.sessionId,...(created.model===undefined?{}:{model:created.model})};break;}
   case 'conversation.close':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).closeSession(command.taskId,command.sessionId);break;}
   case 'conversation.reopen':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).reopenSession(command.taskId,command.sessionId);break;}
   case 'note.save':{const value=await this.saveNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'note.delete':{const value=await this.deleteNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'task.delete':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm task data/worktree removal and native conversation archiving.');this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'delete');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'delete',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath,...(command.force===true?{force:true}:{})},{background:true});break;
   case 'worktree.create':this.assertContext(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'create',mode:command.mode,path:command.path,branchName:command.branchName,sourceBranch:command.sourceBranch});break;
   case 'worktree.attach':this.assertContext(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'attach',path:command.path});break;
   case 'worktree.dismiss':{this.assertContext(command.taskId);const located=this.locatedTask(command.taskId);invariant(isGitProject(located.project),'PROJECT_NOT_GIT','Worktree choices require a Git-backed project.');invariant(!located.task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');invariant(!located.task.worktree,'WORKTREE_EXISTS','The task already has a worktree.');if(located.task.worktreeDismissed!==true)await this.hubs.hub(located.hubId).dismissWorktree(command.taskId);break;}
   case 'worktree.remove':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm removal of the worktree while preserving the task and branch.');this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'remove');await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'remove',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath,...(command.force===true?{force:true}:{})},{background:true});break;
   case 'operation.retry':{
    const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const task=located.task;this.assertProjectRelocation(located.project,'retrying a context operation');if(task.operation){await this.worktrees.retry(command.taskId,{background:true});const current=store.snapshot().tasks.find(t=>t.id===command.taskId);if(current&&!current.operation&&current.pendingTransition?.worktreeRequest&&current.pendingTransition.status==='failed')await store.transact(d=>{const p=d.tasks.find(t=>t.id===command.taskId)!.pendingTransition!;p.status='waiting';delete p.error;});}else if(task.pendingTransition){await store.transact(d=>{const t=d.tasks.find(t=>t.id===command.taskId)!;if(t.pendingTransition){t.pendingTransition.status='waiting';delete t.pendingTransition.error;}});}await this.dispatchPending();break;
   }
   case 'operation.return':this.assertProjectRelocation(this.locatedTask(command.taskId).project,'returning to the base project');await this.clearPending(command.taskId);await this.worktrees.returnToBase(command.taskId);break;
   case 'operation.dismiss':await this.dismissFailedAdvance(command.taskId);break;
   case 'retainedCheckout.dismiss':this.dismissRetainedCheckouts(command.paths);break;
   case 'task.move':await this.move(command);break;
   // Changing the setting forgets a turn that has not settled yet, so enabling — or
   // resuming a paused task — never advances a turn that ended before the change.
   case 'task.autoMode':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).setAutoMode(command.taskId,command.enabled);this.autoAdvance.forget(command.taskId);break;}
   case 'task.recordTransition':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).recordTransition(command.taskId,command.columnId);break;}
   case 'task.pause':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).pauseTask(command.taskId,command.reason);this.autoAdvance.forget(command.taskId);break;}
   case 'task.resume':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).resumeTask(command.taskId);this.autoAdvance.forget(command.taskId);break;}
   case 'task.runInstruction':await this.runInstruction(command);break;
   case 'schedule.save':{
    const store=this.hubStore(command.hubId);
    const saved=await store.saveSchedule({...(command.scheduleId===undefined?{}:{id:command.scheduleId}),title:command.title,prompt:command.prompt,cron:command.cron,timeZone:command.timeZone,projectId:command.projectId,...(command.model===undefined?{}:{model:command.model}),newConversation:command.newConversation,archiveWhenIdle:command.archiveWhenIdle},command.expectedRevision);
    commandReceipt={kind:'schedule',id:saved.id};
    break;
   }
   case 'schedule.delete':{
    invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the schedule.');
    const store=this.hubStore(command.hubId);
    store.requireSchedule(command.scheduleId);
    const removed=await store.deleteSchedule(command.scheduleId,command.expectedRevision);
    await this.scheduleRuntime?.scheduleDeleted(removed.id);
    break;
   }
   case 'schedule.setEnabled':{const store=this.hubStore(command.hubId);await store.setScheduleEnabled(command.scheduleId,command.enabled,command.expectedRevision);break;}
   case 'schedule.runNow':{const store=this.hubStore(command.hubId);store.requireSchedule(command.scheduleId);await this.requireScheduleRuntime().runNow(store.hubId,command.scheduleId);break;}
  }
  await this.dispatchPending();const snapshot=await this.snapshot({},'cache');return {...snapshot,...(commandReceipt?{commandReceipt}:{})};
 }
 /**
  * The in-memory command guard. It runs before any pending transition is cleared,
  * so a rejected command never discards confirmed workflow state; the queued
  * admission re-checks the same persisted binding before it enqueues.
  */
 private assertDestructiveTarget(taskId:string,expected:string|null,kind:'delete'|'remove'):void{
  const task=this.locatedTask(taskId).task;
  invariant(bindingMatches(task,expected),'WORKTREE_CHANGED','The worktree changed since this confirmation was displayed.');
  const operation=task.operation;
  if(!operation)return;
  const sameFailed=operation.phase==='failed'&&operation.request.kind===kind;
  // An explicit deletion may discard a failed operation that left no unclaimed create
  // attempt and did not start archiving; the deletion owns the checkout binding and
  // retains anything it cannot verify.
  const replaceable=kind==='delete'&&replaceableByDeletion(operation);
  invariant(sameFailed||replaceable,'CONTEXT_OPERATION_PENDING','Resolve the existing context operation before replacing its intent.');
 }
 private async clearPending(taskId:string):Promise<void>{const located=this.locatedTask(taskId);const task=located.task;invariant(task.pendingTransition?.status!=='sending','EXECUTION_ADMISSION_PENDING','Wait until native prompt admission completes.');if(task.pendingTransition)await this.hubs.hub(located.hubId).transact(d=>{delete d.tasks.find(t=>t.id===taskId)!.pendingTransition;});}
 private stageInstructionDeps():StageInstructionDeps{
  return {
   locate:taskId=>{const located=this.locatedTask(taskId);return {hubId:located.hubId,task:located.task,board:located.board};},
   transact:(hubId,change)=>this.hubs.hub(hubId).transact(change),
   resolveSession:async task=>firstOpenSessionId(task)??(await this.createConversationNow(task.id,{allowUndecided:true})).sessionId,
   assertExecutionContext:sessionId=>this.assertExecutionContext(sessionId),
   deliver:(sessionId,delivery)=>this.sessions.deliverStageInstruction(sessionId,delivery),
  };
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
  this.assertContext(command.taskId);
  this.assertProjectRelocation(this.locatedTask(command.taskId).project,'running a stage instruction');
  const pending=this.locatedTask(command.taskId).task.pendingTransition;
  invariant(!pending||(pending.origin==='auto'&&pending.status==='failed'),'TASK_BUSY','Resolve the confirmed transition first.');
  await admitStageInstruction(this.stageInstructionDeps(),{
   taskId:command.taskId,columnId:command.columnId,instruction:command.expectedInstruction,reviewedInstruction:command.expectedInstruction,expectedEnteredAt:command.expectedEnteredAt,
  });
 }
 private admitAutoAdvance(taskId:string,plan:AutoAdvancePlan,isCurrent:()=>boolean):Promise<void>{
  // The drain shares the command lane, so a pause or resume queued ahead of this
  // admission must still win: the settle's own generation decides.
  return this.serial(()=>isCurrent()?this.admitAutoAdvanceNow(taskId,plan):Promise.resolve());
 }
 /** The serialized adapter around the one automatic-advance admission path. */
 private admitAutoAdvanceNow(taskId:string,plan:AutoAdvancePlan):Promise<void>{
  return admitAutoAdvance({
   locate:taskId=>this.locatedTask(taskId),
   transact:(hubId,change)=>this.hubs.hub(hubId).transact(change),
   resolveSession:async task=>firstOpenSessionId(task)??(await this.createConversationNow(task.id,{allowUndecided:true})).sessionId,
   pending:task=>readPendingUserWork(this.factsSource,task.sessionIds),
   dispatch:()=>this.dispatchPending(),
   report:error=>this.options.report?.(error),
  },taskId,plan);
 }
 private async dismissFailedAdvance(taskId:string):Promise<void>{
  const located=this.locatedTask(taskId);const pending=located.task.pendingTransition;
  invariant(!located.task.operation,'CONTEXT_OPERATION_PENDING','Resolve the context operation before dismissing an automatic advance.');
  invariant(pending?.origin==='auto','INVALID_TARGET','Only an automatic advance can be dismissed.');
  invariant(pending.status==='failed','TASK_BUSY','Only a failed automatic advance can be dismissed.');
  await this.hubs.hub(located.hubId).transact(d=>{const value=d.tasks.find(candidate=>candidate.id===taskId);if(value?.pendingTransition?.origin==='auto'&&value.pendingTransition.status==='failed')delete value.pendingTransition;});
 }
 private async pauseAutoMode(taskId:string,reason:AutoModePauseReason,message:string|undefined,expectedColumnId:string):Promise<void>{
  const located=this.locatedTask(taskId);
  await this.hubs.hub(located.hubId).pauseAutoMode(taskId,{reason,at:new Date().toISOString(),...(message!==undefined?{message}:{})},expectedColumnId);
 }
 private async failPending(hubId:string,taskId:string,id:string,error:unknown):Promise<void>{await this.hubs.hub(hubId).transact(d=>{const t=d.tasks.find(t=>t.id===taskId);if(t?.pendingTransition?.id===id){t.pendingTransition.status='failed';t.pendingTransition.error=problem(error);}});}
 private dispatchPending():Promise<void>{
  if(this.disposed)return Promise.resolve();
  this.pendingTransitions.refresh(this.locator.summaries());
  if(this.pendingTransitions.empty&&this.drivePromise===undefined)return Promise.resolve();
  if(this.drivePromise){this.driveAgain=true;return this.drivePromise;}
  const running=Promise.resolve().then(()=>this.drainPending());
  this.drivePromise=running.finally(()=>{this.drivePromise=undefined;});
  return this.drivePromise;
 }
 private async drainPending():Promise<void>{
  if(this.disposed)return;if(this.driving){this.driveAgain=true;return;}this.driving=true;
  try{do{this.driveAgain=false;this.pendingTransitions.refresh(this.locator.summaries());for(const taskId of [...this.pendingTransitions.list()]){const located=this.locator.byTask(taskId);const task=located?.task;const pending=task?.pendingTransition;if(!located||!task||!pending||pending.status!=='waiting'||task.operation||(pending.worktreeRequest&&task.worktree?.status!=='ready'))continue;const store=this.hubs.hub(located.hubId);
   try{
    await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(t.pendingTransition?.id===pending.id&&!t.operation,'REVISION_CONFLICT','Task context changed during transition.');invariant(t.columnId===pending.fromColumnId||t.columnId===pending.columnId,'REVISION_CONFLICT','Task column changed during transition.');const board=d.boards.find(b=>b.id===t.boardId)!;if(t.columnId!==pending.columnId)invariant(pending.transitionOverride===true||canTransition(board.workflow,t.columnId,pending.columnId),'TRANSITION_NOT_ALLOWED','The workflow no longer permits this transition.');operations.placeTask(d,t.id,pending.columnId,placementFromAnchor(pending.beforeTaskId),nextEnteredAt(),{retainAgentPause:pending.origin==='auto'});if(pending.mode==='run')t.pendingTransition.status='sending';else delete t.pendingTransition;});if(pending.origin!=='auto')this.autoAdvance.forget(task.id);
    if(pending.mode==='run'){
     invariant(pending.sessionId&&pending.text,'INVALID_TARGET','Confirmed execution is missing its target or instruction.');
     await admitStageInstruction(this.stageInstructionDeps(),{taskId:task.id,columnId:pending.columnId,instruction:pending.text,sessionId:pending.sessionId,requestId:pending.id});
     await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.id===pending.id)delete t.pendingTransition;});
    }
   }catch(error){await this.failPending(located.hubId,task.id,pending.id,error);this.options.report?.(error);}
  }}while(this.driveAgain&&!this.disposed);}finally{this.driving=false;}
 }
 async close():Promise<void>{
  if(this.disposed)return;
  // Let the background reconciliation finish (or abort) before flushing question
  // persistence, so no replay can schedule a write after the final flush.
  this.startup.dispose();await this.startup.whenSettled();
  if(this.retainedPruneTimer!==undefined){clearTimeout(this.retainedPruneTimer);this.retainedPruneTimer=undefined;}
  await this.retainedPrune;
  // The settling prune re-arms while the host is still open; close clears that one too.
  if(this.retainedPruneTimer!==undefined){clearTimeout(this.retainedPruneTimer);this.retainedPruneTimer=undefined;}
  await this.flushQuestions();this.publisher.flush();this.disposed=true;this.publisher.dispose();this.attention.dispose();this.autoAdvance.dispose();for(const dispose of this.disposers)dispose();this.listeners.clear();this.worktrees.dispose();this.relocations.dispose();this.operationQueue.dispose();await this.commandTail;await this.drivePromise?.catch(error=>this.options.report?.(error));this.questions.dispose();await this.relocations.settle();}
}
