import type { Context } from '@deepseek-ai/cordis';
import os from 'node:os';
import type {} from '@deepseek-ai/dsh-typert-registry';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-llm';
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
import { createSessionHistory } from './host/session-history.js';
import { openScheduleRunStorage } from './host/schedule-run-storage.js';
import { ScheduleRunRegistry } from './host/schedule-runs.js';
import { ScheduleArchiveWatcher } from './host/schedule-archive.js';
import { ScheduleRunner } from './host/schedule-runner.js';
import { ScheduleCoordinator, type ScheduledEntry } from './host/schedule-coordinator.js';
import { createScheduleModelPort } from './host/schedule-model.js';
import { SessionId } from '@deepseek-ai/dsh-session';
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
 const offStream=ctx.on('llm/stream',async function*(options,next){
  // The stream boundary runs after request configuration and before the provider call.
  const id=options.sessionId===undefined?undefined:String(options.sessionId);
  const task=id===undefined?undefined:taskFor(id);
  if(task&&id!==undefined&&options.purpose===undefined){
   options.signal?.throwIfAborted();
   if(changing(task))throw new KanbanError('CONTEXT_OPERATION_PENDING','Wait for the task directory operation before requesting a model.');
   await app.assertExecutionContext(id);options.signal?.throwIfAborted();
   if(changing(taskFor(id)))throw new KanbanError('CONTEXT_OPERATION_PENDING','The task directory operation changed before its model request.');
  }
  yield* next();
 });
 return()=>{offStream();offStep();};
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
/** Every stored schedule, with the Hub that owns it, for the coordinator. */
function scheduleEntries(hubs:HubRepository):ScheduledEntry[]{
 const entries:ScheduledEntry[]=[];
 for(const hub of hubs.list())for(const schedule of hub.schedules??[])entries.push({hubId:hub.id,schedule});
 return entries;
}
export const name='kanban';
export const inject=['storageDomain','sessionController','sessionQuery','sessions','agents','workingDirectory','workspaceRegistry','sandboxPolicy','tools','typert','credentials','llm'];
export async function apply(ctx:Context):Promise<void>{
 const report=(error:unknown)=>ctx.logger.warn(error instanceof Error?error.message:String(error));
 const opened=await openKanbanStorage(ctx);
 const storage={close:opened.close};
 let questions:{storage:import('./host/question-storage.js').QuestionStore;close:()=>Promise<void>};
 try{questions=await openQuestionStorage(ctx);}catch(error){await storage.close();throw error;}
 const lifetime=new AbortController();
 const history=createSessionHistory(ctx);
 let conversationFacts!:Awaited<ReturnType<typeof registerConversationFacts>>;
 try{conversationFacts=await registerConversationFacts(ctx);ctx.effect(()=>()=>conversationFacts.dispose());}catch(error){conversationFacts?.dispose();await questions.close().catch(()=>undefined);await storage.close().catch(()=>undefined);throw error;}
 const native=createNativePorts(ctx,{conversationFacts,history});const hubs=await HubRepository.open(opened.storage);
 let schedules:{storage:import('./host/schedule-run-storage.js').ScheduleRunStorage;close:()=>Promise<void>};
 try{schedules=await openScheduleRunStorage(ctx);}catch(error){await hubs.close();await questions.close();await storage.close();throw error;}
 let sharing:HubSharingRuntime;
 try{sharing=await openHubSharing(ctx,hubs,{report});}catch(error){await schedules.close();await hubs.close();await questions.close();await storage.close();throw error;}
 const app=new KanbanApp(hubs,native.sessions,new GitAdapter(native.executor),{signal:lifetime.signal,report,history:async id=>(await history.read(id,{signal:lifetime.signal})).events,questionStore:questions.storage,probe:native.probe,sharing:sharing.service,sharingAuth:sharing.auth,localDrive:sharing.discovery,scheduler:sharing.scheduler},native.workspaces);
 sharing.setNotify(()=>app.sharingChanged());
 const scheduleModels=createScheduleModelPort(ctx);
 const scheduleRuns=new ScheduleRunRegistry({storage:schedules.storage,now:()=>new Date().toISOString(),onChange:()=>app.activityChanged(),report});
 const scheduleWatcher=new ScheduleArchiveWatcher({
  facts:id=>app.conversationFacts(id),
  archive:id=>native.sessions.archive(id),
  onChange:()=>app.activityChanged(),
  onArchiveFailure:(scheduleId,sessionId,error)=>{void scheduleRuns.recordArchiveFailure(scheduleId,sessionId,error).catch(report);},
  onArchived:(scheduleId,sessionId)=>{void scheduleRuns.clearArchiveFailure(scheduleId,sessionId).catch(report);},
  report,
 });
 const scheduleRunner=new ScheduleRunner({
  now:()=>new Date().toISOString(),
  requireHub:id=>hubs.requireHub(id),
  ensureProjectWorkspace:(hubId,project)=>app.ensureProjectWorkspace(hubId,project.id),
  signal:lifetime.signal,
  createSession:(project,workspaceId)=>native.sessions.create(project.projectPath,workspaceId),
  validateDirectory:(id,expected)=>native.sessions.validateDirectory(id,expected),
  renameSession:async(id,title)=>{await ctx.sessionController.rename({sessionId:SessionId(id),title});},
  send:(id,text,requestId)=>native.sessions.send(id,text,requestId),
  models:scheduleModels,runs:scheduleRuns,watcher:scheduleWatcher,report,
 });
 const scheduleCoordinator=new ScheduleCoordinator({
  clock:()=>Date.now(),
  timer:{schedule:(run,ms)=>setTimeout(run,ms),cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)},
  schedules:()=>scheduleEntries(hubs),
  run:async request=>{await scheduleRunner.run(request);},
  isRunning:id=>scheduleRuns.isRunning(id),
  report,
 });
 const offSchedules=hubs.subscribe(()=>{scheduleCoordinator.sync();void scheduleRuns.pruneHubs(new Set(hubs.list().map(hub=>hub.id))).catch(report);});
 app.attachScheduleRuntime({
  runNow:async(hubId,scheduleId)=>{scheduleCoordinator.runNow(hubId,scheduleId);},
  scheduleDeleted:async scheduleId=>{await scheduleRuns.remove(scheduleId);},
  runtime:()=>scheduleRuns.runtimeByHub(),
  modelCatalog:refresh=>scheduleModels.catalog(refresh),
 });
 let offTools:(()=>void)|undefined;let offWire:(()=>void)|undefined;let offGuards:(()=>void)|undefined;let offContext:(()=>void)|undefined;let offSignals:(()=>void)|undefined;let offAdoption:(()=>void)|undefined;let offScheduleStatus:(()=>void)|undefined;
 ctx.effect(()=>async()=>{
  lifetime.abort();offTools?.();offWire?.();offGuards?.();offContext?.();offSignals?.();offAdoption?.();offScheduleStatus?.();offSchedules();
  scheduleCoordinator.dispose();
  try{await scheduleCoordinator.settle();}finally{
   scheduleWatcher.dispose();
   try{await scheduleWatcher.settle();}finally{
    try{await scheduleRuns.settle();}finally{
     scheduleRuns.dispose();
    }
   }
  }
  try{await app.close();}finally{
   try{await scheduleRuns.settle();}finally{
    try{await sharing.close();}finally{
     try{await hubs.close();}finally{
      try{await schedules.close();}finally{await questions.close();}
     }
    }
   }
  }
 });
 offWire=ctx.typert.register(TYPERT_HOST);
 ctx.plugin(KanbanController,app);
 offTools=registerProductTools(ctx,app);
 ctx.on('session/event',(session,event)=>{app.observe(session.id,event);if(event.type==='turn/end')scheduleWatcher.observe(String(session.id));});
 offScheduleStatus=ctx.on('agent/status',({agent})=>scheduleWatcher.observe(String(agent.id)));
 offSignals=registerAttentionSignals(ctx,app);
 offGuards=registerTaskExecutionGuards(ctx,app.locator,app);
 offContext=registerTaskContextInjection(ctx,app.locator,{history,report});
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
 await scheduleRuns.pruneSchedules(new Set(scheduleEntries(hubs).map(entry=>entry.schedule.id)));
 await scheduleRuns.finalizeInterrupted();
 scheduleCoordinator.start();
 sharing.scheduler.sync();
}
