import type { Context } from '@deepseek-ai/cordis';
import os from 'node:os';
import type {} from '@deepseek-ai/dsh-typert-registry';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { TYPERT_HOST } from './remote.js';
import { HubRepository } from './host/hub-repository.js';
import { openKanbanStorage } from './host/storage.js';
import { openQuestionStorage } from './host/question-storage.js';
import { openSharingStorage } from './host/sharing/state.js';
import { HubSharingService } from './host/sharing/service.js';
import { SharingPollScheduler } from './host/sharing/scheduler.js';
import { createGitProviderDescriptor } from './host/sharing/git-store.js';
import { sharingRoot } from './host/sharing/root.js';
import type { SharingCommandRunner } from './host/sharing/command-runner.js';
import { GoogleDriveAuthService } from './host/sharing/google-drive-auth.js';
import { GoogleDriveAuthCoordinator } from './host/sharing/auth-coordinator.js';
import { createGoogleDriveProviderDescriptor } from './host/sharing/google-drive-store.js';
import { createLocalFolderProviderDescriptor } from './host/sharing/local-folder-store.js';
import { GoogleDriveLocalDiscovery } from './host/sharing/google-drive-local/discovery.js';
import { createDriveDiscoveryAdapter } from './host/sharing/google-drive-local/platform.js';
import { createGoogleDriveLocalProviderDescriptor } from './host/sharing/google-drive-local/descriptor.js';
import { nodeDiscoveryFs, type DiscoveryFs } from './host/sharing/google-drive-local/filesystem.js';
import { credentialStoreFromContext, type CredentialStore } from './host/sharing/credentials.js';
import { SharingProviderRegistry } from './host/sharing/provider.js';
import { createNativePorts } from './host/native.js';
import { registerConversationFacts } from './host/conversation-facts.js';
import { GitAdapter } from './host/git.js';
import { KanbanApp } from './host/app.js';
import { KanbanController } from './host/controller.js';
import { registerProductTools } from './host/tools.js';
import { KanbanError } from './shared/errors.js';
import { registerTaskContextInjection } from './host/task-context.js';
import { abortableSleep, ForkAdopter } from './host/conversation-adoption.js';
import type { TaskLocator } from './host/task-locator.js';

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
export function registerTaskExecutionGuards(ctx:Context,locator:Pick<TaskLocator,'bySession'>,app:Pick<KanbanApp,'assertExecutionContext'>):()=>void{
 const taskFor=(id:string)=>locator.bySession(id)?.task;
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
export interface ForkAdoptionRegistrationOptions {
 signal?:AbortSignal;
 report?:(error:unknown)=>void;
}
/**
 * Adopt a native fork of a task conversation as another conversation of that task.
 * The listener returns synchronously and runs adoption detached: agent/created is a
 * serial hook that creation awaits, so a rejection here would fail agent creation.
 */
export function registerForkAdoption(ctx:Pick<Context,'on'>,adopter:Pick<ForkAdopter,'adopt'>,options:ForkAdoptionRegistrationOptions={}):()=>void{
 const lifetime=new AbortController();
 const onAbort=()=>lifetime.abort();
 if(options.signal?.aborted)lifetime.abort();else options.signal?.addEventListener('abort',onAbort,{once:true});
 const report=(error:unknown)=>{try{options.report?.(error);}catch{/* a failing reporter must not escape */}};
 const off=ctx.on('agent/created',({agent})=>{
  if(lifetime.signal.aborted)return undefined;
  const header=agent.session.header;
  try{
   void adopter.adopt({
    sessionId:String(agent.session.id),
    ...(header.parentSession===undefined?{}:{parentSessionId:String(header.parentSession)}),
    ...(header.origin===undefined?{}:{origin:header.origin}),
   },lifetime.signal).catch(report);
  }catch(error){report(error);}
  return undefined;
 });
 return()=>{off();options.signal?.removeEventListener('abort',onAbort);lifetime.abort();};
}
export interface HubSharingRuntime {
 service:HubSharingService;
 scheduler:SharingPollScheduler;
 auth:GoogleDriveAuthCoordinator;
 discovery:GoogleDriveLocalDiscovery;
 setNotify:(notify:()=>void)=>void;
 close:()=>Promise<void>;
}
/** Compose the publishing runtime over its own storage domain so it can be closed as one unit. */
export interface HubSharingOpenOptions {
 report?:(error:unknown)=>void;
 root?:string;
 runner?:SharingCommandRunner;
 clientId?:string;
 clientSecret?:string;
 fetch?:typeof fetch;
 credentials?:CredentialStore;
 /** Home directory that owns the suggested per-Hub team folders. */
 home?:string;
 /** Platform used to pick the Drive discovery adapter; injectable for tests. */
 platform?:NodeJS.Platform;
 /** Filesystem used by Drive discovery; injectable for tests. */
 discoveryFs?:DiscoveryFs;
 /** Environment used to expand Windows mount variables. */
 env?:NodeJS.ProcessEnv;
 /** A fully composed discovery service, when the host already owns one. */
 discovery?:GoogleDriveLocalDiscovery;
 /** Delay between a local change and an automatic synchronization. */
 debounceMs?:number;
}
export async function openHubSharing(ctx:Context,hubs:HubRepository,options:HubSharingOpenOptions={}):Promise<HubSharingRuntime>{
 const storage=await openSharingStorage(ctx,{...(options.report===undefined?{}:{report:options.report})});
 let notify=()=>{};
 const credentials=options.credentials??credentialStoreFromContext(ctx);
 const authService=new GoogleDriveAuthService({...(credentials===undefined?{}:{credentials}),...(options.clientId===undefined?{}:{clientId:options.clientId}),...(options.clientSecret===undefined?{}:{clientSecret:options.clientSecret}),...(options.fetch===undefined?{}:{fetch:options.fetch}),onChange:()=>notify()});
 const auth=new GoogleDriveAuthCoordinator({auth:authService,onChange:()=>notify()});
 const root=options.root??sharingRoot();
 const home=options.home??os.homedir();
 const discoveryFs=options.discoveryFs??nodeDiscoveryFs;
 const discovery=options.discovery??new GoogleDriveLocalDiscovery({
  adapter:createDriveDiscoveryAdapter({platform:options.platform??process.platform,home,fs:discoveryFs,...(options.runner===undefined?{}:{runner:options.runner}),...(options.env===undefined?{}:{env:options.env})}),
  fs:discoveryFs,
 });
 const providers=new SharingProviderRegistry([
  createGitProviderDescriptor({root,...(options.runner===undefined?{}:{runner:options.runner})}),
  createGoogleDriveProviderDescriptor({auth:authService,...(options.fetch===undefined?{}:{fetch:options.fetch})}),
  createLocalFolderProviderDescriptor({home,managedRoot:root}),
  createGoogleDriveLocalProviderDescriptor({discovery,home,managedRoot:root}),
 ]);
 const service=new HubSharingService({hubs,store:storage.storage,providers,auth,notify:()=>notify(),...(options.report===undefined?{}:{report:options.report}),...(options.debounceMs===undefined?{}:{debounceMs:options.debounceMs})});
 await auth.refresh();
 const scheduler=new SharingPollScheduler({service,...(options.report===undefined?{}:{report:options.report})});
 return {
  service,scheduler,auth,discovery,
  setNotify:(next)=>{notify=next;},
  close:async()=>{scheduler.dispose();try{await service.close();await auth.close();}finally{await storage.close();}},
 };
}
export const name='kanban';
export const inject=['storageDomain','sessionController','sessions','agents','workingDirectory','workspaceRegistry','sandboxPolicy','tools','typert','credentials'];
export async function apply(ctx:Context):Promise<void>{
 const report=(error:unknown)=>ctx.logger.warn(error instanceof Error?error.message:String(error));
 const opened=await openKanbanStorage(ctx);
 const storage={close:opened.close};
 let questions:{storage:import('./host/question-storage.js').QuestionStore;close:()=>Promise<void>};
 try{questions=await openQuestionStorage(ctx);}catch(error){await storage.close();throw error;}
 const lifetime=new AbortController();
 const conversationFacts=registerConversationFacts(ctx);ctx.effect(()=>()=>conversationFacts.dispose());const native=createNativePorts(ctx,{conversationFacts});const hubs=await HubRepository.open(opened.storage);
 let sharing:HubSharingRuntime;
 try{sharing=await openHubSharing(ctx,hubs,{report});}catch(error){await hubs.close();await questions.close();await storage.close();throw error;}
 const app=new KanbanApp(hubs,native.sessions,new GitAdapter(native.executor),{signal:lifetime.signal,report,history:async id=>(await ctx.sessionController.inspect(SessionId(id),lifetime.signal)).events,questionStore:questions.storage,probe:native.probe,sharing:sharing.service,sharingAuth:sharing.auth,localDrive:sharing.discovery,scheduler:sharing.scheduler},native.workspaces);
 sharing.setNotify(()=>app.sharingChanged());
 let offTools:(()=>void)|undefined;let offWire:(()=>void)|undefined;let offGuards:(()=>void)|undefined;let offContext:(()=>void)|undefined;let offSignals:(()=>void)|undefined;let offAdoption:(()=>void)|undefined;
 ctx.effect(()=>async()=>{lifetime.abort();offTools?.();offWire?.();offGuards?.();offContext?.();offSignals?.();offAdoption?.();try{await app.close();}finally{try{await sharing.close();}finally{try{await hubs.close();}finally{await questions.close();}}}});
 offWire=ctx.typert.register(TYPERT_HOST);
 ctx.plugin(KanbanController,app);
 offTools=registerProductTools(ctx,app);
 ctx.on('session/event',(session,event)=>{app.observe(session.id,event);});
 offSignals=registerAttentionSignals(ctx,app);
 offGuards=registerTaskExecutionGuards(ctx,app.locator,app);
 offContext=registerTaskContextInjection(ctx,app.locator,{report});
 const adopter=new ForkAdopter({
  locate:sessionId=>{const located=app.locator.bySession(sessionId);return located===undefined?undefined:{hubId:located.hubId,taskId:located.task.id,effectiveCwd:located.task.effectiveCwd};},
  directory:sessionId=>native.sessions.directory(sessionId),
  setDirectory:(sessionId,directory,signal)=>native.sessions.setDirectory(sessionId,directory,signal),
  attach:(hubId,taskId,sessionId,expectedEffectiveCwd)=>hubs.hub(hubId).addSession(taskId,sessionId,expectedEffectiveCwd).then(()=>undefined),
  sleep:abortableSleep,
  report,
 });
 offAdoption=registerForkAdoption(ctx,adopter,{signal:lifetime.signal,report});
 await app.initialize();
 sharing.scheduler.sync();
}
