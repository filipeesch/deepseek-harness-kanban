import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
import { KanbanStateSchema } from './domain/hub-schema.js';
import type { Command, HostSnapshot, HubSharingView, Outcome, ProjectLocation, QuestionFeedFrame, QuestionRound, SharingAuthView, SharingCommand } from './shared/types.js';
import { SHARING_STORAGES } from './shared/types.js';
export const PACKAGE_NAME = 'dsh-kanban';
const id=z.string().min(1).max(200);
const revision=z.number().int().nonnegative().optional();
const project=z.object({id:id.optional(),name:z.string().min(1),projectPath:z.string().min(1),gitRootPath:z.string().optional(),defaultBranch:z.string().optional()}).strict();
const hubId=id.optional();
const boardId=id.optional();
const projectLocation=z.discriminatedUnion('kind',[z.object({kind:z.literal('git'),projectPath:z.string(),gitRootPath:z.string(),defaultBranch:z.string().optional()}).strict(),z.object({kind:z.literal('folder'),projectPath:z.string()}).strict()]);
const tree={mode:z.enum(['new','existing']),path:z.string().min(1),branchName:z.string().min(1),sourceBranch:z.string().optional()};
const boardSettings=z.object({worktreeBasePath:z.string().optional()}).strict();
const worktreeDefault=z.object({branchName:z.string().min(1),path:z.string()}).strict();
export const CommandSchema:z.ZodType<Command>=z.discriminatedUnion('type',[
 z.object({type:z.literal('hub.create'),name:z.string().min(1)}).strict(),
 z.object({type:z.literal('hub.rename'),hubId:id,name:z.string().min(1),expectedRevision:revision}).strict(),
 z.object({type:z.literal('hub.delete'),hubId:id,confirmed:z.boolean()}).strict(),
 z.object({type:z.literal('board.create'),hubId:id,name:z.string().min(1)}).strict(),
 z.object({type:z.literal('board.rename'),hubId:id,boardId:id,name:z.string().min(1),expectedRevision:revision}).strict(),
 z.object({type:z.literal('board.delete'),hubId:id,boardId:id,confirmed:z.boolean(),expectedRevision:revision,sharing:z.enum(['local','team']).optional()}).strict(),
 z.object({type:z.literal('board.workflow.save'),hubId:id,boardId:id,yaml:z.string(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.save'),hubId,project,expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.delete'),hubId,projectId:id,confirmed:z.boolean(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('workflow.save'),hubId,yaml:z.string(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('settings.save'),settings:boardSettings,expectedRevision:revision}).strict(),
 z.object({type:z.literal('task.create'),hubId,boardId,projectId:id,title:z.string().min(1),description:z.string()}).strict(),
 z.object({type:z.literal('task.edit'),hubId,taskId:id,title:z.string().optional(),description:z.string().optional(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('task.move'),hubId,taskId:id,columnId:id,beforeTaskId:id.nullable().optional(),overrideTransition:z.boolean().optional()}).strict(),
 z.object({type:z.literal('task.autoMode'),hubId,taskId:id,enabled:z.boolean()}).strict(),
 z.object({type:z.literal('task.runInstruction'),hubId,taskId:id,columnId:id,expectedEnteredAt:z.number().finite(),expectedInstruction:z.string()}).strict(),
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
 status:sharingHubStatus,provider:sharingStorage,providerLabel:z.string().min(1),address:z.string(),repository:z.string().optional(),syncMode:sharingSyncMode,
 authorization:sharingAuthStatus.optional(),
 intervalMinutes:z.number().int().nonnegative(),lastCheckedAt:z.string().optional(),lastSyncedAt:z.string().optional(),error:ProblemSchema.optional(),
 drafts:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),updates:z.number().int().nonnegative(),conflicts:z.number().int().nonnegative(),orderChanged:z.boolean(),syncing:z.boolean(),
 boards:z.array(sharingBoardView),incoming:z.array(z.object({key:id,name:z.string().min(1)}).strict()),
 removed:z.array(z.object({boardId:id,key:id,name:z.string().min(1)}).strict()),blockers:z.array(sharingBlocker),
 preview:z.object({publishedBoards:z.number().int().nonnegative(),localBoards:z.number().int().nonnegative()}).strict().optional(),
 removing:z.array(z.object({boardId:id,name:z.string().min(1)}).strict()),
}).strict();
export const SnapshotSchema:z.ZodType<HostSnapshot>=z.object({commandReceipt:z.object({kind:z.enum(['hub','board','project','task','conversation','note']),id}).strict().optional(),state:KanbanStateSchema,conversations:z.record(z.string(),ConversationFactsSchema),sharing:z.record(z.string(),HubSharingViewSchema),sharingAuth:SharingAuthViewSchema.optional(),sequence:z.number().int().nonnegative()}).strict();
export const SharingCommandSchema:z.ZodType<SharingCommand>=z.discriminatedUnion('type',[
 z.object({type:z.literal('sharing.connect'),hubId:id,provider:sharingStorage.optional(),settings:z.record(z.string(),z.string()).optional(),repository:z.string().min(1).max(2048).optional(),intervalMinutes:z.number().int().min(0).max(1440).optional()}).strict(),
 z.object({type:z.literal('sharing.receive'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.publishInitial'),hubId:id,confirmed:z.boolean()}).strict(),
 z.object({type:z.literal('sharing.check'),hubId:id}).strict(),
 z.object({type:z.literal('sharing.getUpdates'),hubId:id}).strict(),
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
]);
const outcome=<T extends z.ZodType>(value:T)=>z.discriminatedUnion('ok',[z.object({ok:z.literal(true),value}).strict(),z.object({ok:z.literal(false),error:ProblemSchema}).strict()]);
const codec=(name:string,create:()=>z.ZodType)=>({mode:'strict' as const,typeSymbol:PACKAGE_NAME+'#'+name,create});
const parameter=(name:string,schema:z.ZodType,typeName:string)=>({name,source:'json' as const,codec:codec(typeName,()=>schema),strictCodec:codec(typeName,()=>schema)});
const base={service:'kanbanController',invocation:{kind:'direct' as const}};
export const TYPERT_REMOTE=createTypertRemoteInfo({package:PACKAGE_NAME,methods:{
 'kanban/snapshot':{...base,parameters:[],result:codec('SnapshotOutcome',()=>outcome(SnapshotSchema))},
 'kanban/command':{...base,parameters:[parameter('request',CommandSchema,'Command')],result:codec('CommandOutcome',()=>outcome(SnapshotSchema))},
 'kanban/sharing':{...base,parameters:[parameter('request',SharingCommandSchema,'SharingCommand')],result:codec('SharingOutcome',()=>outcome(SnapshotSchema))},
 'kanban/branches':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('BranchesOutcome',()=>outcome(z.array(z.string())))},
 'kanban/worktreeDefault':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('WorktreeDefaultOutcome',()=>outcome(worktreeDefault))},
 'kanban/detectProject':{...base,parameters:[parameter('request',z.object({path:z.string().min(1)}).strict(),'ProjectPathLookup')],result:codec('ProjectLocationOutcome',()=>outcome(projectLocation))},
 'kanban/dismissQuestions':{...base,parameters:[parameter('request',z.object({sessionId:id,roundId:id}).strict(),'QuestionDismissal')],result:codec('QuestionDismissalOutcome',()=>outcome(z.array(QuestionRoundSchema)))},
 'kanban/questionsFollow':{...base,mode:'stream',parameters:[parameter('request',z.object({sessionId:id}).strict(),'SessionLookup')],cancellation:{parameter:'signal'},result:codec('QuestionFeedFrame',()=>QuestionFeedFrameSchema)},
 'kanban/follow':{...base,mode:'stream',parameters:[],cancellation:{parameter:'signal'},result:codec('Snapshot',()=>SnapshotSchema)},
}},z);
export const TYPERT_HOST:TypertContribution={package:PACKAGE_NAME,face:'host',schemas:[],get invocations(){return TYPERT_REMOTE.descriptors;},model:{services:[],events:[],objects:[]}};
export interface KanbanRemote {
 snapshot():Promise<RemoteResult<Outcome<HostSnapshot>>>;
 command(request:Command):Promise<RemoteResult<Outcome<HostSnapshot>>>;
 sharing(request:SharingCommand):Promise<RemoteResult<Outcome<HostSnapshot>>>;
 branches(request:{taskId:string}):Promise<RemoteResult<Outcome<string[]>>>;
 worktreeDefault(request:{taskId:string}):Promise<RemoteResult<Outcome<{branchName:string;path:string}>>>;
 detectProject(request:{path:string}):Promise<RemoteResult<Outcome<ProjectLocation>>>;
 dismissQuestions(request:{sessionId:string;roundId:string}):Promise<RemoteResult<Outcome<QuestionRound[]>>>;
 questionsFollow(request:{sessionId:string},signal?:AbortSignal):RemoteStreamHandle<QuestionFeedFrame,never>;
 follow(signal?:AbortSignal):RemoteStreamHandle<HostSnapshot, never>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
 interface TypertRemoteNamespaceMap {kanban:KanbanRemote}
 interface TypertRemoteMap {
  'kanban/snapshot':KanbanRemote['snapshot']; 'kanban/command':KanbanRemote['command']; 'kanban/sharing':KanbanRemote['sharing'];
  'kanban/branches':KanbanRemote['branches']; 'kanban/worktreeDefault':KanbanRemote['worktreeDefault']; 'kanban/detectProject':KanbanRemote['detectProject']; 'kanban/dismissQuestions':KanbanRemote['dismissQuestions']; 'kanban/questionsFollow':KanbanRemote['questionsFollow']; 'kanban/follow':KanbanRemote['follow'];
 }
}
export default TYPERT_REMOTE;
