import { Context } from '@deepseek-ai/cordis';
import os from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createScriptedLease, createScriptedRuntime } from './host/scripted/index.js';
import type {} from '@deepseek-ai/dsh-client-connection';
import { registerTaskAttachmentRoute } from './host/task-attachments/route.js';
import type {} from '@deepseek-ai/dsh-typert-registry';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-llm';
import { TYPERT_HOST } from './remote.js';
import { HubRepository } from './host/hub-repository.js';
import { openRevisionStorage } from './host/revision-storage.js';
import { BoardRevisions } from './host/revisions.js';
import { createWorkflowImagePort } from './host/workflow-image.js';
import { createPlanFilePort } from './host/plan-files.js';
import { openKanbanStorage } from './host/storage.js';
import { openQuestionStorage } from './host/question-storage.js';
import { openSharingStorage } from './host/sharing/state.js';
import { HubSharingService } from './host/sharing/service.js';
import { SharingPollScheduler } from './host/sharing/scheduler.js';
import { createGitProviderDescriptor } from './host/sharing/git-store.js';
import { TeamFiles } from './host/team-files/service.js';
import { TaskAttachmentStore } from './host/task-attachments/store.js';
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
import { InterCardMessaging } from './host/inter-card-messaging.js';
import { createNativeTaskMessageDelivery } from './host/task-message-native.js';
import { registerConversationFacts } from './host/conversation-facts.js';
import { GitAdapter } from './host/git.js';
import { KanbanApp } from './host/app.js';
import { KanbanController } from './host/controller.js';
import { registerProductTools } from './host/tools.js';
import { createBoardToolPolicy, type PolicyAgent } from './host/board-tool-policy.js';
import { boardAllowlistFor } from './host/board-policy-source.js';
import { CONFINED_START_PRESET_IDS, createConfinedStartPin } from './host/preset-readonly.js';
import { KanbanError } from './shared/errors.js';
import { registerTaskContextInjection } from './host/task-context.js';
import { registerStageNotice } from './host/stage-notice.js';
import { registerScriptedHandoffInjection } from './host/scripted-handoff.js';
import { createSessionHistory } from './host/session-history.js';
import { createHostSessionRepair } from './host/session-repair-host.js';
import { openScheduleRunStorage } from './host/schedule-run-storage.js';
import { ScheduleRunRegistry } from './host/schedule-runs.js';
import { ScheduleArchiveWatcher } from './host/schedule-archive.js';
import { ScheduleRunner } from './host/schedule-runner.js';
import { ScheduleCoordinator, type ScheduledEntry } from './host/schedule-coordinator.js';
import { createSessionModelPort } from './host/session-model.js';
import { createSessionPresetPort, resolveSessionAgent } from './host/session-preset.js';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Session } from '@deepseek-ai/dsh-session';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { abortableSleep, ForkAdopter } from './host/conversation-adoption.js';
import { createForkClaim, createInheritedPrefixCheck } from './host/fork-claim.js';
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
 /** Records the local revisions an applied team document produces. */
 revisions?:import('./host/board-administration.js').BoardRevisionPort;
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
 const service=new HubSharingService({hubs,store:storage.storage,providers,auth,notify:()=>notify(),...(options.report===undefined?{}:{report:options.report}),...(options.revisions===undefined?{}:{revisions:options.revisions}),...(options.debounceMs===undefined?{}:{debounceMs:options.debounceMs})});
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
/**
 * Mirror the root context as the `ctx.root` property the inlined Typert protocol
 * copy reads when it binds a Remote service. Current Cordis keys the root by
 * symbol and rejects that property read, while an older Cordis exposes the
 * property itself, so only the symbol-keyed host needs the alias.
 * @param ctx - host plugin context.
 */
export function exposeRootContext(ctx:Context):void{
 const symbol=(Context as unknown as {root?:unknown}).root;
 if(typeof symbol!=='symbol')return;
 const root=(ctx as unknown as Record<symbol,Context|undefined>)[symbol];
 if(root===undefined||'root' in root.reflect.props)return;
 root.reflect.accessor('root',{get:()=>root});
}

