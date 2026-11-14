import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { canTransition, transitionAccess } from '../domain/transitions.js';
import { resolveTaskConversationModel } from '../domain/model-preference.js';
import type { SessionModelPort } from './session-model.js';
import { conversationStageActivity, persistedStageActivity } from '../shared/stage-activity.js';
import { openSessionIds } from '../shared/conversations.js';
import { aggregateTaskActivity, UNAVAILABLE_TASK_ACTIVITY, type TaskActivity, type TaskActivityOptions, type TaskActivityScope } from '../domain/task-activity.js';
import { entryInstruction, nextEnteredAt } from '../domain/stage-entry.js';
import { placementFromAnchor } from '../domain/placement.js';
import { TURN_ADVANCE_SETTLE_MS, TurnAdvanceCoordinator } from './turn-advance.js';
import type { AutoAdvancePlan } from '../domain/auto-advance.js';
import { admitTurnAdvance } from './advance-admission.js';
import { readPendingUserWork, withQuestionPending } from './pending-source.js';
import type { ConversationFactsSource } from './native-facts.js';
import type { AdvanceOrigin, AutoModePauseReason, Board, BoardSettings, Command, ConversationFacts, ConversationModelOutcome, FirstExecutionOutcome, FullHostSnapshot, HostSnapshot, HubState, HubTask, LocalDriveRequest, LocalDriveResult, NewTask, PendingTransition, Project, ProjectInput, ProjectLocation, QuestionDraftContent, QuestionRound, RetainedCheckout, RetainedCheckoutReason, SharingCommand, SnapshotRequest, StoredQuestionDraft, Task, WorktreeDefaults } from '../shared/types.js';
import type { TaskMessagePreparation } from '../shared/task-message.js';
import type { StageEntryOrigin } from '../shared/task-history.js';
import type { GitPort, ProjectProbe, SessionPort, WorkspacePort } from '../shared/ports.js';
import type { QuestionDraftStore, QuestionStore } from './question-storage.js';
import { QuestionDraftContentSchema } from '../remote.js';
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
import { BoardAdministration, type BoardRevisionPort, type BoardSharingPort } from './board-administration.js';
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
import type { DeterministicRuntime } from './deterministic/ports.js';
import type { DeterministicStageReview, DeterministicSummary } from '../shared/deterministic.js';
import { DeterministicSupervisor } from './deterministic-supervisor.js';
import { createNativeSupervisorPorts } from './deterministic-control.js';
import { DeterministicApprovalService } from './deterministic-approval.js';
import { createDeterministicRouter } from './deterministic-routing.js';
import { createDeterministicImpact } from './deterministic-impact.js';
import { deterministicEqual } from '../domain/deterministic-definition.js';
import { declaredParameterNames, validateParameterValues } from '../domain/deterministic-parameters.js';
import { ensureLocalStageIdentity } from '../domain/deterministic-state.js';
import { recordDeterministicHandoff } from '../domain/task-history/record.js';

