import { defineTool, type ParameterSchemaSpec, type InferArgs, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { json } from '../../shared/json.js';
import { KanbanError, problem } from '../../shared/errors.js';
import type { BoardPublishingOutcome, WorkflowWriteOutcome } from '../board-administration.js';
import type { WorkflowReportSummary, WorkflowWriteReport } from '../../domain/workflow-report.js';
import type { RevisionActor } from '../../domain/revisions/log.js';

export function text(description:string,required:true):{type:'string';description:string;required:true};
export function text(description:string,required?:undefined):{type:'string';description:string};
export function text(description:string,required?:true){return {type:'string' as const,description,...(required?{required}: {})};}
export function flag(description:string,required?:true){return {type:'boolean' as const,description,...(required?{required}: {})};}

/** The report a write returns, in either shape. */
export type WorkflowReportShape = WorkflowWriteReport | WorkflowReportSummary;

export function normal<S extends ParameterSchemaSpec>(name:string,description:string,parameters:S,execute:(args:InferArgs<S>,exec:ToolRunContext)=>Promise<unknown>,read=false):ToolDefinition{
 return defineTool({name,description,parameters,isConcurrencySafe:()=>read,output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]},execute:async(args,exec)=>{exec.signal.throwIfAborted();return json(await execute(args,exec));}});
}

/** The board a write reports, without the report itself. */
export function boardResult(value:{board:{id:string;name:string};hubId:string;hubRevision:number;sharing:BoardPublishingOutcome}){
 return {...value.board,hubId:value.hubId,hubRevision:value.hubRevision,sharing:value.sharing};
}

/**
 * One reviewed workflow write. The board's document is deliberately absent: the
 * caller reads it with the exact-document tool when it needs it, and the report
 * carries the digest of exactly the bytes that were stored.
 */
export function written(value:WorkflowWriteOutcome){
 if(value.saved===false)return {id:value.boardId,name:value.name,hubId:value.hubId,hubRevision:value.hubRevision,saved:false as const,dryRun:true as const,sha256:value.sha256,report:value.report};
 const summary={id:value.board.id,name:value.board.name,hubId:value.hubId,hubRevision:value.hubRevision,sharing:value.sharing,saved:true as const,sha256:value.sha256};
 return {...summary,report:value.report};
}

/** A refused workflow write, carrying the report the review produced once. */
export function refusal(error:unknown):{saved:false;error:{code:string;message:string};sha256?:string;details?:Record<string,unknown>;report:WorkflowReportShape}|undefined{
 if(!(error instanceof KanbanError))return undefined;
 const report=error.details?.report;
 if(typeof report!=='object'||report===null)return undefined;
 const sha256=error.details?.sha256;
 const details=error.details===undefined?undefined:Object.fromEntries(Object.entries(error.details).filter(([key])=>key!=='report'));
 return {
  saved:false,error:{code:error.code,message:error.message},
  ...(typeof sha256==='string'?{sha256}:{}),
  ...(details===undefined||Object.keys(details).length===0?{}:{details}),
  report:report as WorkflowReportShape,
 };
}

/** A write refused because the composed document did not match the expected digest. */
export function digestRefusal(error:unknown):{saved:false;error:{code:string;message:string};expected:string;actual:string}|undefined{
 if(!(error instanceof KanbanError)||error.code!=='EXPECTED_SHA256_MISMATCH')return undefined;
 const expected=error.details?.expected;const actual=error.details?.actual;
 if(typeof expected!=='string'||typeof actual!=='string')return undefined;
 return {saved:false,error:{code:error.code,message:error.message},expected,actual};
}

/** The calling session as a revision author; board writes only run in an owning chat. */
export function actorOf(exec: ToolRunContext): RevisionActor {
  return { kind: 'agent', sessionId: exec.agent?.id ?? 'unknown' };
}
