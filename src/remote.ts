import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
import { BoardStateSchema } from './domain/schema.js';
import type { BoardSnapshot, Command, Outcome, QuestionRound } from './shared/types.js';
export const PACKAGE_NAME = 'dsh-kanban';
const id=z.string().min(1).max(200);
const revision=z.number().int().nonnegative().optional();
const project=z.object({id:id.optional(),name:z.string().min(1),projectPath:z.string().min(1),gitRootPath:z.string().min(1),defaultBranch:z.string().optional()}).strict();
const inferredProject=z.object({projectPath:z.string(),gitRootPath:z.string()}).strict();
const tree={mode:z.enum(['new','existing']),path:z.string().min(1),branchName:z.string().min(1),sourceBranch:z.string().optional()};
const boardSettings=z.object({worktreeBasePath:z.string().optional()}).strict();
const worktreeDefault=z.object({branchName:z.string().min(1),path:z.string()}).strict();
export const CommandSchema:z.ZodType<Command>=z.discriminatedUnion('type',[
 z.object({type:z.literal('project.save'),project,expectedRevision:revision}).strict(),
 z.object({type:z.literal('project.delete'),projectId:id,confirmed:z.boolean(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('workflow.save'),yaml:z.string(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('settings.save'),settings:boardSettings,expectedRevision:revision}).strict(),
 z.object({type:z.literal('task.create'),projectId:id,title:z.string().min(1),description:z.string()}).strict(),
 z.object({type:z.literal('task.edit'),taskId:id,title:z.string().optional(),description:z.string().optional(),expectedRevision:revision}).strict(),
 z.object({type:z.literal('task.move'),taskId:id,columnId:id,mode:z.enum(['move','run']),sessionId:id.optional(),newConversation:z.boolean().optional(),worktree:z.object(tree).strict().optional(),expectedInstruction:z.string().optional(),beforeTaskId:id.nullable().optional()}).strict(),
 z.object({type:z.literal('task.runInstruction'),taskId:id,columnId:id,expectedInstruction:z.string()}).strict(),
 z.object({type:z.literal('conversation.create'),taskId:id}).strict(),
 z.object({type:z.enum(['conversation.close','conversation.reopen']),taskId:id,sessionId:id}).strict(),
 z.object({type:z.literal('task.delete'),taskId:id,confirmed:z.boolean(),expectedWorktreePath:z.string().nullable(),discardChanges:z.boolean().optional(),requireIdle:z.boolean().optional()}).strict(),
 z.object({type:z.literal('worktree.create'),taskId:id,...tree}).strict(),
 z.object({type:z.literal('worktree.attach'),taskId:id,path:z.string().min(1)}).strict(),
 z.object({type:z.literal('worktree.remove'),taskId:id,confirmed:z.boolean(),expectedWorktreePath:z.string().nullable(),discardChanges:z.boolean().optional()}).strict(),
 z.object({type:z.enum(['operation.retry','operation.return']),taskId:id}).strict(),
 z.object({type:z.literal('note.save'),taskId:id,noteId:id.optional(),content:z.string(),tags:z.array(z.string()).optional()}).strict(),
]);
export const QuestionPageSchema=z.object({question:z.string(),type:z.enum(['exclusive','non_exclusive','freetext']),context:z.string().optional(),options:z.array(z.object({title:z.string(),description:z.string()}).strict()).optional(),weight:z.enum(['critical','medium','easy']).optional(),model_lean:z.string().optional(),model_lean_reason:z.string().optional(),answers_affect_followup:z.boolean().optional()}).strict();
export const QuestionRoundSchema=z.object({id:z.string(),sessionId:z.string(),turnId:z.string(),pages:z.array(z.object({callId:z.string(),sequence:z.number(),page:QuestionPageSchema}).strict()),complete:z.boolean(),answered:z.boolean()}).strict();
export const SnapshotSchema:z.ZodType<BoardSnapshot>=z.object({commandReceipt:z.object({kind:z.enum(['project','task','conversation','note']),id}).strict().optional(),state:BoardStateSchema,attention:z.record(z.string(),z.object({running:z.boolean(),background:z.array(z.object({kind:z.enum(['job','subagent','schedule']),label:z.string()}).strict()),unread:z.boolean(),awaitingReply:z.boolean(),failed:z.boolean()}).strict()),sequence:z.number().int().nonnegative(),questionRounds:z.array(QuestionRoundSchema).optional()}).strict();
const ProblemSchema=z.object({code:z.string(),message:z.string(),details:z.record(z.string(),z.unknown()).optional()}).strict();
const outcome=<T extends z.ZodType>(value:T)=>z.discriminatedUnion('ok',[z.object({ok:z.literal(true),value}).strict(),z.object({ok:z.literal(false),error:ProblemSchema}).strict()]);
const codec=(name:string,create:()=>z.ZodType)=>({mode:'strict' as const,typeSymbol:PACKAGE_NAME+'#'+name,create});
const parameter=(name:string,schema:z.ZodType,typeName:string)=>({name,source:'json' as const,codec:codec(typeName,()=>schema),strictCodec:codec(typeName,()=>schema)});
const base={service:'kanbanController',invocation:{kind:'direct' as const}};
export const TYPERT_REMOTE=createTypertRemoteInfo({package:PACKAGE_NAME,methods:{
 'kanban/snapshot':{...base,parameters:[],result:codec('SnapshotOutcome',()=>outcome(SnapshotSchema))},
 'kanban/command':{...base,parameters:[parameter('request',CommandSchema,'Command')],result:codec('CommandOutcome',()=>outcome(SnapshotSchema))},
 'kanban/branches':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('BranchesOutcome',()=>outcome(z.array(z.string())))},
 'kanban/worktreeDefault':{...base,parameters:[parameter('request',z.object({taskId:id}).strict(),'TaskLookup')],result:codec('WorktreeDefaultOutcome',()=>outcome(worktreeDefault))},
 'kanban/inferProject':{...base,parameters:[parameter('request',z.object({path:z.string().min(1)}).strict(),'ProjectPathLookup')],result:codec('ProjectPathOutcome',()=>outcome(inferredProject))},
 'kanban/questions':{...base,parameters:[parameter('request',z.object({sessionId:id}).strict(),'SessionLookup')],result:codec('QuestionOutcome',()=>outcome(z.array(QuestionRoundSchema)))},
 'kanban/dismissQuestions':{...base,parameters:[parameter('request',z.object({sessionId:id,roundId:id}).strict(),'QuestionDismissal')],result:codec('QuestionDismissalOutcome',()=>outcome(z.array(QuestionRoundSchema)))},
 'kanban/follow':{...base,mode:'stream',parameters:[],cancellation:{parameter:'signal'},result:codec('Snapshot',()=>SnapshotSchema)},
}},z);
export const TYPERT_HOST:TypertContribution={package:PACKAGE_NAME,face:'host',schemas:[],get invocations(){return TYPERT_REMOTE.descriptors;},model:{services:[],events:[],objects:[]}};
export interface KanbanRemote {
 snapshot():Promise<RemoteResult<Outcome<BoardSnapshot>>>;
 command(request:Command):Promise<RemoteResult<Outcome<BoardSnapshot>>>;
 branches(request:{taskId:string}):Promise<RemoteResult<Outcome<string[]>>>;
 worktreeDefault(request:{taskId:string}):Promise<RemoteResult<Outcome<{branchName:string;path:string}>>>;
 inferProject(request:{path:string}):Promise<RemoteResult<Outcome<{projectPath:string;gitRootPath:string}>>>;
 questions(request:{sessionId:string}):Promise<RemoteResult<Outcome<QuestionRound[]>>>;
 dismissQuestions(request:{sessionId:string;roundId:string}):Promise<RemoteResult<Outcome<QuestionRound[]>>>;
 follow(signal?:AbortSignal):RemoteStreamHandle<BoardSnapshot, never>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
 interface TypertRemoteNamespaceMap {kanban:KanbanRemote}
 interface TypertRemoteMap {
  'kanban/snapshot':KanbanRemote['snapshot']; 'kanban/command':KanbanRemote['command'];
  'kanban/branches':KanbanRemote['branches']; 'kanban/worktreeDefault':KanbanRemote['worktreeDefault']; 'kanban/inferProject':KanbanRemote['inferProject']; 'kanban/questions':KanbanRemote['questions']; 'kanban/dismissQuestions':KanbanRemote['dismissQuestions']; 'kanban/follow':KanbanRemote['follow'];
 }
}
export default TYPERT_REMOTE;