export const name='kanban';
export const inject=['storageDomain','sessionController','sessionQuery','sessions','agents','workingDirectory','workspaceRegistry','sandboxPolicy','tools','typert','credentials','llm'];
export async function apply(ctx:Context):Promise<void>{
 const report=(error:unknown)=>ctx.logger.warn(error instanceof Error?error.message:String(error));
 const opened=await openKanbanStorage(ctx);
 const storage={close:opened.close};
 let questions:{storage:import('./host/question-storage.js').QuestionStore;drafts:import('./host/question-storage.js').QuestionDraftStore;close:()=>Promise<void>};
 try{questions=await openQuestionStorage(ctx);}catch(error){await storage.close();throw error;}
 const lifetime=new AbortController();
 const history=createSessionHistory(ctx);
 let conversationFacts!:Awaited<ReturnType<typeof registerConversationFacts>>;
 try{conversationFacts=await registerConversationFacts(ctx);ctx.effect(()=>()=>conversationFacts.dispose());}catch(error){conversationFacts?.dispose();await questions.close().catch(()=>undefined);await storage.close().catch(()=>undefined);throw error;}
 const native=createNativePorts(ctx,{conversationFacts,history});const hubs=await HubRepository.open(opened.storage);
 let revisionStore:Awaited<ReturnType<typeof openRevisionStorage>>;
 try{revisionStore=await openRevisionStorage(ctx);}catch(error){await hubs.close();await questions.close();await storage.close();throw error;}
 const revisions=new BoardRevisions({store:revisionStore,report});
 let schedules:{storage:import('./host/schedule-run-storage.js').ScheduleRunStorage;close:()=>Promise<void>};
 try{schedules=await openScheduleRunStorage(ctx);}catch(error){await hubs.close();await questions.close();await storage.close();throw error;}
 let sharing:HubSharingRuntime;
 try{sharing=await openHubSharing(ctx,hubs,{report,revisions});}catch(error){await revisionStore.close();await schedules.close();await hubs.close();await questions.close();await storage.close();throw error;}
 const teamFiles=new TeamFiles({store:hubId=>sharing.service.fileStoreFor(hubId),exclusive:(hubId,operation)=>sharing.service.exclusive(hubId,operation)});
 const sessionModels=createSessionModelPort(ctx);
 const sessionPresets=createSessionPresetPort(ctx);
 // The board's tool policy needs the app's task lookup, and the app needs the
 // policy port. One deferred hop keeps the dependency one-directional.
 let applyBoardToolPolicy:(sessionId:string)=>Promise<void>=async()=>undefined;
 // The profile path is read before the app: the attachment directory and the
 // scripted lease both live under the DSH profile, outside every project checkout.
 const profile=ctx.get('profileContext') as {readonly dir:string}|undefined;
 const scriptedLease=profile&&isAbsolute(profile.dir)?createScriptedLease(join(profile.dir,'kanban-private','scripted')):undefined;
 const app=new KanbanApp(hubs,native.sessions,new GitAdapter(native.executor),{signal:lifetime.signal,...(scriptedLease===undefined?{}:{scriptedLease}),...(profile&&isAbsolute(profile.dir)?{taskAttachments:new TaskAttachmentStore(join(profile.dir,"kanban-private","attachments")),answerAttachments:new TaskAttachmentStore(join(profile.dir,"kanban-private","answer-files"))}:{}),models:sessionModels,presets:sessionPresets,turnBoundary:{boundary:id=>{const agent=ctx.agents.get(SessionId(id));return agent?ctx.agents.turnBoundaryOf(agent.session):undefined;}},tools:{apply:sessionId=>applyBoardToolPolicy(sessionId)},mcpServers:()=>{const manager=ctx.get('mcpManager') as {list?:()=>ReadonlyArray<{name:string}>}|undefined;try{return manager?.list?.().map(server=>server.name)??[];}catch{return [];}},report,revisions,history:async id=>(await history.read(id,{signal:lifetime.signal})).events,questionStore:questions.storage,questionDraftStore:questions.drafts,probe:native.probe,sharing:sharing.service,sharingAuth:sharing.auth,localDrive:sharing.discovery,scheduler:sharing.scheduler,teamFiles},native.workspaces);
 // The repair is composed here so the app keeps no file-system or format dependency:
 // it delegates to a pipeline whose safety rules are its own.
 app.attachSessionRepair(createHostSessionRepair({
  live:id=>native.sessions.live?.(id)??false,
  location:id=>native.sessions.locate?.(id)??Promise.resolve(undefined),
  observe:async id=>{await app.conversationFacts(id);},
 }));
 // Two independent policies: the board owns the MCP namespace, and the preset ships
 // its own product-tool boundary. Neither names a tool of the other's namespace, so
 // their deny masks compose by union instead of intersecting into an empty surface.
 const boardToolPolicy=createBoardToolPolicy({
  // A fork or a delegated child is created before it is attached to its task, so the
  // lookup follows the session's ancestry instead of waiting for the attachment.
  policy:{allowlist:id=>boardAllowlistFor({boardOf:sessionId=>app.locator.bySession(sessionId)?.board.workflow,parentOf:sessionId=>{try{const header=ctx.sessions.get(SessionId(sessionId))?.header;return header?.parentSession===undefined?undefined:String(header.parentSession);}catch{return undefined;}}},id)},
  catalog:()=>ctx.tools.definitions().map(definition=>definition.name),
  restrict:(agent,deny)=>(agent as unknown as {ctx:Context}).ctx.tools.restrict({deny:[...deny]}),
  report,
 });
 const confinedStartPin=createConfinedStartPin({
  presetOf:session=>{const presets=ctx.get('agentPresets') as {presetForSession?:(session:unknown)=>string|null;stateOf?:(session:unknown)=>string|null}|undefined;const read=presets?.presetForSession??presets?.stateOf;try{return read===undefined||presets===undefined?null:read.call(presets,session);}catch{return null;}},
  presets:new Set(CONFINED_START_PRESET_IDS),
  currentMode:session=>{const policy=ctx.get('sandboxPolicy') as {overrideOf?:(session:Session)=>string|undefined}|undefined;try{return policy?.overrideOf?.(session as Session);}catch{return undefined;}},
  pin:session=>setSandboxMode(session as Session,'read-only'),
  report,
 });
 applyBoardToolPolicy=async sessionId=>{const agent=await resolveSessionAgent(ctx,sessionId);if(agent!==undefined){boardToolPolicy.track(agent as PolicyAgent);confinedStartPin.track(agent as {session:unknown});}};
 if(profile&&isAbsolute(profile.dir)){
  // Optional child injection grants access without making conventional boards
  // depend on providers that might not be installed in this profile.
  const runtimeFiber=ctx.inject(['fs','shell','ptcRuntime','sandbox'],child=>{
   const detach=app.attachScriptedRuntime(createScriptedRuntime({context:child,privateDirectory:join(profile.dir,'kanban-private','scripted'),report}));
   child.effect(()=>detach,'kanban.scriptedRuntime');
  });
  ctx.effect(()=>()=>runtimeFiber.dispose(),'kanban.optionalScriptedRuntime');
 }
 const taskMessages=new InterCardMessaging({locateBySession:id=>app.locator.bySession(id),locate:id=>app.locator.byTask(id),prepare:id=>app.prepareMessageConversation(id),delivery:createNativeTaskMessageDelivery(ctx,history),activity:task=>app.taskActivity(task)});
 sharing.setNotify(()=>app.sharingChanged());
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
  createSession:(projectPath,workspaceId)=>native.sessions.create(projectPath,workspaceId),
  validateDirectory:(id,expected)=>native.sessions.validateDirectory(id,expected),
  renameSession:async(id,title)=>{await ctx.sessionController.rename({sessionId:SessionId(id),title});},
  send:(id,text,requestId)=>native.sessions.send(id,text,requestId),
  models:sessionModels,runs:scheduleRuns,watcher:scheduleWatcher,report,
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
  modelCatalog:refresh=>sessionModels.catalog(refresh),
 });
 let offTools:(()=>void)|undefined;let offWire:(()=>void)|undefined;let offDownload:(()=>Promise<void>)|undefined;let offGuards:(()=>void)|undefined;let offContext:(()=>void)|undefined;let offStageNotice:(()=>void)|undefined;let offHandoff:(()=>void)|undefined;let offSignals:(()=>void)|undefined;let offAdoption:(()=>void)|undefined;let offScheduleStatus:(()=>void)|undefined;let offBoardPolicy:(()=>void)|undefined;
 ctx.effect(()=>async()=>{
  lifetime.abort();offBoardPolicy?.();boardToolPolicy.dispose();offTools?.();offWire?.();void offDownload?.();offGuards?.();offContext?.();offStageNotice?.();offHandoff?.();offSignals?.();offAdoption?.();offScheduleStatus?.();offSchedules();
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
      try{await revisionStore.close();}finally{
       try{await schedules.close();}finally{await questions.close();}
      }
     }
    }
   }
  }
 });
 offWire=ctx.typert.register(TYPERT_HOST);
 // A download is a browser-native response, not a JSON payload, so it gets an exact
 // authenticated route instead of a Remote method.
 try{offDownload=registerTaskAttachmentRoute(ctx,app,report);}catch(error){report(error);}
 exposeRootContext(ctx);
 ctx.plugin(KanbanController,app);
 // The plan authority anchors on the directory the conversation was created in,
