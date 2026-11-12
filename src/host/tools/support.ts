import { defineTool, type ParameterSchemaSpec, type InferArgs, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { json } from '../../shared/json.js';
import type { TaskHistoryEntry } from '../../shared/task-history.js';
import { KanbanError, problem } from '../../shared/errors.js';
import type { BoardWriteResult } from '../board-administration.js';
import type { WorkflowWriteReport } from '../../domain/workflow-report.js';
import type { RevisionActor } from '../../domain/revisions/log.js';

/**
 * One task as a tool returns it. The flow record stays out of a model's context:
 * it grows with the task, and the drawer is the surface that presents it.
 */
export function withoutHistory<T extends { history?: TaskHistoryEntry[]; deterministic?: unknown }>(task: T): Omit<T, 'history' | 'deterministic'> {
  const { history: _history, deterministic: _execution, ...rest } = task;
  return rest;
}

export function text(description:string,required:true):{type:'string';description:string;required:true};
export function text(description:string,required?:undefined):{type:'string';description:string};
export function text(description:string,required?:true){return {type:'string' as const,description,...(required?{required}: {})};}
export function flag(description:string,required?:true){return {type:'boolean' as const,description,...(required?{required}: {})};}

export function normal<S extends ParameterSchemaSpec>(name:string,description:string,parameters:S,execute:(args:InferArgs<S>,exec:ToolRunContext)=>Promise<unknown>,read=false):ToolDefinition{
 return defineTool({name,description,parameters,isConcurrencySafe:()=>read,output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();return json(await execute(args,exec));}});
}

/** The board a write reports, without the report itself. */
export function boardResult(value:BoardWriteResult){return {...value.board,hubId:value.hubId,hubRevision:value.hubRevision,sharing:value.sharing};}

/**
 * One accepted workflow write. The board's document is deliberately absent: the
 * caller reads it with the exact-document tool when it needs it, and a write
 * result must not carry a payload this change exists to keep out of context.
 */
export function written(value:BoardWriteResult&{report:WorkflowWriteReport}){
 const summary={id:value.board.id,name:value.board.name,hubId:value.hubId,hubRevision:value.hubRevision,sharing:value.sharing};
 return {...summary,report:value.report};
}

/** A refused workflow write, carrying the report the review produced once. */
export function refusal(error:unknown):{saved:false;error:{code:string;message:string};report:WorkflowWriteReport}|undefined{
 if(!(error instanceof KanbanError))return undefined;
 const report=error.details?.report;
 if(typeof report!=='object'||report===null)return undefined;
 return {saved:false,error:{code:error.code,message:error.message},report:report as WorkflowWriteReport};
}

/** The calling session as a revision author; board writes only run in an owning chat. */
export function actorOf(exec: ToolRunContext): RevisionActor {
  return { kind: 'agent', sessionId: exec.agent?.id ?? 'unknown' };
}
