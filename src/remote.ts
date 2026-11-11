import { z } from 'zod';
import { createTypertContribution } from './sdk/typert.js';
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
import { KanbanStateSchema } from './domain/hub-schema.js';
import { problem } from './domain/schema-parts.js';
import { newTaskSchema } from './shared/task-creation.js';
import type { Command, DriveBrowseView, DriveDiscoveryView, HostSnapshot, HubSharingView, LocalDriveRequest, LocalDriveResult, Outcome, ProjectLocation, QuestionFeedFrame, QuestionRound, ModelCatalog, SharingAuthView, SharingCommand, SnapshotRequest, WorktreeDefaults } from './shared/types.js';
import { SHARING_STORAGES } from './shared/types.js';
export const PACKAGE_NAME = 'dsh-kanban';
const id=z.string().min(1).max(200);
const revision=z.number().int().nonnegative().optional();
const project=z.object({id:id.optional(),name:z.string().min(1),projectPath:z.string().min(1),gitRootPath:z.string().optional(),defaultBranch:z.string().optional(),projectKey:z.string().min(1).optional()}).strict();
const relocationProject=project.extend({id});
const hubId=id.optional();
const boardId=id.optional();
const projectLocation=z.discriminatedUnion('kind',[z.object({kind:z.literal('git'),projectPath:z.string(),gitRootPath:z.string(),defaultBranch:z.string().optional()}).strict(),z.object({kind:z.literal('folder'),projectPath:z.string()}).strict()]);
const tree={mode:z.enum(['new','existing']),path:z.string().min(1),branchName:z.string().min(1),sourceBranch:z.string().optional()};
const boardSettings=z.object({worktreeBasePath:z.string().optional()}).strict();
const modelSelection=z.object({provider:z.string().min(1),model:z.string().min(1),reasoningEffort:z.string().min(1).optional()}).strict();
const scheduleRunProblem=z.object({code:z.string().min(1),message:z.string(),details:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).optional()}).strict();
const scheduleRunView=z.object({status:z.enum(['sent','failed']),at:z.string(),manual:z.boolean(),sessionId:id.optional(),error:scheduleRunProblem.optional(),archiveError:scheduleRunProblem.optional()}).strict();
const scheduleRuntimeView=z.object({running:z.boolean(),lastRun:scheduleRunView.optional()}).strict();
export const ModelCatalogSchema:z.ZodType<ModelCatalog>=z.object({
 default:modelSelection,
 providers:z.array(z.object({id:id,name:z.string().min(1),models:z.array(z.object({id:id,name:z.string().min(1),description:z.string().optional(),reasoning:z.object({efforts:z.array(z.object({id:id,name:z.string().min(1)}).strict()),defaultEffort:z.string().optional()}).strict().optional()}).strict())}).strict()),
 failures:z.array(z.object({id:id,name:z.string().min(1),message:z.string()}).strict()),
}).strict();
const worktreeDefault=z.discriminatedUnion('kind',[z.object({kind:z.literal('derived'),branchName:z.string().min(1),path:z.string().min(1),sourceBranch:z.string().optional()}).strict(),z.object({kind:z.literal('unavailable'),reason:problem}).strict()]);
const stagePatchSchema=z.object({
 name:z.string().optional(),
 onEnterPrompt:z.string().nullable().optional(),
 initial:z.literal(true).optional(),
 allowedTransitions:z.array(z.object({to:id,when:z.string().optional()}).strict()).nullable().optional(),
 id:id.optional(),
}).strict();
export const CommandSchema:z.ZodType<Command>=z.discriminatedUnion('type',[
 z.object({type:z.literal('hub.create'),name:z.string().min(1)}).strict(),
 z.object({type:z.literal('hub.rename'),hubId:id,name:z.string().min(1),expectedRevision:revision}).strict(),
 z.object({type:z.literal('hub.delete'),hubId:id,confirmed:z.boolean()}).strict(),
 z.object({type:z.literal('board.create'),hubId:id,name:z.string().min(1)}).strict(),
 z.object({type:z.literal('board.rename'),hubId:id,boardId:id,name:z.string().min(1),expectedRevision:revision}).strict(),
 z.object({type:z.literal('board.delete'),hubId:id,boardId:id,confirmed:z.boolean(),expectedRevision:revision,sharing:z.enum(['local','team']).optional()}).strict(),
 z.object({type:z.literal('board.workflow.save'),hubId:id,boardId:id,yaml:z.string(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('board.stage.update'),hubId:id,boardId:id,stageId:id,patch:stagePatchSchema,expectedRevision:revision}).strict(),
 z.object({type:z.literal('board.projects.save'),hubId:id,boardId:id,projectKeys:z.array(z.string().min(1)).refine(keys=>new Set(keys).size===keys.length,'Project keys must be unique.').optional(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.save'),hubId,project,expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.relocate'),hubId,project:relocationProject,confirmed:z.boolean(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.relocationRetry'),hubId,projectId:id}).strict(),
 z.object({type:z.literal('project.relocationCancel'),hubId,projectId:id}).strict(),
 z.object({type:z.literal('project.delete'),hubId,projectId:id,confirmed:z.boolean(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('settings.save'),settings:boardSettings,expectedRevision:revision}).strict(),
 newTaskSchema.extend({type:z.literal('task.create'),hubId}).strict(),
 z.object({type:z.literal('task.edit'),hubId,taskId:id,title:z.string().optional(),description:z.string().optional(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('task.move'),hubId,taskId:id,columnId:id,beforeTaskId:id.nullable().optional(),overrideTransition:z.boolean().optional()}).strict(),
 z.object({type:z.literal('task.autoMode'),hubId,taskId:id,enabled:z.boolean()}).strict(),
 z.object({type:z.literal('task.pause'),hubId,taskId:id,reason:z.string()}).strict(),
 z.object({type:z.literal('task.resume'),hubId,taskId:id}).strict(),
 z.object({type:z.literal('task.runInstruction'),hubId,taskId:id,columnId:id,expectedEnteredAt:z.number().finite(),expectedInstruction:z.string()}).strict(),
 z.object({type:z.literal('task.prepareFirstExecution'),hubId,taskId:id,columnId:id,expectedEnteredAt:z.number().finite(),expectedInstruction:z.string().optional()}).strict(),
 z.object({type:z.literal('conversation.create'),hubId,taskId:id}).strict(),
 z.object({type:z.enum(['conversation.close','conversation.reopen']),hubId,taskId:id,sessionId:id}).strict(),
 z.object({type:z.literal('task.delete'),hubId,taskId:id,confirmed:z.boolean(),expectedWorktreePath:z.string().nullable(),discardChanges:z.boolean().optional(),force:z.boolean().optional()}).strict(),
 z.object({type:z.literal('worktree.create'),hubId,taskId:id,...tree}).strict(),
 z.object({type:z.literal('worktree.attach'),hubId,taskId:id,path:z.string().min(1)}).strict(),
 z.object({type:z.literal('worktree.dismiss'),hubId,taskId:id}).strict(),
 z.object({type:z.literal('worktree.remove'),hubId,taskId:id,confirmed:z.boolean(),expectedWorktreePath:z.string().nullable(),discardChanges:z.boolean().optional(),force:z.boolean().optional()}).strict(),
 z.object({type:z.enum(['operation.retry','operation.return']),hubId,taskId:id}).strict(),
 z.object({type:z.literal('operation.dismiss'),hubId,taskId:id}).strict(),
 z.object({type:z.literal('note.save'),hubId,taskId:id,noteId:id.optional(),content:z.string().optional(),tags:z.array(z.string()).optional()}).strict(),
  z.object({type:z.literal('note.delete'),hubId,taskId:id,noteId:id}).strict(),
  z.object({type:z.literal('schedule.save'),hubId:id,scheduleId:id.optional(),title:z.string().min(1),prompt:z.string().min(1),cron:z.string().min(1),timeZone:z.string().min(1),projectId:id,model:modelSelection.optional(),newConversation:z.boolean(),archiveWhenIdle:z.boolean(),expectedRevision:revision}).strict(),
  z.object({type:z.literal('schedule.delete'),hubId:id,scheduleId:id,confirmed:z.boolean(),expectedRevision:revision}).strict(),
  z.object({type:z.literal('schedule.setEnabled'),hubId:id,scheduleId:id,enabled:z.boolean(),expectedRevision:revision}).strict(),
  z.object({type:z.literal('schedule.runNow'),hubId:id,scheduleId:id}).strict(),
]);
export const QuestionPageSchema=z.object({question:z.string(),type:z.enum(['exclusive','non_exclusive','freetext']),context:z.string().optional(),options:z.array(z.object({title:z.string(),description:z.string()}).strict()).optional(),weight:z.enum(['critical','medium','easy']).optional(),model_lean:z.string().optional(),model_lean_reason:z.string().optional(),answers_affect_followup:z.boolean().optional()}).strict();
export const QuestionRoundSchema=z.object({id:z.string(),sessionId:z.string(),turnId:z.string(),pages:z.array(z.object({callId:z.string(),sequence:z.number(),page:QuestionPageSchema}).strict()),complete:z.boolean(),answered:z.boolean()}).strict();
export const QuestionFeedFrameSchema:z.ZodType<QuestionFeedFrame>=z.object({kind:z.enum(['baseline','update']),rounds:z.array(QuestionRoundSchema)}).strict();
const SettledTurnSchema=z.object({seq:z.number().int().nonnegative(),outcome:z.enum(['ok','error'])}).strict();
const BackgroundActivitySchema=z.object({kind:z.enum(['job','schedule']),label:z.string()}).strict();
const PendingUserWorkSchema=z.object({kinds:z.array(z.enum(['decision-question','native-question','approval','queued-prompt'])),queuedPrompts:z.number().int().nonnegative()}).strict();
const ConversationFactsSchema=z.object({running:z.boolean(),background:z.array(BackgroundActivitySchema),pending:PendingUserWorkSchema,settledTurn:SettledTurnSchema.nullable()}).strict();
const ProblemSchema=z.object({code:z.string(),message:z.string(),details:z.record(z.string(),z.unknown()).optional()}).strict();
const sharingBoardState=z.enum(['in-sync','draft','updates-available','needs-review','orphan']);
const sharingHubStatus=z.enum(['not-published','preview','published','updates-available','needs-review','unavailable']);
const sharingStorage=z.enum(SHARING_STORAGES);
const sharingSyncMode=z.enum(['explicit','continuous']);
const sharingAuthStatus=z.enum(['not-connected','authorizing','connected','error','reconnect-required']);
const sharingBlocker=z.object({code:z.string(),message:z.string(),boardId:id.optional(),boardName:z.string().optional(),columnId:id.optional(),tasks:z.number().int().nonnegative().optional()}).strict();
const sharingBoardView=z.object({boardId:id,key:id.optional(),name:z.string().min(1),state:sharingBoardState,bound:z.boolean(),pending:z.boolean(),detail:z.object({local:z.string(),team:z.string(),localName:z.string(),teamName:z.string()}).strict().optional()}).strict();
export const SharingAuthViewSchema:z.ZodType<SharingAuthView>=z.object({
 status:sharingAuthStatus,authorizationUrl:z.string().optional(),email:z.string().optional(),error:ProblemSchema.optional(),
 drives:z.array(z.object({id:id,name:z.string().min(1)}).strict()).optional(),
 folders:z.array(z.object({id:id,name:z.string().min(1)}).strict()).optional(),
}).strict();
export const HubSharingViewSchema:z.ZodType<HubSharingView>=z.object({
 status:sharingHubStatus,provider:sharingStorage,providerLabel:z.string().min(1),supportsFiles:z.boolean(),address:z.string(),repository:z.string().optional(),syncMode:sharingSyncMode,
 authorization:sharingAuthStatus.optional(),
 intervalMinutes:z.number().int().nonnegative(),lastCheckedAt:z.string().optional(),lastSyncedAt:z.string().optional(),error:ProblemSchema.optional(),
 drafts:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),updates:z.number().int().nonnegative(),conflicts:z.number().int().nonnegative(),orderChanged:z.boolean(),syncing:z.boolean(),
 boards:z.array(sharingBoardView),incoming:z.array(z.object({key:id,name:z.string().min(1)}).strict()),
 removed:z.array(z.object({boardId:id,key:id,name:z.string().min(1)}).strict()),blockers:z.array(sharingBlocker),
 preview:z.object({publishedBoards:z.number().int().nonnegative(),localBoards:z.number().int().nonnegative()}).strict().optional(),
 removing:z.array(z.object({boardId:id,name:z.string().min(1)}).strict()),
}).strict();
const drivePath=z.string().min(1).max(4096);
export const DriveLocationViewSchema=z.object({id:drivePath,rootPath:drivePath,kind:z.enum(['account','legacy']),status:z.enum(['available','unavailable']),account:z.string().optional(),driveName:z.string().optional(),reason:z.string().optional()}).strict();
export const DriveDiscoveryViewSchema:z.ZodType<DriveDiscoveryView>=z.object({state:z.enum(['ready','empty','app-missing','unsupported','failed']),locations:z.array(DriveLocationViewSchema),sources:z.array(z.object({id:z.string().min(1).max(200),ok:z.boolean(),reason:z.string().max(500).optional()}).strict()).optional(),reason:ProblemSchema.optional()}).strict();
export const DriveBrowseViewSchema:z.ZodType<DriveBrowseView>=z.object({rootId:drivePath,path:drivePath,parent:drivePath.nullable(),entries:z.array(z.object({name:z.string().min(1),path:drivePath,group:z.object({id:z.enum(['my-drive','shared-drives']),label:z.string().min(1)}).strict().optional()}).strict()),hasDocument:z.boolean(),truncated:z.boolean(),shown:z.number().int().nonnegative()}).strict();
export const LocalDriveRequestSchema:z.ZodType<LocalDriveRequest>=z.discriminatedUnion('action',[
 z.object({action:z.literal('roots'),refresh:z.boolean().optional()}).strict(),
 z.object({action:z.literal('list'),path:z.string().min(1).max(4096)}).strict(),
]);
export const LocalDriveResultSchema:z.ZodType<LocalDriveResult>=z.discriminatedUnion('action',[
 z.object({action:z.literal('roots'),discovery:DriveDiscoveryViewSchema}).strict(),
 z.object({action:z.literal('list'),page:DriveBrowseViewSchema}).strict(),
]);
export const SnapshotRequestSchema:z.ZodType<SnapshotRequest>=z.object({refreshSessionIds:z.array(id).optional(),priorityTaskIds:z.array(id).optional(),refreshAuth:z.boolean().optional()}).strict();
export const SnapshotSchema:z.ZodType<HostSnapshot>=z.object({commandReceipt:z.object({kind:z.enum(['hub','board','project','task','conversation','note','schedule']),id,model:z.object({requested:modelSelection,applied:z.boolean(),reason:z.enum(['unavailable','unsupported','failed']).optional(),inUse:modelSelection.optional()}).strict().optional()}).strict().optional(),state:KanbanStateSchema.optional(),stateRevision:z.number().int().nonnegative(),conversations:z.record(z.string(),ConversationFactsSchema),sharing:z.record(z.string(),HubSharingViewSchema),sharingAuth:SharingAuthViewSchema.optional(),scheduleRuntime:z.record(z.string(),z.record(z.string(),scheduleRuntimeView)).optional(),retainedCheckouts:z.array(z.object({path:z.string(),projectId:id,taskTitle:z.string()}).strict()).optional(),sequence:z.number().int().nonnegative()}).strict();
export const SharingCommandSchema:z.ZodType<SharingCommand>=z.discriminatedUnion('type',[
 z.object({type:z.literal('sharing.connect'),hubId:id,provider:sharingStorage.optional(),settings:z.record(z.string(),z.string()).optional(),repository:z.string().min(1).max(2048).optional(),intervalMinutes:z.number().int().min(0).max(1440).optional()}).strict(),
 z.object({type:z.literal('sharing.receive'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.publishInitial'),hubId:id,confirmed:z.boolean()}).strict(),
 z.object({type:z.literal('sharing.check'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.getUpdates'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.updateBoard'),hubId:id,boardId:id}).strict(),
 z.object({type:z.literal('sharing.publishBoard'),hubId:id,boardId:id}).strict(),
 z.object({type:z.literal('sharing.resolve'),hubId:id,boardId:id,choice:z.enum(['local','team'])}).strict(),
 z.object({type:z.literal('sharing.publish'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.setInterval'),hubId:id,intervalMinutes:z.number().int().min(0).max(1440)}).strict(),
 z.object({type:z.literal('sharing.disconnect'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.restore'),hubId:id,boardId:id}).strict(),
 z.object({type:z.literal('sharing.publishOrphan'),hubId:id,boardId:id}).strict(),
 z.object({type:z.literal('sharing.auth.start')}).strict(),
 z.object({type:z.literal('sharing.auth.cancel')}).strict(),
 z.object({type:z.literal('sharing.auth.disconnect')}).strict(),
 z.object({type:z.literal('sharing.auth.switch')}).strict(),
 z.object({type:z.literal('sharing.drives')}).strict(),
 z.object({type:z.literal('sharing.folders'),driveId:id.optional(),parentId:id.optional()}).strict(),
 z.object({type:z.literal('sharing.changeLocation'),hubId:id,settings:z.record(z.string(),z.string()),confirmed:z.boolean()}).strict(),
]);
const outcome=<T extends z.ZodType>(value:T)=>z.discriminatedUnion('ok',[z.object({ok:z.literal(true),value}).strict(),z.object({ok:z.literal(false),error:ProblemSchema}).strict()]);
const codec=(name:string,create:()=>z.ZodType)=>({mode:'strict' as const,typeSymbol:PACKAGE_NAME+'#'+name,create});
const parameter=(name:string,schema:z.ZodType,typeName:string)=>({name,source:'json' as const,codec:codec(typeName,()=>schema),strictCodec:codec(typeName,()=>schema)});
const base={service:'kanbanController',invocation:{kind:'direct' as const}};
const contribution=createTypertContribution({package:PACKAGE_NAME,methods:{
 'kanban/snapshot':{...base,parameters:[parameter('request',SnapshotRequestSchema,'SnapshotRequest')],result:codec('SnapshotOutcome',()=>outcome(SnapshotSchema))},
 'kanban/command':{...base,parameters:[parameter('request',CommandSchema,'Command')],result:codec('CommandOutcome',()=>outcome(SnapshotSchema))},
 'kanban/sharing':{...base,parameters:[parameter('request',SharingCommandSchema,'SharingCommand')],result:codec('SharingOutcome',()=>outcome(SnapshotSchema))},
 'kanban/branches':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('BranchesOutcome',()=>outcome(z.array(z.string())))},
 'kanban/worktreeDefault':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('WorktreeDefaultOutcome',()=>outcome(worktreeDefault))},
 'kanban/detectProject':{...base,parameters:[parameter('request',z.object({path:z.string().min(1)}).strict(),'ProjectPathLookup')],result:codec('ProjectLocationOutcome',()=>outcome(projectLocation))},
 'kanban/localDrive':{...base,parameters:[parameter('request',LocalDriveRequestSchema,'LocalDriveRequest')],result:codec('LocalDriveOutcome',()=>outcome(LocalDriveResultSchema))},
 'kanban/dismissQuestions':{...base,parameters:[parameter('request',z.object({sessionId:id,roundId:id}).strict(),'QuestionDismissal')],result:codec('QuestionDismissalOutcome',()=>outcome(z.array(QuestionRoundSchema)))},
 'kanban/modelCatalog':{...base,parameters:[parameter('request',z.object({refresh:z.boolean().optional()}).strict(),'ModelCatalogLookup')],result:codec('ModelCatalogOutcome',()=>outcome(ModelCatalogSchema))},
 'kanban/questionsFollow':{...base,mode:'stream',parameters:[parameter('request',z.object({sessionId:id}).strict(),'SessionLookup')],cancellation:{parameter:'signal'},result:codec('QuestionFeedFrame',()=>QuestionFeedFrameSchema)},
 'kanban/follow':{...base,mode:'stream',parameters:[],cancellation:{parameter:'signal'},result:codec('Snapshot',()=>SnapshotSchema)},
}},z);
export const TYPERT_REMOTE=contribution.remote;
export const TYPERT_HOST:TypertContribution=contribution.host;
export interface KanbanRemote {
 snapshot(request:SnapshotRequest):Promise<RemoteResult<Outcome<HostSnapshot>>>;
 command(request:Command):Promise<RemoteResult<Outcome<HostSnapshot>>>;
 sharing(request:SharingCommand):Promise<RemoteResult<Outcome<HostSnapshot>>>;
 branches(request:{taskId:string}):Promise<RemoteResult<Outcome<string[]>>>;
 worktreeDefault(request:{taskId:string}):Promise<RemoteResult<Outcome<WorktreeDefaults>>>;
 detectProject(request:{path:string}):Promise<RemoteResult<Outcome<ProjectLocation>>>;
 localDrive(request:LocalDriveRequest):Promise<RemoteResult<Outcome<LocalDriveResult>>>;
 dismissQuestions(request:{sessionId:string;roundId:string}):Promise<RemoteResult<Outcome<QuestionRound[]>>>;
 modelCatalog(request:{refresh?:boolean}):Promise<RemoteResult<Outcome<ModelCatalog>>>;
 questionsFollow(request:{sessionId:string},signal?:AbortSignal):RemoteStreamHandle<QuestionFeedFrame,never>;
 follow(signal?:AbortSignal):RemoteStreamHandle<HostSnapshot, never>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
 interface TypertRemoteNamespaceMap {kanban:KanbanRemote}
 interface TypertRemoteMap {
  'kanban/snapshot':KanbanRemote['snapshot']; 'kanban/command':KanbanRemote['command']; 'kanban/sharing':KanbanRemote['sharing'];
  'kanban/branches':KanbanRemote['branches']; 'kanban/worktreeDefault':KanbanRemote['worktreeDefault']; 'kanban/detectProject':KanbanRemote['detectProject']; 'kanban/localDrive':KanbanRemote['localDrive']; 'kanban/dismissQuestions':KanbanRemote['dismissQuestions']; 'kanban/modelCatalog':KanbanRemote['modelCatalog']; 'kanban/questionsFollow':KanbanRemote['questionsFollow']; 'kanban/follow':KanbanRemote['follow'];
 }
}
export default TYPERT_REMOTE;