// which the native session header records and the working-directory tool cannot
// change. A model that entered another directory cannot move a plan write there.
const sessionOrigin=(session:unknown):string|undefined=>{
 try{const header=(session as {header?:{cwd?:string}}|undefined)?.header;return typeof header?.cwd==='string'?header.cwd:undefined;}catch{return undefined;}
};
// The parent link lives in the immutable session header, so a child resolves its
// owning card even when the parent conversation is not loaded in this process.
const sessionParent=(session:unknown):string|undefined=>{
 try{const id=(session as {header?:{parentSession?:unknown}}|undefined)?.header?.parentSession;return id===undefined?undefined:String(id);}catch{return undefined;}
};
offTools=registerProductTools(ctx,app,taskMessages,{revisions,images:createWorkflowImagePort(ctx),plans:createPlanFilePort(ctx),sessionOrigin,sessionParent});
 // An agent starts here for every lifecycle edge: a new conversation, a resume, and
 // a delegated child that joins its parent's preset revision.
 const offAgentCreated=ctx.on('agent/created',({agent})=>{boardToolPolicy.track(agent);confinedStartPin.track(agent);return undefined;},{global:true});
 const offToolsChanged=ctx.on('tools/change',()=>boardToolPolicy.refresh(),{global:true});
 const offAgentDisposed=ctx.on('agent/disposed',({agent})=>boardToolPolicy.forget(agent),{global:true});
 offBoardPolicy=()=>{offAgentCreated();offToolsChanged();offAgentDisposed();};
 ctx.on('session/event',(session,event)=>{app.observe(session.id,event);if(event.type==='turn/end')scheduleWatcher.observe(String(session.id));});
 offScheduleStatus=ctx.on('agent/status',({agent})=>scheduleWatcher.observe(String(agent.id)));
 offSignals=registerAttentionSignals(ctx,app);
 offGuards=registerTaskExecutionGuards(ctx,app.locator,app);
 offContext=registerTaskContextInjection(ctx,app.locator,{history,report,sharingView:hubId=>app.boards.sharingView(hubId),conversationFacts:id=>app.conversationFacts(id),attachments:task=>app.taskAttachmentPaths(task).map(entry=>({name:entry.attachment.name,bytes:entry.attachment.bytes,path:entry.path}))});
 // Registered after the first-contact injection so the notice sees the context message it just prepended.
 offStageNotice=registerStageNotice(ctx,app.locator,{history,report});
 offHandoff=registerScriptedHandoffInjection(ctx,{locateBySession:id=>app.locator.bySession(id),events:async id=>(await history.read(id)).events,reserve:(taskId,entryId,id)=>app.reserveScriptedHandoff(taskId,entryId,id),accept:(taskId,entryId,id)=>app.acceptScriptedHandoff(taskId,entryId,id),report});
 const adopter=new ForkAdopter({
  locate:sessionId=>{const located=app.locator.bySession(sessionId);return located===undefined?undefined:{hubId:located.hubId,taskId:located.task.id,effectiveCwd:located.task.effectiveCwd};},
  directory:sessionId=>native.sessions.directory(sessionId),
  setDirectory:(sessionId,directory,signal)=>native.sessions.setDirectory(sessionId,directory,signal),
  // Adoption runs detached, after the agent was created, so the board policy is
  // applied here too: an adopted fork belongs to its task only once attached.
  attach:async(hubId,taskId,sessionId,expectedEffectiveCwd)=>{await hubs.hub(hubId).addSession(taskId,sessionId,expectedEffectiveCwd);await applyBoardToolPolicy(sessionId);},
  sleep:abortableSleep,
  report,
 });
 offAdoption=registerForkAdoption(ctx,adopter,{signal:lifetime.signal,report});
 // The drawer claims a branch explicitly; the claim reuses the same adoption
 // coordinator and reads the child's header so a mismatched claim is refused.
 app.attachForkClaim(createForkClaim({
  adopter,
  lineage:async sessionId=>{
   const snapshot=await history.read(sessionId,{signal:lifetime.signal});
   const header=snapshot.header;
   return {
    ...(header.parentSession===undefined?{}:{parentSessionId:String(header.parentSession)}),
    ...(header.origin===undefined?{}:{origin:header.origin}),
   };
  },
  // A host that records no fork lineage still copies the source log prefix into
  // the branch, so the shared prefix proves which conversation it came from.
  inheritsPrefix:createInheritedPrefixCheck(sessionId=>history.read(sessionId,{signal:lifetime.signal})),
  taskOfSession:sessionId=>app.locator.bySession(sessionId)?.task.id,
  signal:lifetime.signal,
 }));
 await app.initialize();
 await scheduleRuns.pruneSchedules(new Set(scheduleEntries(hubs).map(entry=>entry.schedule.id)));
 await scheduleRuns.finalizeInterrupted();
 scheduleCoordinator.start();
 sharing.scheduler.sync();
}
