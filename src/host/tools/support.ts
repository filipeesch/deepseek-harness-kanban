import { defineTool, type ParameterSchemaSpec, type InferArgs, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { json } from '../../shared/json.js';
import type { TaskHistoryEntry } from '../../shared/task-history.js';

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