async function pathExists(value:string):Promise<boolean>{try{await lstat(value);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function isEvent(value:unknown):value is {type:string;seq:number;data:unknown}{return Boolean(value&&typeof value==='object'&&'type'in value&&typeof value.type==='string'&&'seq'in value&&typeof value.seq==='number'&&Number.isSafeInteger(value.seq)&&'data'in value);}
function userPromptTime(event:unknown):number|undefined{
 if(!isEvent(event)||event.type!=='user/message')return undefined;
 const source=(event.data as {source?:{kind?:unknown}}|null)?.source;
 if(source?.kind!=='user')return undefined;
 const time=(event as {time?:unknown}).time;
 return typeof time==='number'&&Number.isFinite(time)?time:Date.now();
}
/** Draft records kept by recency; draft retention never depends on age. */
export const QUESTION_DRAFT_RETENTION=100;
/** Coalescing window for pruning drafts whose round just ended. */
export const QUESTION_DRAFT_PRUNE_MS=500;
function boardSharingPort(sharing:HubSharingService):BoardSharingPort{
 return {
  view:hubId=>sharing.view(hubId),
  isBound:(hubId,boardId)=>sharing.isBound(hubId,boardId),
  noteLocalChange:hubId=>sharing.noteLocalChange(hubId),
  removeBoard:(hubId,boardId,scope,name)=>sharing.removeBoard(hubId,boardId,scope,name),
  publishBoard:(hubId,boardId)=>sharing.publishBoard(hubId,boardId),
  publishAll:hubId=>sharing.publishAll(hubId),
 };
}
/** One created conversation and, when its board named a default model, how that model fared. */
export interface CreatedConversation { sessionId: string; model?: ConversationModelOutcome }
export interface AppOptions { history?: (sessionId:string)=>Promise<readonly unknown[]>; signal?:AbortSignal; report?:(error:unknown)=>void; /** Records each accepted workflow write; absent keeps no local history. */ revisions?:BoardRevisionPort; questionStore?:QuestionStore; questionDraftStore?:QuestionDraftStore; probe?:ProjectProbe; /** Applies a board's default model to one conversation; absent means no board model is applied. */ models?:SessionModelPort; sharing?:HubSharingService; sharingAuth?:GoogleDriveAuthCoordinator; localDrive?:GoogleDriveLocalDiscovery; scheduler?:SharingPollScheduler; teamFiles?:TeamFiles; /** Whether a retained checkout directory still exists; defaults to a filesystem check. */ retainedCheckoutExists?:(path:string)=>Promise<boolean>; /** How long to wait between retained-checkout existence checks. */ retainedCheckoutPruneIntervalMs?:number }
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
 /** Conversations whose task was deleted; replay and persistence must never resurrect them. */
 private readonly forgottenSessions=new Set<string>();
 private readonly attention:AttentionCoordinator;
 private readonly assembler:SnapshotAssembler;
 private readonly pendingTransitions=new PendingTransitionIndex();
 private readonly startup:StartupReconciler;
 private readonly pendingWork:PendingWorkRunner;
 private readonly publisher=new PublishScheduler({publish:()=>this.changed()});
 private readonly disposers:Array<()=>void>=[];
 private sequence=0; private disposed=false; private driving=false; private driveAgain=false; private drivePromise:Promise<void>|undefined; private commandTail:Promise<void>=Promise.resolve();
 private readonly saveTimers=new Map<string,ReturnType<typeof setTimeout>>();
 private readonly draftWrites=new Map<string,Promise<void>>();
 private readonly draftPruneTimers=new Map<string,ReturnType<typeof setTimeout>>();
 private retentionPrune:Promise<void>|undefined;
 /** Transient, in-memory retention notices; the checkout itself lives on disk. */
 private readonly retainedCheckouts:RetainedCheckout[]=[];
 private readonly retainedCheckoutExists:(path:string)=>Promise<boolean>;
 private readonly retainedCheckoutPruneIntervalMs:number;
 private retainedPruneAt=0;
 private retainedPrune:Promise<void>|undefined;
 private retainedPruneTimer:ReturnType<typeof setTimeout>|undefined;
 private pruningRetained=false;
 private readonly turnAdvance:TurnAdvanceCoordinator;
 /** The one conversation-fact read every host consumer shares; the question projection is folded in here. */
 private readonly factsSource:ConversationFactsSource;
 private readonly workspaceCoordinator?:WorkspaceCoordinator;
 private scheduleRuntime:ScheduleRuntimePort|undefined;
 private deterministicRuntime:DeterministicSupervisor|undefined;
 private deterministicApproval:DeterministicApprovalService|undefined;
 /** The native runtime a write report asks for the fingerprint of a proposed executable. */
 private nativeDeterministic:DeterministicRuntime|undefined;
 private initialized=false;
 private closing=false;
 private readonly handoffAdmissions=new Map<string,{entryId:string;deliveryId:string}>();
 private readonly contextAdmissions=new Set<string>();
 private readonly handoffDeliveries=new Map<string,Promise<void>>();
 constructor(readonly hubs:HubRepository,readonly sessions:SessionPort,readonly git:GitPort,private readonly options:AppOptions={},private readonly workspaces?:WorkspacePort){
  this.locator=new TaskLocator(hubs);
  this.retainedCheckoutExists=options.retainedCheckoutExists??entryExists;
  this.retainedCheckoutPruneIntervalMs=options.retainedCheckoutPruneIntervalMs??15000;
  if(options.teamFiles)this.teamFiles=options.teamFiles;
  this.boards=new BoardAdministration({hubs,...(options.sharing?{sharing:boardSharingPort(options.sharing)}:{}),...(options.report?{report:options.report}:{}),activity:{inFlight:(hubId,boardId)=>this.boardActivity(hubId,boardId)},impact:createDeterministicImpact(()=>this.nativeDeterministic),...(options.revisions?{revisions:options.revisions}:{})});
  this.factsSource=withQuestionPending({read:id=>this.sessions.facts(id)},this.questions);
  if(workspaces)this.workspaceCoordinator=new WorkspaceCoordinator({
   workspaces,sessions,store:{
    all:()=>this.locator.all().map(located=>({hubId:located.hubId,task:located.task,project:located.project})),
    setProjectWorkspace:async(hubId,projectId,workspaceId,owned)=>{await this.hubs.hub(hubId).setProjectWorkspace(projectId,workspaceId,owned);},
    setTaskWorktreeWorkspace:async(hubId,taskId,workspaceId,owned)=>{await this.hubs.hub(hubId).setTaskWorktreeWorkspace(taskId,workspaceId,owned);},
   },
   ...(options.report?{report:options.report}:{}),
  });
  this.worktrees=new WorktreeCoordinator(new RepositoryWorktreeStore(hubs),sessions,git,{signal:options.signal,queue:this.operationQueue,worktreeDefaults:{derive:async taskId=>this.worktreeDefaultsFor(this.locatedTask(taskId).task)},onTaskDeleted:async task=>{try{await this.workspaceCoordinator?.cleanup(task as HubTask);await this.deterministicRuntime?.collectSources();}catch(error){this.options.report?.(error);}await this.removeConversationQuestionState(task.sessionIds);},onCheckoutRetained:(task,project,retainedPath,reason)=>this.retainCheckout(task,project,retainedPath,reason)});
  this.relocations=new ProjectRelocationCoordinator(new RepositoryProjectRelocationStore(hubs),sessions,git,{queue:this.operationQueue,signal:options.signal,...(this.workspaceCoordinator?{workspaces:{bind:async(hubId,project)=>{await this.workspaceCoordinator!.rebindProject(hubId,project);}}}:{}),...(options.report?{report:options.report}:{})});
  this.pendingWork=new PendingWorkRunner({resumeWorktrees:async()=>{await this.worktrees.resumePending();},resumeRelocations:async()=>{await this.relocations.resumePending();},dispatchPending:async()=>{await this.dispatchPending();},report:error=>this.options.report?.(error)});
  this.attention=new AttentionCoordinator({source:this.factsSource,tasks:()=>this.attentionTasks(),runPendingWork:async()=>{await this.pendingWork.run();},onChange:changedSessionIds=>this.attentionChanged(changedSessionIds),onFacts:()=>this.markChanged(),report:error=>this.options.report?.(error)});
  this.turnAdvance=new TurnAdvanceCoordinator({
   locateBySession:sessionId=>{const located=this.locator.bySession(sessionId);return located?{task:located.task,board:located.board}:undefined;},
   locate:taskId=>{const located=this.locator.byTask(taskId);return located?{task:located.task,board:located.board}:undefined;},
   facts:sessionId=>this.factsSource.read(sessionId),
   admit:(taskId,plan,origin,isCurrent)=>this.admitTurnAdvance(taskId,plan,origin,isCurrent),
   pause:(taskId,reason,message,expectedColumnId)=>this.pauseAutoMode(taskId,reason,message,expectedColumnId),
   schedule:callback=>setTimeout(callback,TURN_ADVANCE_SETTLE_MS),
   cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
   report:error=>this.options.report?.(error),
  });
  this.assembler=new SnapshotAssembler({hubs,onChange:()=>this.markChanged(),...(options.report===undefined?{}:{report:options.report}),...(options.sharing===undefined?{}:{sharing:()=>options.sharing!.views()}),...(options.sharingAuth===undefined?{}:{sharingAuth:options.sharingAuth})});
  this.startup=new StartupReconciler({...(options.signal===undefined?{}:{signal:options.signal}),...(options.report===undefined?{}:{report:options.report})});
  this.pendingTransitions.refresh(this.locator.summaries());
  this.disposers.push(hubs.subscribe(()=>{if(this.initialized)this.deterministicRuntime?.sync();this.assembler.invalidateState();this.pendingTransitions.refresh(this.locator.summaries());this.markChanged();void this.dispatchPending().catch(error=>options.report?.(error));void this.dispatchDeterministicHandoffs().catch(error=>options.report?.(error));}));
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
 /** Attach isolated execution after composition; task records remain the only authority. */
 attachDeterministicRuntime(nativeRuntime:DeterministicRuntime):()=>Promise<void>{
  this.nativeDeterministic=nativeRuntime;
  const route=createDeterministicRouter({hubs:this.hubs,sessions:this.sessions,pending:task=>readPendingUserWork(this.factsSource,task.sessionIds),reserved:id=>this.handoffAdmissions.has(id)||this.contextAdmissions.has(id),notify:()=>{void this.dispatchDeterministicHandoffs().catch(error=>this.options.report?.(error));}});
  const transact=<T>(taskId:string,change:(task:HubTask,located:LocatedTask)=>T):Promise<T>=>{
   const found=this.locatedTask(taskId);
   return this.hubs.hub(found.hubId).transact(draft=>{const task=draft.tasks.find(value=>value.id===taskId);invariant(task,'TASK_NOT_FOUND','The task no longer exists.');const board=draft.boards.find(value=>value.id===task.boardId)!;const project=draft.projects.find(value=>value.id===task.projectId)!;return change(task,{hubId:draft.id,hub:draft,board,project,task});});
  };
  this.deterministicRuntime=new DeterministicSupervisor(createNativeSupervisorPorts({nativeRuntime,
   locate:id=>this.locator.byTask(id),all:()=>this.locator.all(),transact,
   route,canStart:id=>!this.contextAdmissions.has(id),report:error=>this.options.report?.(error),notify:()=>this.markChanged(),id:()=>randomUUID(),now:()=>new Date().toISOString(),
  }));
  const attached=this.deterministicRuntime;
  const approval=new DeterministicApprovalService({runtime:()=>this.nativeDeterministic,findBoard:boardId=>this.hubs.findBoard(boardId),locate:taskId=>this.locator.byTask(taskId),all:()=>this.locator.all(),transact,wake:filter=>this.deterministicRuntime?.wakeWaiting(filter)});
  this.deterministicApproval=approval;
  if(this.initialized){
    // Late native attachment: normalize legacy captures before supervision starts.
    void this.migrateDeterministicCaptures().then(
      ()=>{if(!this.disposed&&this.deterministicRuntime===attached)attached.start();this.markChanged();},
      error=>{this.options.report?.(error);if(!this.disposed&&this.deterministicRuntime===attached)attached.start();},
    );
  }
  this.markChanged();
  return async()=>{attached.dispose();await attached.settle();if(this.deterministicRuntime===attached){this.deterministicRuntime=undefined;if(this.deterministicApproval===approval)this.deterministicApproval=undefined;if(this.nativeDeterministic===nativeRuntime)this.nativeDeterministic=undefined;this.markChanged();}};
 }
 private requireApproval():DeterministicApprovalService{invariant(this.deterministicApproval,'DETERMINISTIC_UNAVAILABLE','This host does not expose isolated deterministic execution.');return this.deterministicApproval;}
 private requireDeterministic():DeterministicSupervisor{invariant(this.deterministicRuntime,'DETERMINISTIC_UNAVAILABLE','This host does not expose isolated deterministic execution.');return this.deterministicRuntime;}
 private async ensureDeterministicEntry(taskId:string):Promise<HubTask>{
  const found=this.locatedTask(taskId);if(found.task.stageEntry)return found.task;
  await this.hubs.hub(found.hubId).transact(hub=>{const task=hub.tasks.find(value=>value.id===taskId)!;if(task.stageEntry)return;const board=hub.boards.find(value=>value.id===task.boardId)!;
   const stageIdentity=ensureLocalStageIdentity(board,task.columnId,()=>randomUUID());
   task.stageEntry={id:randomUUID(),columnId:task.columnId,stageIdentity,enteredAt:task.createdAt};
  });return this.locatedTask(taskId).task;
 }
 async deterministicReview(request:{boardId?:string;stageId?:string;taskId?:string}|string):Promise<DeterministicStageReview>{
  if(typeof request==='string'){
   const located=this.locatedTask(request);
   return this.requireApproval().review({boardId:located.board.id,stageId:located.task.columnId,taskId:request});
  }
  if(request.taskId!==undefined&&(request.boardId===undefined||request.stageId===undefined)){
   const located=this.locatedTask(request.taskId);
   return this.requireApproval().review({boardId:located.board.id,stageId:located.task.columnId,taskId:request.taskId});
  }
  invariant(request.boardId!==undefined&&request.stageId!==undefined,'BOARD_NOT_FOUND','The board does not exist.');
  return this.requireApproval().review({boardId:request.boardId,stageId:request.stageId,...(request.taskId===undefined?{}:{taskId:request.taskId})});
 }
 async deterministicVariables(taskId:string):Promise<{env:string[];variables:Array<{name:string;configured:boolean}>}>{
  return this.requireApproval().variables(taskId);
 }
 private deterministicSummaries():Record<string,DeterministicSummary>{
  const result:Record<string,DeterministicSummary>={};
  for(const {task,board} of this.locator.all()){
   const value=task.deterministic;if(!value||task.stageEntry?.id!==value.entryId)continue;
   const saved=board.workflow.columns.find(column=>column.id===task.columnId)?.deterministic;
   const unavailable=!this.deterministicRuntime;
   result[task.id]={entryId:value.entryId,executionId:value.executionId,phase:unavailable?'failed':value.phase,startedAt:value.startedAt,attempt:value.attempt,restartCount:value.restartCount,...(value.parameters===undefined?{}:{parameters:{...value.parameters}}),
    ...(unavailable?{error:{code:'DETERMINISTIC_UNAVAILABLE',message:'Mount the native filesystem, sandbox, shell, and function-body TypeScript capabilities to run deterministic steps.'}}:value.error?{error:value.error}:{}),...(value.result?{exit:value.result.exit,message:value.result.message,...(value.result.deliveryStatus?{deliveryStatus:value.result.deliveryStatus}:{})}:{}),...(value.hold===undefined?{}:{hold:value.hold}),...(value.capture?{fingerprint:value.capture.fingerprint}:{}),savedVersionChanged:!saved||!deterministicEqual(saved,value.definition)};
  }return result;
 }
 private assertNoHandoffAdmission(taskId:string):void{invariant(!this.handoffAdmissions.has(taskId),'NATIVE_ADMISSION_PENDING','Wait for native context admission before moving this task or changing its directory.');}
 /** Reserve only native context admission, never an agent turn or the global command lane. */
 reserveDeterministicHandoff(taskId:string,entryId:string,deliveryId:string):()=>void{
  const task=this.locatedTask(taskId).task;
  invariant(task.stageEntry?.id===entryId&&task.deterministicHandoff?.id===deliveryId&&!task.pendingTransition&&!task.operation,'STALE_HANDOFF','The destination entry was replaced before context admission.');
  invariant(!this.handoffAdmissions.has(taskId),'NATIVE_ADMISSION_PENDING','Another conversation is admitting context for this task.');
  const token={entryId,deliveryId};this.handoffAdmissions.set(taskId,token);
  return ()=>{if(this.handoffAdmissions.get(taskId)===token){this.handoffAdmissions.delete(taskId);this.deterministicRuntime?.reconcile(taskId);void this.dispatchPending().catch(error=>this.options.report?.(error));}};
 }
 async acceptDeterministicHandoff(taskId:string,entryId:string,deliveryId:string):Promise<void>{
  const found=this.locator.byTask(taskId);if(!found)return;
  await this.hubs.hub(found.hubId).transact(draft=>{const task=draft.tasks.find(value=>value.id===taskId);const handoff=task?.deterministicHandoff;
   if(!task||task.stageEntry?.id!==entryId||handoff?.id!==deliveryId||handoff.acceptedAt)return;
   handoff.acceptedAt=new Date().toISOString();delete handoff.error;
   recordDeterministicHandoff(task,{at:handoff.acceptedAt,deliveryId:handoff.id,executionId:handoff.executionId,fromColumnId:handoff.fromColumnId,columnId:task.columnId,outcome:'accepted',exit:handoff.exit,message:handoff.message,...(handoff.params===undefined?{}:{parameters:handoff.params})});
  });
 }
 private async dispatchDeterministicHandoffs():Promise<void>{
  if(this.disposed||!this.initialized)return;
  const jobs:Promise<void>[]=[];
  for(const {task} of this.locator.all()){
   const handoff=task.deterministicHandoff;
   if(!handoff?.instruction||handoff.acceptedAt||handoff.error||task.stageEntry?.id!==handoff.entryId||task.operation||this.handoffAdmissions.has(task.id))continue;
   const existing=this.handoffDeliveries.get(task.id);if(existing){jobs.push(existing);continue;}
   const done=Promise.resolve().then(async()=>{
    try{
     let current=this.locatedTask(task.id);if(current.task.stageEntry?.id!==handoff.entryId||current.project.operation)return;
     const sessionId=handoff.sessionId??firstOpenSessionId(current.task)??(await this.createConversationNow(task.id,{allowUndecided:true})).sessionId;
     current=this.locatedTask(task.id);if(current.task.stageEntry?.id!==handoff.entryId)return;
     await this.hubs.hub(current.hubId).transact(draft=>{const value=draft.tasks.find(t=>t.id===task.id);if(value?.stageEntry?.id===handoff.entryId&&value.deterministicHandoff?.id===handoff.id)value.deterministicHandoff.sessionId=sessionId;});
     await admitStageInstruction(this.stageInstructionDeps(),{taskId:task.id,columnId:current.task.columnId,instruction:handoff.instruction!,sessionId,requestId:handoff.id,expectedEntryId:handoff.entryId,isCurrent:()=>!this.closing});
     await this.acceptDeterministicHandoff(task.id,handoff.entryId,handoff.id);
    }catch(error){
     if(this.closing)return;
     const current=this.locator.byTask(task.id);if(!current)return;
     await this.hubs.hub(current.hubId).transact(draft=>{const value=draft.tasks.find(t=>t.id===task.id);const h=value?.deterministicHandoff;
      if(!value||value.stageEntry?.id!==handoff.entryId||h?.id!==handoff.id||h.acceptedAt)return;
      h.error=problem(error);recordDeterministicHandoff(value,{at:new Date().toISOString(),deliveryId:h.id,executionId:h.executionId,fromColumnId:h.fromColumnId,columnId:h.columnId,outcome:'failed',exit:h.exit,message:h.message,...(h.params===undefined?{}:{parameters:h.params}),error:h.error});
     });this.options.report?.(error);
    }
   }).finally(()=>{this.handoffDeliveries.delete(task.id);});
   this.handoffDeliveries.set(task.id,done);jobs.push(done);
  }await Promise.all(jobs);
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
 /**
  * Publish the new attention projection. A conversation-fact change wakes only the tasks
  * that own those conversations; a broad invalidation keeps the full reconciliation.
  */
 private attentionChanged(changedSessionIds?:readonly string[]):void{
  if(this.disposed)return;
  if(changedSessionIds===undefined)this.deterministicRuntime?.sync();
  else{const woken=new Set<string>();for(const sessionId of changedSessionIds){const task=this.locator.bySession(sessionId)?.task;if(task!==undefined&&!woken.has(task.id)){woken.add(task.id);this.deterministicRuntime?.wake(task.id);}}}
  this.sequence++;this.publisher.request();this.publisher.flush();
 }
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
  this.startup.run([() => this.runDraftRetention()]);
  await this.migrateDeterministicCaptures();
  this.initialized=true;this.deterministicRuntime?.start();
  await this.dispatchDeterministicHandoffs();
 }
 /** Rewrite verified pre-upgrade captures under the current version authority. */
 private async migrateDeterministicCaptures():Promise<void>{
  const runtime=this.nativeDeterministic;if(!runtime)return;
  let changed=false;
  for(const located of this.locator.all()){
   const control=located.task.deterministic;if(!control?.capture)continue;
   try{
    const normalized=await runtime.normalizeCapture(control.capture,control.definition);
    const acquired=normalized.sourceRef!==control.capture.sourceRef;
    try{
      if(!acquired)continue;
      await this.hubs.hub(located.hubId).transact(draft=>{const task=draft.tasks.find(value=>value.id===located.task.id);if(!task?.deterministic||task.deterministic.entryId!==control.entryId||task.deterministic.executionId!==control.executionId)return;task.deterministic.capture=normalized;});
      changed=true;
    }finally{if(acquired)runtime.releaseCapture(normalized);}
   }catch(error){this.options.report?.(error);}
  }
  if(changed)this.markChanged();
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
  if(this.forgottenSessions.has(sessionId))return;
  const record=this.options.questionStore?.load(sessionId);
  if(record===undefined)return;
  try{this.questions.restoreSession(record);}catch(error){this.options.report?.(error);}
 }
 async prepareQuestions(sessionId:string):Promise<void>{
  if(this.prepared.has(sessionId))return this.prepared.get(sessionId);
  const work=(async()=>{
   this.restoreQuestionProjection(sessionId);
   if(this.options.history){for(const event of await this.options.history(sessionId)){if(this.forgottenSessions.has(sessionId))return;if(isEvent(event))this.questions.apply(sessionId,event);}}
   // A restored or replayed unanswered round changes the pending user work the
   // attention snapshot and the auto-mode hold derive from, without a live event.
   // A conversation deleted while its history was replayed must not resurrect.
   if(this.forgottenSessions.has(sessionId))return;
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
  const store=this.options.questionStore;if(!store||this.forgottenSessions.has(sessionId))return;
  const record=this.questions.serializeSession(sessionId);if(record===undefined)return;
  try{await store.save(sessionId,record);}catch(error){this.options.report?.(error);}
 }
 private async persistSessionStrict(sessionId:string):Promise<void>{
  const store=this.options.questionStore;if(!store)return;
  if(this.forgottenSessions.has(sessionId))throw new KanbanError('QUESTION_CONVERSATION_GONE','The conversation no longer exists.');
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
  // Dismissal and its persistence/rollback share the session's draft lane: a
  // concurrent draft write must not observe the provisional dismissal and prune a
  // draft that a failed projection write would bring back.
  return this.enqueueDraftWrite(sessionId,async()=>{
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
   this.cancelDraftPrune(sessionId);
   await this.pruneAnsweredDrafts(sessionId);
   return structuredClone([...this.questions.getRounds(sessionId)]);
  });
 }
 /** The stored drafts of one conversation's unresolved rounds; the round feed baseline carries them. */
 async questionDrafts(sessionId:string):Promise<Record<string,StoredQuestionDraft>>{
  const store=this.options.questionDraftStore;if(!store)return {};
  await this.prepareQuestions(sessionId);
  let record:ReturnType<QuestionDraftStore['load']>;
  // A draft-store read is best effort: a quarantined backend must not suppress the
  // rounds and their Submit surface that are otherwise available.
  try{record=store.load(sessionId);}
  catch(error){this.options.report?.(error);return {};}
  return record===undefined?{}:this.unresolvedDrafts(sessionId,record.drafts);
 }
 /**
  * Persist one round's draft, or clear it. Writes for one session are serialized and
  * merged per round, and a round that is already answered or dismissed is never
  * stored, so a late debounced write cannot resurrect a finished round's draft.
  */
 async saveQuestionDraft(sessionId:string,roundId:string,draft:QuestionDraftContent|null):Promise<StoredQuestionDraft|null>{
  const store=this.options.questionDraftStore;if(!store)return null;
  let content:QuestionDraftContent|null;
  try{content=draft===null?null:QuestionDraftContentSchema.parse(draft);}
  catch{throw new KanbanError('INVALID_QUESTION_DRAFT','The question draft is malformed or too large.');}
  return this.enqueueDraftWrite(sessionId,async()=>{
   if(this.disposed)return null;
   await this.prepareQuestions(sessionId);
   let existing:ReturnType<QuestionDraftStore['load']>;
   try{existing=store.load(sessionId);}
   catch(error){this.options.report?.(error);return null;}
   const drafts=this.unresolvedDrafts(sessionId,existing?.drafts??{});
   let changed=existing!==undefined&&Object.keys(drafts).length!==Object.keys(existing.drafts).length;
   const keep=content!==null&&this.isUnresolvedRound(sessionId,roundId);
   if(keep){drafts[roundId]={...content!,updatedAt:new Date().toISOString()};changed=true;}
   else if(content===null&&Object.hasOwn(drafts,roundId)){delete drafts[roundId];changed=true;}
   if(!changed)return null;
   try{
    if(Object.keys(drafts).length===0)await store.remove(sessionId);
    else await store.save(sessionId,{version:1,sessionId,drafts,updatedAt:new Date().toISOString()});
   }catch(error){this.options.report?.(error);return null;}
   // Any nonempty write can push the bound over (a creation, or a refresh that recreates
   // a record evicted in another session's lane); re-check retention after each one.
   if(Object.keys(drafts).length>0)await this.runDraftRetention();
   return keep?drafts[roundId]??null:null;
  });
 }
 /** Answer, dismissal, and retention all drop drafts whose round is no longer answerable. */
 private unresolvedDrafts(sessionId:string,drafts:Readonly<Record<string,StoredQuestionDraft>>):Record<string,StoredQuestionDraft>{
  const unresolved=new Set(this.questions.getRounds(sessionId).filter(round=>!round.answered).map(round=>round.id));
  const result:Record<string,StoredQuestionDraft>={};
  for(const [roundId,draft] of Object.entries(drafts))if(unresolved.has(roundId))result[roundId]=structuredClone(draft);
  return result;
 }
 private isUnresolvedRound(sessionId:string,roundId:string):boolean{
  return this.questions.getRounds(sessionId).some(round=>round.id===roundId&&!round.answered);
 }
 /** Serialize draft writes for one conversation; the next write runs even after a failed one. */
 private enqueueDraftWrite<T>(sessionId:string,work:()=>Promise<T>):Promise<T>{
  const previous=this.draftWrites.get(sessionId)??Promise.resolve();
  const next=previous.then(work,work);
  const settled=next.then(()=>undefined,()=>undefined);
  this.draftWrites.set(sessionId,settled);
  void settled.then(()=>{if(this.draftWrites.get(sessionId)===settled)this.draftWrites.delete(sessionId);});
  return next;
 }
 private scheduleDraftPrune(sessionId:string):void{
  if(this.disposed||!this.options.questionDraftStore)return;
  this.cancelDraftPrune(sessionId);
  this.draftPruneTimers.set(sessionId,setTimeout(()=>{
   this.draftPruneTimers.delete(sessionId);
   void this.enqueueDraftWrite(sessionId,()=>this.pruneAnsweredDrafts(sessionId)).catch(error=>this.options.report?.(error));
  },QUESTION_DRAFT_PRUNE_MS));
 }
 private cancelDraftPrune(sessionId:string):void{
  const timer=this.draftPruneTimers.get(sessionId);
  if(timer===undefined)return;
  clearTimeout(timer);this.draftPruneTimers.delete(sessionId);
 }
 private async pruneAnsweredDrafts(sessionId:string):Promise<void>{
  const store=this.options.questionDraftStore;if(!store||this.disposed)return;
  try{
   const existing=store.load(sessionId);if(existing===undefined)return;
   const drafts=this.unresolvedDrafts(sessionId,existing.drafts);
   if(Object.keys(drafts).length===Object.keys(existing.drafts).length)return;
   if(Object.keys(drafts).length===0)await store.remove(sessionId);
   else await store.save(sessionId,{version:1,sessionId,drafts,updatedAt:new Date().toISOString()});
  }catch(error){this.options.report?.(error);}
 }
 /**
  * Keep only the most recently updated draft records, at startup and whenever a new
  * conversation record is created, so orphaned conversations stay bounded. Runs are
  * single-flight, refreshed candidates are never deleted by an older view of them,
  * and a pass with skips re-reads the newer timestamps for replacement candidates.
  */
 private runDraftRetention():Promise<void>{
  const current=this.retentionPrune;
  if(current!==undefined)return current;
  const run=this.pruneDraftsToRetention().finally(()=>{this.retentionPrune=undefined;});
  this.retentionPrune=run;
  return run;
 }
 private async pruneDraftsToRetention():Promise<void>{
  const store=this.options.questionDraftStore;if(!store||this.disposed)return;
  try{
   for(;;){
    if(this.disposed)return;
    const records=store.records().sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt)||right.sessionId.localeCompare(left.sessionId));
    const excess=records.length-QUESTION_DRAFT_RETENTION;
    if(excess<=0)return;
    const candidates=records.slice(QUESTION_DRAFT_RETENTION).reverse();
    let removed=0;
    for(const record of candidates){
     if(removed>=excess)break;
     const current=store.load(record.sessionId);
     if(current===undefined||current.updatedAt!==record.updatedAt)continue;
     if(await store.remove(record.sessionId))removed+=1;
    }
    // A refreshed candidate keeps its record; the next pass picks a replacement from
    // the newer ordering instead of leaving the bound exceeded without one.
    if(removed===0)return;
   }
  }catch(error){this.options.report?.(error);}
 }
 /**
  * Task deletion removes the conversation-scoped question state: the draft records
  * and the durable projection. A failure is reported and never fails the deletion.
  */
 private async removeConversationQuestionState(sessionIds:readonly string[]):Promise<void>{
  const drafts=this.options.questionDraftStore;const projections=this.options.questionStore;
  for(const sessionId of sessionIds){
   // A history replay already in flight must not re-apply events or persist after this.
   this.forgottenSessions.add(sessionId);
   this.cancelDraftPrune(sessionId);
   const saveTimer=this.saveTimers.get(sessionId);
   if(saveTimer!==undefined){clearTimeout(saveTimer);this.saveTimers.delete(sessionId);}
   this.questions.forget(sessionId);
   if(drafts){try{await this.enqueueDraftWrite(sessionId,async()=>{await drafts.remove(sessionId);});}catch(error){this.options.report?.(error);}}
   if(projections){try{await projections.remove(sessionId);}catch(error){this.options.report?.(error);}}
  }
 }
 /** Drain queued draft writes before shutdown, like the projection flush. */
 private async flushQuestionDrafts():Promise<void>{
  await Promise.allSettled([...this.draftWrites.values()]);
 }
 observe(sessionId:string,event:unknown):void{
  if(this.disposed||this.forgottenSessions.has(sessionId))return;
  const promptTime=userPromptTime(event);if(promptTime!==undefined)this.clearInstructionPending(sessionId,promptTime);
  const questionChanged=isEvent(event)&&this.questions.apply(sessionId,event);
  if(questionChanged){this.schedulePersist(sessionId);this.scheduleDraftPrune(sessionId);}
  const taskRelevant=this.locator.hasSession(sessionId);
  if(taskRelevant)this.turnAdvance.observe(sessionId,event);
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
 /**
  * One task's native execution facts, aggregated over its OPEN conversations. With
  * `wait`, the read is durable and any conversation that cannot be read makes the
  * value unavailable; without it, only facts the host already resolved are used, so
  * a listing never waits on a cold native read. Neither mode reports a failure as
  * an idle task.
  */
 async taskActivity(task:TaskActivityScope,options:TaskActivityOptions={}):Promise<TaskActivity>{
  const sessionIds=openSessionIds({sessionIds:task.sessionIds,closedSessionIds:task.closedSessionIds??[]});
  if(sessionIds.length===0)return aggregateTaskActivity([]);
  try{
   if(options.wait!==true){const resolved=this.attention.resolved(sessionIds);const entries=sessionIds.flatMap(sessionId=>{const facts=resolved[sessionId];return facts===undefined?[]:[{sessionId,facts}];});return entries.length===sessionIds.length?aggregateTaskActivity(entries):{...aggregateTaskActivity(entries),available:false};}
   const entries=await Promise.all(sessionIds.map(async sessionId=>({sessionId,facts:await this.attention.readResolved(sessionId)})));
   if(entries.some(entry=>entry.facts===undefined))return UNAVAILABLE_TASK_ACTIVITY;
   return aggregateTaskActivity(entries.filter((entry):entry is {sessionId:string;facts:ConversationFacts}=>entry.facts!==undefined));
  }catch{return UNAVAILABLE_TASK_ACTIVITY;}
 }
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
 sessionActivity(sessionId?:string):void{if(this.disposed)return;if(sessionId!==undefined&&!this.locator.hasSession(sessionId))return;this.attention.touch(sessionId);this.markChanged();if(sessionId!==undefined){const task=this.locator.bySession(sessionId)?.task;if(task)this.deterministicRuntime?.wake(task.id);}else for(const {task} of this.locator.all())if(task.deterministic?.result)this.deterministicRuntime?.wake(task.id);}
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
  const deterministic=this.deterministicSummaries();
  this.scheduleRetainedPrune();
  return {...parts,sequence,deterministic,...(Object.keys(scheduleRuntime).length===0?{}:{scheduleRuntime}),...(this.retainedCheckouts.length===0?{}:{retainedCheckouts:this.retainedCheckouts.map(value=>({...value}))})};
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
 /** Refuse an unknown task, then abort that task's pass without joining its serial lane. */
 private async cancelOperation(command:Extract<Command,{type:'operation.cancel'}>):Promise<FullHostSnapshot>{
  this.locatedTask(command.taskId);
  await this.worktrees.cancel(command.taskId);
  return this.snapshot();
 }
 saveNote(input:Extract<Command,{type:'note.save'}>){return this.serial(()=>this.saveNoteNow(input));}
 private async saveNoteNow(input:Extract<Command,{type:'note.save'}>) {invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');const located=this.locatedTask(input.taskId);return this.hubs.hub(located.hubId).saveNote(input.taskId,{id:input.noteId,content:input.content,tags:input.tags});}
 private async deleteNoteNow(input:Extract<Command,{type:'note.delete'}>) {invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');const located=this.locatedTask(input.taskId);return this.hubs.hub(located.hubId).deleteNote(input.taskId,input.noteId);}
 async command(command:Command):Promise<FullHostSnapshot>{
  if(command.type.startsWith('task.deterministic'))return this.execute(command);
  // Cancellation interrupts a pass that is still awaiting Git, so it cannot queue
  // behind the serial lane that pass holds.
  if(command.type==='operation.cancel')return this.cancelOperation(command);
  const ids=command.type==='project.relocate'&&command.confirmed?this.locator.all().filter(value=>value.project.id===command.project.id).map(value=>value.task.id)
   :((command.type==='task.delete'||command.type==='worktree.remove')&&command.confirmed)||command.type==='worktree.create'||command.type==='worktree.attach'||command.type==='worktree.discardCreate'||command.type==='operation.return'?[command.taskId]:[];
  for(const id of ids)invariant(!this.contextAdmissions.has(id),'CONTEXT_ADMISSION_PENDING','Another operation is changing this task context.');
  for(const id of ids)this.contextAdmissions.add(id);
  try { const preparing=this.prepareDeterministicContext(command); if(preparing)await preparing; return await this.serial(()=>this.execute(command)); }
  finally { for(const id of ids){this.contextAdmissions.delete(id);this.deterministicRuntime?.reconcile(id);} }
 }
 /** Cancellation may wait for native drain, so it stays outside the global command lane. */
 private prepareDeterministicContext(command:Command):Promise<void>|undefined{
  if(!this.deterministicRuntime)return undefined;
  let taskIds:string[]=[];
  if(command.type==='project.relocate'&&command.confirmed)taskIds=this.locator.all().filter(value=>value.project.id===command.project.id).map(value=>value.task.id);
  else if(command.type==='task.delete'||command.type==='worktree.remove'){
   if(!command.confirmed)return undefined;
   this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,command.type==='task.delete'?'delete':'remove');taskIds=[command.taskId];
  }else if(command.type==='worktree.create'||command.type==='worktree.attach'||command.type==='worktree.discardCreate'||command.type==='operation.return')taskIds=[command.taskId];
  for(const id of taskIds)this.assertNoHandoffAdmission(id);
  if(taskIds.length===0)return undefined;
  // A replaced entry can leave a native lease even when the current task has no control.
  return Promise.all(taskIds.map(id=>this.deterministicRuntime!.beforeContextChange(id))).then(()=>undefined);
 }
 private assertScriptContextStopped(taskId:string):void{
  this.assertNoHandoffAdmission(taskId);const control=this.locatedTask(taskId).task.deterministic;
  invariant(!this.deterministicRuntime?.hasContextOwner(taskId)&&(!control||(['stopped','failed'].includes(control.phase)&&!['OWNERSHIP_UNCERTAIN','OWNERSHIP_CONFLICT','EXECUTION_OWNERSHIP_UNCERTAIN'].includes(control.error?.code??''))),'EXECUTION_CONTEXT_CHANGED','A new script execution owns this task; stop it before changing its directory.');
 }

 /** The pause tools' port: run the command, then re-read the task it changed. */
 pauseTask(taskId:string,reason:string):Promise<LocatedTask>{return this.command({type:'task.pause',taskId,reason}).then(()=>this.locatedTask(taskId));}
 resumeTask(taskId:string):Promise<LocatedTask>{return this.command({type:'task.resume',taskId}).then(()=>this.locatedTask(taskId));}
 /**
  * The routing write the transition tools depend on. It goes through the command
  * lane, so a declaration is serialized with every other write and a stale one
  * never lands after the task moved.
  */
 recordTransition(taskId:string,write:{columnId?:string;reason?:string;parameters?:Record<string,string>}):Promise<LocatedTask>{
  return this.command({type:'task.recordTransition',taskId,...(write.columnId===undefined?{}:{columnId:write.columnId}),...(write.reason===undefined?{}:{reason:write.reason}),...(write.parameters===undefined?{}:{parameters:write.parameters})}).then(()=>this.locatedTask(taskId));
 }
 private async execute(command:Command):Promise<FullHostSnapshot>{
  invariant(!this.disposed,'PLUGIN_DISPOSED','The Kanban plugin is shutting down.');
  let commandReceipt:HostSnapshot['commandReceipt'];
  switch(command.type){
   case 'hub.create':{const hub=await this.hubs.createHub(command.name);commandReceipt={kind:'hub',id:hub.id};break;}
   case 'hub.rename':{await this.hubs.renameHub(command.hubId,command.name,command.expectedRevision);break;}
   case 'hub.delete':{
    invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm deleting the Hub and its task-free projects.');
    await this.hubs.deleteHub(command.hubId);
    try{await this.options.revisions?.removeHub?.(command.hubId);}catch(error){this.options.report?.(error);}
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
    for(const value of this.locator.all())if(value.project.id===command.project.id)this.assertScriptContextStopped(value.task.id);
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
   case 'task.deterministicPlay':{
    invariant(!this.contextAdmissions.has(command.taskId),'CONTEXT_ADMISSION_PENDING','A task context operation is being admitted.');
    const task=await this.ensureDeterministicEntry(command.taskId);invariant(task.stageEntry,'STAGE_ENTRY_REQUIRED','Move into this stage before starting a script.');
    const control=task.deterministic;const saved=control!==undefined&&control.entryId===task.stageEntry.id?control.result:undefined;
    const runtime=this.requireDeterministic();
    if(saved!==undefined&&saved.deliveryStatus!=='accepted'){const owned=control!;
     if(owned.phase==='delivering')runtime.wake(task.id);
     else await runtime.retryDelivery({taskId:task.id,entryId:owned.entryId,executionId:owned.executionId});}
    else await runtime.play(task.id,task.stageEntry.id);
    break;}
   case 'task.deterministicRunAgain':{
    invariant(!this.contextAdmissions.has(command.taskId),'CONTEXT_ADMISSION_PENDING','A task context operation is being admitted.');
    const task=await this.ensureDeterministicEntry(command.taskId);invariant(task.stageEntry?.id===command.entryId,'STALE_EXECUTION','This stage entry has been replaced.');
    const control=task.deterministic;invariant(control===undefined||!['active','stopping'].includes(control.phase),'EXECUTION_ACTIVE','Stop the running execution before starting a new one.');
    await this.requireDeterministic().play(task.id,task.stageEntry.id);break;}
   case 'task.deterministicCancelJob':{
    const located=this.locatedTask(command.taskId);const task=located.task;const hold=task.deterministic?.hold;
    const named=hold?.background?.some(fact=>fact.kind==='job'&&fact.id===command.jobId)===true;
    invariant(named,'STALE_HOLD','This job is not the one blocking the saved result.');
    const cancel=this.sessions.cancelJob;invariant(cancel,'JOBS_UNAVAILABLE','The native background-job registry is unavailable.');
    let cancelled:'requested'|'already-finished'|undefined;
    for(const sessionId of task.sessionIds){if(task.closedSessionIds.includes(sessionId))continue;
     try{cancelled=await cancel.call(this.sessions,sessionId,command.jobId);}catch(error){
      if((error as {code?:string}).code==='JOB_NOT_OWNED'||(error as {code?:string}).code==='SESSION_STATE_UNAVAILABLE')continue;throw error;}
     break;}
    invariant(cancelled!==undefined,'JOB_NOT_OWNED','The background job does not belong to this task conversation.');
    this.requireDeterministic().wake(task.id);break;}
   case 'task.deterministicStop':{const task=this.locatedTask(command.taskId).task;invariant(task.deterministic,'EXECUTION_NOT_FOUND','This task has no deterministic execution.');await this.requireDeterministic().stop({taskId:task.id,entryId:task.deterministic.entryId,executionId:command.executionId??task.deterministic.executionId});break;}
   case 'board.deterministicApprove':await this.requireApproval().approve({boardId:command.boardId,stageId:command.stageId,fingerprint:command.fingerprint,stageGeneration:command.stageGeneration,...(command.taskId===undefined?{}:{taskId:command.taskId})});break;
   case 'task.deterministicApprove':{
    const located=this.locator.byTask(command.taskId);invariant(located,'TASK_NOT_FOUND','Task does not exist.');
    if(located.task.deterministic?.executionId!==command.executionId)throw new KanbanError('STALE_VERSION','The captured execution changed before approval. Review the current version.');
    const review=await this.deterministicReview({boardId:located.task.boardId,stageId:located.task.columnId,taskId:command.taskId});
    if(review.version.fingerprint!==command.fingerprint)throw new KanbanError('STALE_VERSION','The reviewed version changed before approval. Review the current version.');
    await this.requireApproval().approve({boardId:located.task.boardId,stageId:located.task.columnId,fingerprint:review.version.fingerprint,stageGeneration:review.version.stageGeneration,taskId:command.taskId});
    break;
   }
   case 'task.deterministicVariable':{const located=this.locatedTask(command.taskId);invariant(located.project.id===command.projectId,'STALE_STAGE','The task project changed before this value could be saved.');await this.ensureDeterministicEntry(command.taskId);const current=this.locatedTask(command.taskId).task;invariant(current.stageEntry?.stageIdentity===command.stageIdentity,'STALE_STAGE','The task moved to another stage before this value could be saved.');await this.requireDeterministic().variable(command.taskId,command.name,command.value??null,command.stageIdentity);break;}
   case 'task.deterministicRetryDelivery':{const task=this.locatedTask(command.taskId).task;invariant(task.deterministic?.entryId===command.entryId&&task.deterministic.executionId===command.executionId,'STALE_EXECUTION','This saved result no longer owns the stage entry.');await this.requireDeterministic().retryDelivery({taskId:task.id,entryId:command.entryId,executionId:command.executionId});break;}
   case 'task.deterministicParameters':await this.requireDeterministic().parameters(command.taskId,command.entryId,command.values);break;
   case 'task.edit':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).editTask(command.taskId,{...(command.title!==undefined?{title:command.title}:{}),...(command.description!==undefined?{description:command.description}:{})},command.expectedRevision);break;}
   case 'conversation.create':{const created=await this.createConversationNow(command.taskId,{ensureFirst:command.ensureFirst===true});commandReceipt={kind:'conversation',id:created.sessionId,...(created.model===undefined?{}:{model:created.model})};break;}
   case 'conversation.close':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).closeSession(command.taskId,command.sessionId);break;}
   case 'conversation.reopen':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).reopenSession(command.taskId,command.sessionId);break;}
   case 'note.save':{const value=await this.saveNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'note.delete':{const value=await this.deleteNoteNow(command);commandReceipt={kind:'note',id:value.id};break;}
   case 'task.delete':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm task data/worktree removal and native conversation archiving.');this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'delete');this.assertScriptContextStopped(command.taskId);await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'delete',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath,...(command.force===true?{force:true}:{})},{background:true});break;
   case 'worktree.create':this.assertScriptContextStopped(command.taskId);this.assertContext(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'create',mode:command.mode,path:command.path,branchName:command.branchName,sourceBranch:command.sourceBranch});break;
   case 'worktree.attach':this.assertScriptContextStopped(command.taskId);this.assertContext(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.request(command.taskId,{kind:'attach',path:command.path});break;
   case 'worktree.discardCreate':this.assertScriptContextStopped(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'recovering its worktree');invariant(!this.locatedTask(command.taskId).task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');await this.worktrees.discardCreate(command.taskId,command.confirmed);break;
   case 'worktree.dismiss':{this.assertContext(command.taskId);const located=this.locatedTask(command.taskId);invariant(isGitProject(located.project),'PROJECT_NOT_GIT','Worktree choices require a Git-backed project.');invariant(!located.task.pendingTransition,'TASK_BUSY','Resolve the confirmed transition first.');invariant(!located.task.worktree,'WORKTREE_EXISTS','The task already has a worktree.');if(located.task.worktreeDismissed!==true)await this.hubs.hub(located.hubId).dismissWorktree(command.taskId);break;}
   case 'worktree.remove':invariant(command.confirmed,'CONFIRMATION_REQUIRED','Confirm removal of the worktree while preserving the task and branch.');this.assertProjectRelocation(this.locatedTask(command.taskId).project,'changing its worktree');this.assertDestructiveTarget(command.taskId,command.expectedWorktreePath,'remove');this.assertScriptContextStopped(command.taskId);await this.clearPending(command.taskId);await this.worktrees.request(command.taskId,{kind:'remove',discardChanges:command.discardChanges??false,expectedWorktreePath:command.expectedWorktreePath,...(command.force===true?{force:true}:{})},{background:true});break;
   case 'operation.retry':{
    const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const task=located.task;this.assertProjectRelocation(located.project,'retrying a context operation');if(task.operation){await this.worktrees.retry(command.taskId,{background:true});const current=store.snapshot().tasks.find(t=>t.id===command.taskId);if(current&&!current.operation&&current.pendingTransition?.worktreeRequest&&current.pendingTransition.status==='failed')await store.transact(d=>{const p=d.tasks.find(t=>t.id===command.taskId)!.pendingTransition!;p.status='waiting';delete p.error;});}else if(task.pendingTransition){await store.transact(d=>{const t=d.tasks.find(t=>t.id===command.taskId)!;if(t.pendingTransition){t.pendingTransition.status='waiting';delete t.pendingTransition.error;}});}await this.dispatchPending();break;
   }
   case 'operation.return':this.assertScriptContextStopped(command.taskId);this.assertProjectRelocation(this.locatedTask(command.taskId).project,'returning to the base project');await this.clearPending(command.taskId);await this.worktrees.returnToBase(command.taskId);break;
   case 'operation.dismiss':await this.dismissFailedAdvance(command.taskId);break;
   case 'retainedCheckout.dismiss':this.dismissRetainedCheckouts(command.paths);break;
   case 'task.move':await this.move(command);break;
   // Changing the setting forgets a turn that has not settled yet, so enabling — or
   // resuming a paused task — never advances a turn that ended before the change.
   case 'task.autoMode':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).setAutoMode(command.taskId,command.enabled);this.turnAdvance.forget(command.taskId);break;}
   case 'task.recordTransition':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).recordTransition(command.taskId,command.columnId,command.reason,command.parameters);break;}
   case 'task.pause':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).pauseTask(command.taskId,command.reason);this.turnAdvance.forget(command.taskId);break;}
   case 'task.resume':{const located=this.locatedTask(command.taskId);await this.hubs.hub(located.hubId).resumeTask(command.taskId);this.turnAdvance.forget(command.taskId);this.deterministicRuntime?.wake(command.taskId);break;}
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
  this.deterministicRuntime?.sync();await this.dispatchPending();const snapshot=await this.snapshot({},'cache');return {...snapshot,...(commandReceipt?{commandReceipt}:{})};
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
  this.assertContext(command.taskId);this.assertNoHandoffAdmission(command.taskId);const located=this.locatedTask(command.taskId);const store=this.hubs.hub(located.hubId);const state=store.snapshot();const task=located.task;const board=state.boards.find(b=>b.id===task.boardId);invariant(board,'BOARD_NOT_FOUND','The task board does not exist.');const column=board.workflow.columns.find(c=>c.id===command.columnId);
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
  // A failed host advance — automatic or declared — is recovered by running the
  // entry it left unresolved, with the justification it kept and the delivery
  // identity it was admitted with: a replay then never sends the instruction twice,
  // and a delivery that never landed is still attempted.
  const recovering=pending!==undefined&&pending.origin!==undefined&&pending.status==='failed'?pending:undefined;
  invariant(pending===undefined||recovering!==undefined,'TASK_BUSY','Resolve the confirmed transition first.');
  await admitStageInstruction(this.stageInstructionDeps(),{
   taskId:command.taskId,columnId:command.columnId,instruction:command.expectedInstruction,reviewedInstruction:command.expectedInstruction,expectedEnteredAt:command.expectedEnteredAt,
   ...(recovering===undefined?{}:{requestId:recovering.id}),
   ...(recovering===undefined||recovering.reason===undefined?{}:{transition:{fromColumnId:recovering.fromColumnId,reason:recovering.reason}}),
  });
 }
 private admitTurnAdvance(taskId:string,plan:AutoAdvancePlan,origin:AdvanceOrigin,isCurrent:()=>boolean):Promise<void>{
  // The drain shares the command lane, so a pause or resume queued ahead of this
  // admission must still win: the settle's own generation decides.
  return this.serial(()=>isCurrent()?this.admitTurnAdvanceNow(taskId,plan,origin):Promise.resolve());
 }
 /** The serialized adapter around the one turn-end advance admission path. */
 private admitTurnAdvanceNow(taskId:string,plan:AutoAdvancePlan,origin:AdvanceOrigin):Promise<void>{
  return admitTurnAdvance({
   locate:taskId=>this.locatedTask(taskId),
   transact:(hubId,change)=>this.hubs.hub(hubId).transact(change),
   resolveSession:async task=>firstOpenSessionId(task)??(await this.createConversationNow(task.id,{allowUndecided:true})).sessionId,
   pending:task=>readPendingUserWork(this.factsSource,task.sessionIds),
   dispatch:()=>this.dispatchPending(),
   report:error=>this.options.report?.(error),
  },taskId,plan,origin);
 }
 private async dismissFailedAdvance(taskId:string):Promise<void>{
  const located=this.locatedTask(taskId);const pending=located.task.pendingTransition;
  invariant(!located.task.operation,'CONTEXT_OPERATION_PENDING','Resolve the context operation before dismissing an automatic advance.');
  invariant(pending?.origin!==undefined,'INVALID_TARGET','Only a host advance can be dismissed.');
  invariant(pending.status==='failed','TASK_BUSY','Only a failed host advance can be dismissed.');
  await this.hubs.hub(located.hubId).transact(d=>{const value=d.tasks.find(candidate=>candidate.id===taskId);if(value?.pendingTransition!==undefined&&value.pendingTransition.origin!==undefined&&value.pendingTransition.status==='failed')delete value.pendingTransition;});
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
  try{do{this.driveAgain=false;this.pendingTransitions.refresh(this.locator.summaries());for(const taskId of [...this.pendingTransitions.list()]){const located=this.locator.byTask(taskId);const task=located?.task;const pending=task?.pendingTransition;if(!located||!task||!pending||pending.status!=='waiting'||task.operation||this.handoffAdmissions.has(task.id)||(pending.worktreeRequest&&task.worktree?.status!=='ready'))continue;const store=this.hubs.hub(located.hubId);
   // The pending transition distinguishes a declared transition from an automatic
   // advance; an absent origin is the operator's own move.
   const origin:StageEntryOrigin=pending.origin==='agent'?'agent':pending.origin==='auto'?'auto':'manual';
   try{
    await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id)!;invariant(t.pendingTransition?.id===pending.id&&!t.operation,'REVISION_CONFLICT','Task context changed during transition.');invariant(t.columnId===pending.fromColumnId||t.columnId===pending.columnId,'REVISION_CONFLICT','Task column changed during transition.');const board=d.boards.find(b=>b.id===t.boardId)!;if(t.columnId!==pending.columnId)invariant(pending.transitionOverride===true||canTransition(board.workflow,t.columnId,pending.columnId),'TRANSITION_NOT_ALLOWED','The workflow no longer permits this transition.');if(pending.parameters!==undefined){const destination=board.workflow.columns.find(column=>column.id===pending.columnId);const checked=validateParameterValues(declaredParameterNames(destination?.deterministic?.params),pending.parameters);invariant(checked.ok,'INVALID_PARAMETERS',checked.ok?'':checked.message);}
      operations.placeTask(d,t.id,pending.columnId,placementFromAnchor(pending.beforeTaskId),nextEnteredAt(),{retainAgentPause:pending.origin!==undefined,origin,at:this.hubs.operationDeps().now(),...(pending.parameters===undefined?{}:{parameters:pending.parameters})});if(pending.mode==='run')t.pendingTransition.status='sending';else delete t.pendingTransition;});if(pending.origin===undefined)this.turnAdvance.forget(task.id);
    if(pending.mode==='run'){
     invariant(pending.sessionId&&pending.text,'INVALID_TARGET','Confirmed execution is missing its target or instruction.');
     await admitStageInstruction(this.stageInstructionDeps(),{taskId:task.id,columnId:pending.columnId,instruction:pending.text,sessionId:pending.sessionId,requestId:pending.id,...(pending.reason===undefined?{}:{transition:{fromColumnId:pending.fromColumnId,reason:pending.reason}})});
     await store.transact(d=>{const t=d.tasks.find(t=>t.id===task.id);if(t?.pendingTransition?.id===pending.id)delete t.pendingTransition;});
    }
   }catch(error){await this.failPending(located.hubId,task.id,pending.id,error);this.options.report?.(error);}
  }}while(this.driveAgain&&!this.disposed);}finally{this.driving=false;}
 }
 async close():Promise<void>{
  if(this.disposed)return;
  this.closing=true;this.initialized=false;this.deterministicRuntime?.dispose();await this.deterministicRuntime?.settle();
  // Let the background reconciliation finish (or abort) before flushing question
  // persistence, so no replay can schedule a write after the final flush.
  this.startup.dispose();await this.startup.whenSettled();
  if(this.retainedPruneTimer!==undefined){clearTimeout(this.retainedPruneTimer);this.retainedPruneTimer=undefined;}
  await this.retainedPrune;
  // The settling prune re-arms while the host is still open; close clears that one too.
  if(this.retainedPruneTimer!==undefined){clearTimeout(this.retainedPruneTimer);this.retainedPruneTimer=undefined;}
  // Pending answered-draft prunes are required cleanup, not disposable timers: run
  // them in the session lane before the final flush instead of cancelling them.
  const pendingPrunes=[...this.draftPruneTimers.keys()];
  for(const timer of this.draftPruneTimers.values())clearTimeout(timer);
  this.draftPruneTimers.clear();
  await Promise.allSettled(pendingPrunes.map(sessionId=>this.enqueueDraftWrite(sessionId,()=>this.pruneAnsweredDrafts(sessionId))));
  await this.retentionPrune;
  await this.flushQuestions();await this.flushQuestionDrafts();this.publisher.flush();this.disposed=true;this.publisher.dispose();this.attention.dispose();this.turnAdvance.dispose();for(const dispose of this.disposers)dispose();this.listeners.clear();this.worktrees.dispose();this.relocations.dispose();this.operationQueue.dispose();await this.commandTail;await this.drivePromise?.catch(error=>this.options.report?.(error));this.questions.dispose();await this.relocations.settle();}
}
