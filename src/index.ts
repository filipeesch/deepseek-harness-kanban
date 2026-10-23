import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-typert-registry';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { TYPERT_HOST } from './remote.js';
import { BoardStore } from './domain/store.js';
import { openNativeStorage } from './host/storage.js';
import { openQuestionStorage } from './host/question-storage.js';
import { createNativePorts } from './host/native.js';
import { GitAdapter } from './host/git.js';
import { KanbanApp } from './host/app.js';
import { KanbanController } from './host/controller.js';
import { registerProductTools } from './host/tools.js';
import { KanbanError } from './shared/errors.js';
import { registerTaskContextInjection } from './host/task-context.js';

// The optional public schedule module emits this payloadless event; listening does not require its service.
declare module '@deepseek-ai/cordis' { interface Events { 'schedule/changed'():void } }

/** Invalidate attention from the canonical activity edges; the app owns the coalesced refresh. */
export function registerAttentionSignals(ctx:Context,app:Pick<KanbanApp,'sessionActivity'|'activityChanged'>):()=>void{
 const invalidateSubagent=(info:{id:Parameters<typeof ctx.sessions.get>[0]})=>{const child=ctx.sessions.get(info.id);const parent=child?.header.parentSession;app.sessionActivity(parent?String(parent):undefined);};
 const offAgent=ctx.on('agent/status',({agent})=>app.sessionActivity(String(agent.id)));
 const offSubagentStart=ctx.on('subagent/start',invalidateSubagent);
 const offSubagentEnd=ctx.on('subagent/end',invalidateSubagent);
 const offSchedule=ctx.on('schedule/changed',()=>app.activityChanged());
 return()=>{offAgent();offSubagentStart();offSubagentEnd();offSchedule();};
}

/** Public native hooks, not a lease: assembly/working-directory recovery precedes both admission boundaries. */
export function registerTaskExecutionGuards(ctx:Context,store:Pick<BoardStore,'snapshot'>,app:Pick<KanbanApp,'assertExecutionContext'>):()=>void{
 const taskFor=(id:string)=>store.snapshot().tasks.find(task=>task.sessionIds.includes(id));
 const changing=(task:ReturnType<typeof taskFor>)=>Boolean(task?.operation&&task.operation.phase!=='waiting'&&task.operation.phase!=='failed');
 const offStep=ctx.on('agent/pre-step',async(payload,next)=>{
  const task=taskFor(payload.agent.id);
  if(changing(task))return {kind:'reject'};
  if(task){await app.assertExecutionContext(payload.agent.id);payload.signal.throwIfAborted();if(changing(taskFor(payload.agent.id)))return {kind:'reject'};}
  return next();
 });
 const offRequest=ctx.on('agent/request',async(payload,next)=>{
  // next() resolves frozen request configuration, not a model invocation. Validate after downstream config middleware.
  const config=await next();
  if(taskFor(payload.agent.id)){
   if(changing(taskFor(payload.agent.id)))throw new KanbanError('CONTEXT_OPERATION_PENDING','Wait for the task directory operation before requesting a model.');
   await app.assertExecutionContext(payload.agent.id);payload.signal.throwIfAborted();
   if(changing(taskFor(payload.agent.id)))throw new KanbanError('CONTEXT_OPERATION_PENDING','The task directory operation changed before its model request.');
  }
  return config;
 });
 return()=>{offRequest();offStep();};
}
export const name='kanban';
export const inject=['storageDomain','sessionController','sessions','agents','workingDirectory','workspaceRegistry','sandboxPolicy','tools','typert'];
export async function apply(ctx:Context):Promise<void>{
 const storage=await openNativeStorage(ctx);
 let questions:{storage:import('./host/question-storage.js').QuestionStore;close:()=>Promise<void>};
 try{questions=await openQuestionStorage(ctx);}catch(error){await storage.close();throw error;}
 const lifetime=new AbortController();
 const native=createNativePorts(ctx);const store=await BoardStore.open(storage.storage);
 const report=(error:unknown)=>ctx.logger.warn(error instanceof Error?error.message:String(error));
 const app=new KanbanApp(store,native.sessions,new GitAdapter(native.executor),{signal:lifetime.signal,report,history:async id=>(await ctx.sessionController.inspect(SessionId(id),lifetime.signal)).events,questionStore:questions.storage},native.workspaces);
 let offTools:(()=>void)|undefined;let offWire:(()=>void)|undefined;let offGuards:(()=>void)|undefined;let offContext:(()=>void)|undefined;let offSignals:(()=>void)|undefined;
 ctx.effect(()=>async()=>{lifetime.abort();offTools?.();offWire?.();offGuards?.();offContext?.();offSignals?.();await app.close();await storage.close();await questions.close();});
 offWire=ctx.typert.register(TYPERT_HOST);
 ctx.plugin(KanbanController,app);
 offTools=registerProductTools(ctx,app);
 ctx.on('session/event',(session,event)=>{app.observe(session.id,event);});
 offSignals=registerAttentionSignals(ctx,app);
 offGuards=registerTaskExecutionGuards(ctx,store,app);
 offContext=registerTaskContextInjection(ctx,store,{report});
 await app.initialize();
}
