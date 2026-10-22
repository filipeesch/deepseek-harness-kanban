#!/usr/bin/env node
/** Guarded G2 preparation. Do not execute against the live backend until the parent authorizes READY. */
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectInspector, callHost } from './dsh-inspect.mjs';
import { GUI_URL, INSPECTOR_URL, isCleanRoot, assertOfficialLaunchUrl, acknowledgePreviewNotice } from './live-verify.mjs';
const execute = promisify(execFile);
const BOARD = 'section.dsh-kanban[aria-label="Kanban"]';
const DRAWER = '.kb-drawer';
export const EDITOR = '[data-composer-input][role="textbox"][contenteditable="true"]';
const STAGES = new Set(['authorization','arguments','debug-guard','dependency','inspector','browser','owner-login','clean-root','preview','client-source','client-context','fixture-path','fixture-git','fixture-project','fixture-C','fixture-task','fixture-B','approval-precondition','approval-request','approval-reject','approval-resume','native-target','tool-guard','fresh-no-prompt','draft-A','draft-B','draft-A-restored','model-A','model-B','stop-A','routing-evidence','screenshot','cleanup','artifact']);
export class NativeUatFailure extends Error { constructor(stage) { super('Native G2 verification failed at stage: '+(STAGES.has(stage)?stage:'arguments')); this.stage=STAGES.has(stage)?stage:'arguments'; this.name='NativeUatFailure'; } }
export const HELP = 'Usage: node scripts/verify-native-conversations.mjs --allow-owner-test --allow-fixture-data --allow-model-requests [--timeout-ms 30000] [--model-timeout-ms 90000]\nRequires parent READY before execution. Uses only the existing 51781 backend. Creates clearly named isolated fixture data under .verification/native-fixtures/g2; retains Git bases and archived histories. Core uses at most two short model prompts and one immediately stopped long prompt; optional approval adds one initial short prompt. Fixture-scoped public ToolRuntime guards deny model tool bodies; missing public scope fails before model requests. No global permission/model settings changes. Optional approval verification additionally requires BOTH --verify-approval and --allow-fixture-policy-changes; it permits one fixture-A workspace-write preset selection and one exact printf escalation request, rejected through native UI. It requires a completed native direct-Bash tool header; PTC-only composition is unsupported without separately authorized setup. Without both flags approval remains not-tested.';
export function assertAuthorizations(options) {
  if(options?.allowOwnerTest!==true||options?.allowFixtureData!==true||options?.allowModelRequests!==true)throw new NativeUatFailure('authorization');
  for(const key of['verifyApproval','allowFixturePolicyChanges'])if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new NativeUatFailure('arguments');
  if((options.verifyApproval===true)!==(options.allowFixturePolicyChanges===true))throw new NativeUatFailure('authorization');
  for(const value of[options.timeoutMs??30000,options.modelTimeoutMs??90000])if(!Number.isSafeInteger(value)||value<1000||value>120000)throw new NativeUatFailure('arguments');
}
export function parseArgs(argv) {
  const options={allowOwnerTest:false,allowFixtureData:false,allowModelRequests:false,timeoutMs:30000,modelTimeoutMs:90000,verifyApproval:false,allowFixturePolicyChanges:false,help:false};const seen=new Set();
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];if(seen.has(flag))throw new NativeUatFailure('arguments');seen.add(flag);
    if(flag==='--help'){options.help=true;continue;}
    if(flag==='--allow-owner-test'){options.allowOwnerTest=true;continue;}
    if(flag==='--allow-fixture-data'){options.allowFixtureData=true;continue;}
    if(flag==='--allow-model-requests'){options.allowModelRequests=true;continue;}
    if(flag==='--verify-approval'){options.verifyApproval=true;continue;}
    if(flag==='--allow-fixture-policy-changes'){options.allowFixturePolicyChanges=true;continue;}
    if(flag==='--timeout-ms'||flag==='--model-timeout-ms'){const raw=argv[++i];if(!/^[0-9]+$/.test(raw??''))throw new NativeUatFailure('arguments');options[flag==='--timeout-ms'?'timeoutMs':'modelTimeoutMs']=Number(raw);continue;}
    throw new NativeUatFailure('arguments');
  }
  if(!options.help)assertAuthorizations(options);return options;
}
export function assertQuietEnvironment(env) { if(['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'].some(key=>!!env[key]))throw new NativeUatFailure('debug-guard'); }
export function modelBudget() { let short=0,long=0;return{reserve(kind){if(kind==='short'&&short<3){short++;return;}if(kind==='long'&&long<1){long++;return;}throw new NativeUatFailure('arguments');},snapshot:()=>({short,long})}; }
export function assertOwnedIds(ids,owned) { if(!Array.isArray(ids)||ids.length===0||ids.some(id=>typeof id!=='string'||!owned.has(id)))throw new NativeUatFailure('cleanup'); }
export function fixturePaths(workspace,nonce) {
  if(!/^[a-f0-9]{12}$/.test(nonce))throw new NativeUatFailure('fixture-path');
  const base=resolve(workspace,'.verification','native-fixtures','g2');const run=resolve(base,'run-'+nonce);
  if(!relative(workspace,run).startsWith('.verification'+sep+'native-fixtures'+sep+'g2'+sep)||relative(base,run).includes(sep))throw new NativeUatFailure('fixture-path');
  return{base,run,repo:join(run,'project'),evidence:join(run,'evidence'),report:join(run,'evidence','g2.json')};
}
/** No deletion path exists: archived native histories must keep their canonical project cwd. */
export async function prepareFixture(options,workspace,nonce,io={mkdir,lstat,realpath,writeFile},run=execute) {
  assertAuthorizations(options);
  const root=await io.realpath(workspace),paths=fixturePaths(root,nonce);
  for(const parts of[['.verification'],['.verification','native-fixtures'],['.verification','native-fixtures','g2']]){
    const directory=join(root,...parts);await io.mkdir(directory,{recursive:true});const info=await io.lstat(directory);
    if(info.isSymbolicLink()||!info.isDirectory()||await io.realpath(directory)!==directory)throw new NativeUatFailure('fixture-path');
  }
  await io.mkdir(paths.run); // Exclusive new run; never overwrite a prior acceptance fixture.
  await io.mkdir(paths.repo);await io.mkdir(paths.evidence);
  if(await io.realpath(paths.repo)!==paths.repo)throw new NativeUatFailure('fixture-path');
  const env=Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL'].filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));env.GIT_TERMINAL_PROMPT='0';env.GIT_CONFIG_NOSYSTEM='1';env.GIT_CONFIG_GLOBAL=process.platform==='win32'?'NUL':'/dev/null';
  const opts={cwd:paths.repo,env,timeout:10000,maxBuffer:65536,windowsHide:true};
  await run('git',['init','--initial-branch=main','--template='],opts);
  await run('git',['-c','core.hooksPath='+join(paths.repo,'.disabled-hooks'),'-c','core.fsmonitor=false','-c','user.name=DSH G2 Fixture','-c','user.email=g2@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','Isolated native conversation acceptance fixture'],opts);
  return paths;
}
async function evidenceDirectory(paths){for(const directory of[paths.run,paths.repo,paths.evidence]){const info=await lstat(directory);if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==directory)throw new NativeUatFailure('artifact');}}
export function assertApprovalAuthorizations(options){assertAuthorizations(options);if(options.verifyApproval!==true||options.allowFixturePolicyChanges!==true)throw new NativeUatFailure('authorization');}
export function safeReport(report) {
  return{gate:'G2',ok:report.ok===true,stage:STAGES.has(report.stage)?report.stage:'arguments',runId:report.runId,fixture:report.fixture,ids:report.ids,checks:report.checks??{},snapshots:report.snapshots??{},modelRequests:report.modelRequests,cleanup:report.cleanup??{},approval:report.approval??{status:'not-tested',precondition:'Requires a separately authorized fixture-only native approval scenario; no global or per-session permission configuration changed.'}};
}
async function bounded(operation,timeoutMs){let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),timeoutMs);})]);}finally{clearTimeout(timer);}}
async function until(read,predicate,timeoutMs,signal){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){signal?.throwIfAborted();const value=await bounded(read,Math.min(timeoutMs,10000));signal?.throwIfAborted();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,150));}throw new Error();}
async function close(resource){if(resource)await bounded(()=>resource.close(),5000);}
function findContext(root,kind){const branch=kind==='host'?root.children?.find(n=>n.localName==='host'):root.children?.find(n=>n.localName==='clients')?.children?.find(n=>n.localName==='client');return branch?.children?.find(n=>n.localName==='context');}
async function contextObject(client,kind,group){const {root}=await client.call('DOM.getDocument',{depth:3});const node=findContext(root,kind);if(!node)throw new Error();const {object}=await client.call('DOM.resolveNode',{nodeId:node.nodeId,objectGroup:group});if(!object?.objectId)throw new Error();return object.objectId;}
async function callClient(client,declaration,args=[]){const group='g2-'+randomUUID();try{const objectId=await contextObject(client,'client',group);const value=await client.call('Runtime.callFunctionOn',{objectId,functionDeclaration:declaration.toString(),arguments:args.map(value=>({value})),returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error();return value.result?.value;}finally{await client.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});}}
async function rpc(page,endpoint,args){if(!isCleanRoot(page.url()))throw new Error();const response=await page.evaluate(async({endpoint,args})=>{const rpcId=crypto.randomUUID();const response=await fetch('api/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload:{args}})});if(!response.ok)throw new Error();const body=await response.json();if(body.rpcId!==rpcId||!body.result?.ok)throw new Error();return body.result.value;},{endpoint,args});return response;}
const SAFE_PLUGIN_CODES=new Set(['CLIENT_ERROR','FORBIDDEN','CONFLICT','INVALID_COMMAND','INVALID_STATE','INVALID_PROJECT','TASK_BUSY','SESSION_ACTIVE','INVALID_PATH','SANDBOX_DENIED','SANDBOX_UNAVAILABLE','CONTEXT_CHANGED','DELIVERY_UNCERTAIN','NATIVE_ERROR']);
export function safePluginCode(value){return SAFE_PLUGIN_CODES.has(value)?value:'UNCLASSIFIED_PLUGIN_ERROR';}
export async function taskUiCheckpoint(page,board,projectId){
  if(!isCleanRoot(page.url()))throw new Error();
  const open=board.getByRole('button',{name:'New task',exact:true});
  const dialog=page.getByRole('dialog',{name:'New task',exact:true});
  const project=dialog.getByRole('combobox',{name:'Project',exact:true});
  const submit=dialog.getByRole('button',{name:'Create task',exact:true});
  const openCount=await open.count(),dialogCount=await dialog.count(),projectCount=await project.count(),submitCount=await submit.count();
  return{newTaskCount:openCount,newTaskEnabled:openCount===1&&await open.isEnabled(),dialogCount,titleCount:await dialog.getByLabel('Title',{exact:true}).count(),projectRoleCount:projectCount,legacyExactProjectLabelCount:await dialog.getByLabel('Project',{exact:true}).count(),fixtureOptionPresent:projectCount===1&&await project.locator('option').evaluateAll((options,id)=>options.some(option=>option.value===id),projectId),createCount:submitCount,createEnabled:submitCount===1&&await submit.isEnabled(),pluginAlertCount:await board.getByRole('alert').count(),pluginErrorCodes:(await board.locator('.kb-error strong').allTextContents()).map(safePluginCode),feedErrorVisible:await page.locator('.kanban-feed-error').count()>0};
}
/** Playwright's exact label text includes nested option text; the native accessible combobox name does not. */
export async function selectFixtureProject(dialog,projectId){const control=dialog.getByRole('combobox',{name:'Project',exact:true});if(await control.count()!==1)throw new Error();await control.selectOption(projectId);if(await control.inputValue()!==projectId)throw new Error();}
export function nativeConversationTarget(frame,expected){if(typeof expected!=='string'||expected.length===0)throw new NativeUatFailure('native-target');return frame.locator('[data-conversation-content][data-conversation-session='+JSON.stringify(expected)+']');}
/** Published native DOM only. Never report an unexpected actual Session id or transcript. */
export async function nativeTargetCheckpoint(frame,expected){
  const frames=await frame.count(),content=frame.locator('[data-conversation-content]'),contents=await content.count();
  const actual=contents===1?await content.getAttribute('data-conversation-session'):null;
  const rawPhase=contents===1?await content.getAttribute('data-content-phase'):null;
  const phase=['settling','hero','active'].includes(rawPhase)?rawPhase:'unknown';
  const target=nativeConversationTarget(frame,expected),editors=target.locator(EDITOR),editorCount=await editors.count();
  const editorVisible=editorCount===1&&await editors.isVisible(),editable=editorCount===1&&await editors.isEditable();
  const sessionMatch=frames===1&&contents===1&&actual===expected;
  return{frameCount:frames,contentCount:contents,sessionMatch,phase,phaseActive:phase==='active',editorCount,editorVisible,editable,ready:sessionMatch&&editorCount===1&&editorVisible&&editable};
}
export async function waitForNativeTarget(frame,expected,timeoutMs,onCheckpoint=()=>{},signal,requireEditable=true){
  try{return await until(async()=>{const checkpoint=await nativeTargetCheckpoint(frame,expected);onCheckpoint(checkpoint);return checkpoint;},value=>requireEditable?value.ready:value.sessionMatch,timeoutMs,signal);}catch{throw new NativeUatFailure('native-target');}
}
export async function submitNativeMessage(options,frame,expected,text,timeoutMs,beforeSend=()=>{},onCheckpoint=()=>{},signal){
  assertAuthorizations(options);
  await waitForNativeTarget(frame,expected,timeoutMs,value=>onCheckpoint('before-fill',value),signal);
  const target=nativeConversationTarget(frame,expected);
  // Both interactions re-resolve an exact Session-addressed native subtree, not a reused unscoped composer.
  await target.locator(EDITOR).fill(text);
  await waitForNativeTarget(frame,expected,timeoutMs,value=>onCheckpoint('before-send',value),signal);
  signal?.throwIfAborted();beforeSend();
  await target.getByRole('button',{name:'Send message',exact:true}).click();
}
async function boardSnapshot(page){const value=await rpc(page,'kanban/snapshot',{});if(!value?.ok)throw new Error();return value.value;}
async function command(page,request){const value=await rpc(page,'kanban/command',{request});if(!value?.ok)throw new Error();return value.value;}
const MAIN_SELECTED=function(id){const rows=(this.root??this).get('sessions').list.getSnapshot().byId;return (rows[id]?.retainedBy.mainView??0)>0;};
const OPEN_MAIN=async function(id){const ctx=this.root??this;await ctx.get('sessions').refresh();ctx.get('uiWorkspace').openSession(id);return true;};
const SUMMARIZE=async function(ids,cwd,markers){const ctx=this.root??this,result={};for(const id of ids){const value=await ctx.get('sessionController').inspect(id);if(value.meta.cwd!==cwd)throw new Error('Fixture ownership mismatch');const events=value.events;const human=events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='user');const assistant=events.filter(e=>e.type==='assistant/message');const text=message=>Array.isArray(message?.content)?message.content.filter(block=>block.type==='text').map(block=>block.text).join(''):'';const end=events.filter(e=>e.type==='turn/end').at(-1);result[id]={id,cwd:events.filter(e=>e.type==='working-directory/change').at(-1)?.data.cwd??value.meta.cwd,users:human.length,assistants:assistant.length,turnStarts:events.filter(e=>e.type==='turn/start').length,turnEnds:events.filter(e=>e.type==='turn/end').length,aborted:events.filter(e=>e.type==='turn/end'&&e.data.reason.kind==='aborted').length,lastOutcome:end?.data.reason.kind??null,running:ctx.get('agents')?.get(id)?.status==='running',tools:events.filter(e=>['tool/call','tool/result','tool/ptc-dispatch-start','tool/ptc-dispatch'].includes(e.type)).length,humanMarkers:markers.filter(marker=>human.some(e=>text(e.data).includes(marker))),assistantMarkers:markers.filter(marker=>assistant.some(e=>text(e.data.message).trim()===marker))};}return result;};
const OWNED_IDS=async function(cwd){const value=await(this.root??this).get('sessionController').list({},AbortSignal.timeout(10000));return value.items.filter(row=>row.cwd===cwd).map(row=>row.sessionId);};
const CANCEL=async function(id,cwd){const ctx=this.root??this;const value=await ctx.get('sessionController').inspect(id);if(value.meta.cwd!==cwd)throw new Error();const running=ctx.get('agents')?.get(id)?.status==='running';if(running)await ctx.get('sessionController').cancel({sessionId:id});return running;};
const ARCHIVE=async function(id,cwd){const ctx=this.root??this;const value=await ctx.get('sessionController').inspect(id);if(value.meta.cwd!==cwd)throw new Error();const activity=await ctx.waterfall('workspace/session-activity',{sessionId:id},()=>Promise.resolve([]));if(activity.length)throw new Error();await ctx.get('workspaceRegistry').archiveSession(id);return true;};
/** Self-contained public Host Inspector function; registration is scoped through each fixture Agent.ctx. */
export async function installFixtureToolGuard(options,ids,cwd){
  if(options?.allowOwnerTest!==true||options?.allowFixtureData!==true||options?.allowModelRequests!==true)throw new Error('Fixture guard authorization required');
  if(!Array.isArray(ids)||ids.length!==3||new Set(ids).size!==3||ids.some(id=>typeof id!=='string'||id.length===0)||typeof cwd!=='string'||cwd.length===0)throw new Error('Fixture guard ownership precondition failed');
  const ctx=this.root??this,agents=ctx.get('agents'),controller=ctx.get('sessionController');
  if(!agents||typeof agents.get!=='function'||!controller||typeof controller.inspect!=='function'||typeof ctx.waterfall!=='function')throw new Error('Public fixture guard capabilities unavailable');
  const registrations=[];
  for(const id of ids){const agent=agents.get(id),snapshot=await controller.inspect(id);if(!agent||agent.id!==id||!agent.ctx||snapshot.meta.cwd!==cwd||typeof agent.ctx.get!=='function')throw new Error('Fixture guard Agent scope is unavailable');const tools=agent.ctx.get('tools');if(!tools||typeof tools.guard!=='function')throw new Error('Public ToolRuntime.guard is unavailable');registrations.push({id,tools});}
  const blockedCounts=Object.fromEntries(ids.map(id=>[id,0])),releases=[];let activated=false;
  try{for(const {id,tools} of registrations){const release=tools.guard(execution=>{if(execution.agent?.id!==id)return undefined;blockedCounts[id]++;return 'Model tool execution is disabled for this isolated native G2 fixture.';});if(typeof release!=='function')throw new Error('Public tool guard disposer unavailable');releases.push(release);}activated=true;}catch(error){for(const release of releases.reverse())try{release();}catch{}throw error;}
  const snapshot=()=>({activated,blockedCounts:{...blockedCounts}});
  return{snapshot,async dispose(){if(!activated)return snapshot();for(const id of ids){if(agents.get(id)?.status==='running')throw new Error('Fixture guard retained while its native model is active');const activity=await ctx.waterfall('workspace/session-activity',{sessionId:id},()=>Promise.resolve([]));if(activity.length)throw new Error('Fixture guard retained while its native work is active');}for(const release of releases.reverse())release();activated=false;return snapshot();}};
}
async function guardFixtureTools(host,options,ids,cwd){
  const group='g2-tool-guard-'+randomUUID(),objectId=await contextObject(host,'host',group);
  const made=await host.call('Runtime.callFunctionOn',{objectId,functionDeclaration:installFixtureToolGuard.toString(),arguments:[{value:{allowOwnerTest:options.allowOwnerTest,allowFixtureData:options.allowFixtureData,allowModelRequests:options.allowModelRequests}},{value:ids},{value:cwd}],returnByValue:false,awaitPromise:true});
  if(made.exceptionDetails||!made.result?.objectId){await host.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});throw new Error();}
  const handle=made.result.objectId;let disposed=false,last;
  return{async snapshot(){const result=await host.call('Runtime.callFunctionOn',{objectId:handle,functionDeclaration:'function(){return this.snapshot();}',returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error();return result.result.value;},async dispose(){if(disposed)return last;const result=await host.call('Runtime.callFunctionOn',{objectId:handle,functionDeclaration:'async function(){return await this.dispose();}',returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error();last=result.result.value;disposed=true;await host.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});return last;}};
}
/** Self-contained optional Host Inspector capability: fixed direct Bash only, never arbitrary PTC programs. */
export async function installFixtureApprovalGuard(options,roles,cwd,nonce){
  if(options?.allowOwnerTest!==true||options?.allowFixtureData!==true||options?.allowModelRequests!==true||options?.verifyApproval!==true||options?.allowFixturePolicyChanges!==true)throw new Error('Optional approval authorizations required');
  const ids=[roles?.C,roles?.A,roles?.B];if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==3||!(/^[a-f0-9]{12}$/).test(nonce)||typeof cwd!=='string')throw new Error('Approval fixture ownership unavailable');
  const ctx=this.root??this,agents=ctx.get('agents'),controller=ctx.get('sessionController'),presets=ctx.get('permissionPresets'),approval=ctx.get('approval'),sandbox=ctx.get('sandboxPolicy');
  if(!agents||!controller||typeof presets?.resolve!=='function'||typeof presets?.current!=='function'||typeof presets?.set!=='function'||typeof approval?.effectivePolicy!=='function'||typeof sandbox?.resolve!=='function'||typeof ctx.waterfall!=='function')throw new Error('Public optional approval capabilities unavailable');
  const spec=presets.resolve('workspace-write');if(spec.sandbox!=='workspace-write'||spec.approval!=='ask')throw new Error('Workspace-write ask preset precondition unavailable');
  const members=new Map(),baseline=new Map();
  const idle=async(allowDisposed=false)=>{for(const id of ids){const agent=agents.get(id);if((await ctx.waterfall('workspace/session-activity',{sessionId:id},()=>Promise.resolve([]))).length)throw new Error('Approval fixture activity is not idle');if(!agent&&allowDisposed)continue;if(!agent||agent.status!=='idle'||agent.inbox.nextTurn.length)throw new Error('Approval fixture activity is not idle');}};
  await idle();
  for(const id of ids){const agent=agents.get(id),value=await controller.inspect(id,AbortSignal.timeout(10000));if(agent.id!==id||value.meta.cwd!==cwd||typeof agent.ctx?.get!=='function'||typeof agent.ctx.get('tools')?.guard!=='function')throw new Error('Approval Agent scope unavailable');members.set(id,agent);baseline.set(id,value.events.at(-1)?.seq??-1);}
  const header=members.get(roles.A).session.requestHeader(),bash=header?.tools?.find(tool=>tool.name==='bash');
  if(!bash?.parameters?.properties?.sandbox_permissions?.enum?.includes('danger-full-access'))return{snapshot:()=>({activated:false,unsupported:'DIRECT_NATIVE_BASH_HEADER_REQUIRED'}),dispose:async()=>({activated:false})};
  const defaults=presets.defaultPreset,defaultSandboxMode=sandbox.defaultMode,beforePolicies=Object.fromEntries(ids.map(id=>[id,presets.current(members.get(id).session)]));
  const marker='QA_APPROVAL_'+nonce,resume='QA_APPROVAL_RESUMED_'+nonce;
  const expected={description:'Print one isolated native approval nonce',command:'printf '+marker,workdir:cwd,timeoutMs:1000,sandbox_permissions:'danger-full-access',justification:'Verify isolated '+marker+' without changing files or accessing the network.'};
  const promptText='Use the native bash tool exactly once with this exact JSON object: '+JSON.stringify(expected)+'. Do not use run_code or any other tool. Do not add, omit, or change arguments. Wait for the native approval. After it is rejected, reply exactly '+resume+'. Do not retry the tool.';
  const exact=args=>args!==null&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===Object.keys(expected).length&&Object.entries(expected).every(([key,value])=>args[key]===value);
  const releases=[],blockedCounts=Object.fromEntries(ids.map(id=>[id,0]));let activated=false,prepared=false,policyChanged=false,allowedCount=0,allowedCallId,requestCount=0,requestBudgetExceeded=false;
  try{for(const id of ids){const release=members.get(id).ctx.get('tools').guard(exec=>{if(exec.agent?.id!==id)return undefined;if(prepared&&id===roles.A&&exec.name==='bash'&&exec.parent===undefined&&typeof exec.callId==='string'&&allowedCount===0&&exact(exec.arguments)){allowedCount=1;allowedCallId=exec.callId;return undefined;}blockedCounts[id]++;return 'Only the single exact isolated native approval Bash request is permitted.';});if(typeof release!=='function')throw new Error('Approval guard disposer unavailable');releases.push(release);}const budgetRelease=members.get(roles.A).ctx.on('agent/request',async(payload,next)=>{if(payload.agent.id!==roles.A)return next();if(requestCount>=2){requestBudgetExceeded=true;throw new Error('The bounded optional approval model request budget is exhausted');}requestCount++;return next();});if(typeof budgetRelease!=='function')throw new Error('Public approval request budget hook unavailable');releases.push(budgetRelease);activated=true;}catch(error){for(const release of releases.reverse())try{release();}catch{}throw error;}
  const defaultsUnchanged=()=>presets.defaultPreset===defaults&&sandbox.defaultMode===defaultSandboxMode;
  const snapshot=()=>({activated,blockedCounts:{...blockedCounts},allowedCount,modelRequestAdmissions:requestCount,modelRequestBudgetExceeded:requestBudgetExceeded,prepared,fixturePolicyChanged:policyChanged,globalDefaultsUnchanged:defaultsUnchanged()});
  const state=async()=>{const rows={};for(const id of ids){const value=await controller.inspect(id,AbortSignal.timeout(10000));if(value.meta.cwd!==cwd)throw new Error('Approval fixture context drift');rows[id]=value.events.filter(event=>event.seq>baseline.get(id));}
   const events=rows[roles.A],calls=events.filter(e=>e.type==='tool/call'),asked=events.filter(e=>e.type==='approval/asked'),decided=events.filter(e=>e.type==='approval/decided');
   const exactCall=e=>{try{return e.data.name==='bash'&&exact(JSON.parse(e.data.arguments));}catch{return false;}};
   const knownAsked=asked.length===1&&asked[0].data.toolName==='bash'&&asked[0].data.callId===allowedCallId&&asked[0].data.reason==='escalate sandbox to danger-full-access: '+expected.justification;
   const knownDecision=knownAsked&&decided.length===1&&decided[0].data.id===asked[0].data.id, rejected=knownDecision&&decided[0].data.outcome==='rejected';
   const relevant=e=>['turn/start','turn/end','assistant/message','tool/call','tool/result','approval/asked','approval/decided'].includes(e.type)||e.type==='user/message'&&e.data.source?.kind==='user';
   const result=events.find(e=>e.type==='tool/result'&&e.data.message.toolCallId===allowedCallId);
   const text=message=>message.content.filter(block=>block.type==='text').map(block=>block.text).join('').trim();
   const humans=events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='user'),humanPromptMatch=humans.length===1&&text(humans[0].data)===promptText;
   const resumed=rejected&&events.some(e=>e.type==='assistant/message'&&e.seq>decided[0].seq&&text(e.data.message)===resume);
   const lastStart=events.filter(e=>e.type==='turn/start').at(-1),lastEnd=events.filter(e=>e.type==='turn/end').at(-1),closed=lastStart===undefined||lastEnd!==undefined&&lastEnd.seq>lastStart.seq,completed=lastEnd?.data.reason?.kind==='completed';
   const AIdle=agents.get(roles.A)?.status==='idle'&&closed;
   const BUnchanged=rows[roles.B].every(e=>!relevant(e))&&presets.current(members.get(roles.B).session)===beforePolicies[roles.B],CUnchanged=rows[roles.C].every(e=>!relevant(e))&&presets.current(members.get(roles.C).session)===beforePolicies[roles.C];
   return{...snapshot(),askedCount:asked.length,decidedCount:decided.length,pending:knownAsked&&decided.length===0,humanPromptMatch,knownAsked,rejected,resumed,toolRejected:result?.data.message.isError===true,unexpected:requestBudgetExceeded||humans.length>1||humans.length===1&&!humanPromptMatch||asked.length>0&&!humanPromptMatch||calls.length>1||calls.some(e=>!exactCall(e))||asked.length>1||asked.length===1&&!knownAsked||decided.length>0&&!knownDecision||!BUnchanged||!CUnchanged||!defaultsUnchanged(),granted:decided.some(e=>e.data.outcome==='allowed-once'),noApprovalIdle:AIdle&&lastStart!==undefined&&asked.length===0,AIdle,completed,commandExecutionPrevented:rejected&&result?.data.message.isError===true,BUnchanged,CUnchanged};};
  return{snapshot,state,identity(){return{callId:allowedCallId};},prompt(){return promptText;},async preparePreset(){await idle();const previous=presets.current(members.get(roles.A).session);presets.set(members.get(roles.A).session,'workspace-write');policyChanged=previous!=='workspace-write';if(presets.current(members.get(roles.A).session)!=='workspace-write'||sandbox.resolve({session:members.get(roles.A).session}).mode!=='workspace-write'||approval.effectivePolicy(members.get(roles.A).session)!=='ask'||!defaultsUnchanged())throw new Error('Native fixture-only preset did not resolve to workspace-write ask');prepared=true;return snapshot();},async dispose(){if(activated){await idle(true);for(const release of releases.reverse())release();activated=false;}return snapshot();}};
}
async function approvalGuardObject(host,options,roles,cwd,nonce){const group='g2-approval-'+randomUUID(),objectId=await contextObject(host,'host',group);const made=await host.call('Runtime.callFunctionOn',{objectId,functionDeclaration:installFixtureApprovalGuard.toString(),arguments:[options,roles,cwd,nonce].map(value=>({value})),returnByValue:false,awaitPromise:true});if(made.exceptionDetails||!made.result?.objectId){await host.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});throw new Error();}const handle=made.result.objectId;const invoke=async name=>{const result=await host.call('Runtime.callFunctionOn',{objectId:handle,functionDeclaration:'async function(name){return await this[name]();}',arguments:[{value:name}],returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error();return result.result.value;};return{snapshot:()=>invoke('snapshot'),state:()=>invoke('state'),identity:()=>invoke('identity'),prompt:()=>invoke('prompt'),preparePreset:()=>invoke('preparePreset'),async dispose(){const result=await invoke('dispose');await host.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});return result;}};}
export async function rejectKnownNativeApproval(options,frame,expected,evidence,timeoutMs){assertApprovalAuthorizations(options);if(!evidence?.knownAsked||!evidence.pending||evidence.unexpected||evidence.granted||!evidence.clientSessionMatch||!evidence.clientCallMatch||!evidence.clientIsBashApproval)throw new NativeUatFailure('approval-reject');await waitForNativeTarget(frame,expected,timeoutMs,()=>{},undefined,false);const panel=nativeConversationTarget(frame,expected).locator('[data-approval-key]');if(await panel.count()!==1)throw new NativeUatFailure('approval-reject');const reject=panel.getByRole('button',{name:'Reject',exact:true});if(await reject.count()!==1||!await reject.isEnabled())throw new NativeUatFailure('approval-reject');await reject.click();}
async function observe(host,ids){const group='g2-observer-'+randomUUID();const objectId=await contextObject(host,'host',group);const made=await host.call('Runtime.callFunctionOn',{objectId,functionDeclaration:function(ids){const ctx=this.root??this,allowed=new Set(ids),counts=Object.fromEntries(ids.map(id=>[id,{start:0,chunk:0,end:0}]));const release=ctx.on('agent/assistant-stream',({agent,frame})=>{if(allowed.has(agent.id)&&Object.hasOwn(counts[agent.id],frame.type))counts[agent.id][frame.type]++;},{global:true});return{snapshot(){return counts;},dispose(){release();}};}.toString(),arguments:[{value:ids}],returnByValue:false,awaitPromise:true});if(made.exceptionDetails||!made.result?.objectId)throw new Error();const observer=made.result.objectId;return{async snapshot(){const value=await host.call('Runtime.callFunctionOn',{objectId:observer,functionDeclaration:'function(){return this.snapshot();}',returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error();return value.result.value;},async dispose(){try{await host.call('Runtime.callFunctionOn',{objectId:observer,functionDeclaration:'function(){this.dispose();return true;}',returnByValue:true,awaitPromise:true});}finally{await host.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});}}};}

export async function runVerification(options,dependencies={}) {
  // This check runs before even importing Playwright, opening authentication, or creating a directory.
  assertAuthorizations(options);assertQuietEnvironment(dependencies.env??process.env);
  const timeout=options.timeoutMs??30000,modelTimeout=options.modelTimeoutMs??90000;
  const nonce=(dependencies.nonce??(()=>randomUUID().replaceAll('-','').slice(0,12)))();
  let stage='dependency',host,client,browser,context,page,launchUrl,paths,observer,toolGuard,taskId,projectId,C,A,B,clean=false,ownedIdle=false,approvalResult;
  const budget=modelBudget(),owned=new Set(),checks={guardActivated:false},snapshots={},cleanup={attempted:false,archived:[],nativeStopClicked:[],stopFallback:[],errors:[]};
  const shutdown=new AbortController();const interrupt=()=>shutdown.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  const wait=(read,predicate,ms)=>until(read,predicate,ms,shutdown.signal);
  const title='DSH G2 '+nonce,projectName=title+' fixture project',markers=['QA_A_'+nonce,'QA_B_'+nonce];
  const hostCall=dependencies.hostCall??callHost;
  const mainSelected=()=>callClient(client,MAIN_SELECTED,[C]);
  const summary=async()=>{const ids=[C,A,B].filter(Boolean);assertOwnedIds(ids,owned);return hostCall(host,SUMMARIZE.toString(),[ids,paths.repo,markers]);};
  const ownTask=async()=>{const state=await boardSnapshot(page);const match=state.state.tasks.filter(task=>task.projectId===projectId&&task.title===title);if(match.length>1)throw new Error();return match[0];};
  const drawer=()=>page.locator(DRAWER).filter({has:page.getByRole('heading',{name:title,level:2,exact:true})});
  const native=()=>drawer().locator('.kb-native-conversation');
  let selectedExpected;
  const editor=()=>nativeConversationTarget(native(),selectedExpected).locator(EDITOR);
  const select=async(label,requireEditable=true)=>{const expected=label==='Agent 1'?A:label==='Agent 2'?B:undefined;assertOwnedIds([expected],owned);await drawer().getByRole('tab',{name:label,exact:true}).click();selectedExpected=expected;const checkpoint=await waitForNativeTarget(native(),expected,timeout,value=>{checks.nativeSelectionLast={tab:label,...value};},requireEditable?shutdown.signal:undefined,requireEditable);(checks.nativeSelections??=[]).push({tab:label,...checkpoint});};
  const send=async(text,kind,expected)=>{shutdown.signal.throwIfAborted();assertOwnedIds([expected],owned);if(expected!==selectedExpected||!checks.guardActivated)throw new NativeUatFailure('native-target');await submitNativeMessage(options,native(),expected,text,timeout,()=>budget.reserve(kind),(point,value)=>{checks.nativeBeforeModel={target:expected===A?'A':'B',point,...value};},shutdown.signal);(checks.nativeModelTargets??=[]).push(checks.nativeBeforeModel);};
  try{
    const {chromium}=await bounded(dependencies.loadPlaywright??(()=>import('@playwright/test')),timeout);
    stage='inspector';host=await bounded(()=>(dependencies.connect??connectInspector)({endpoint:INSPECTOR_URL,timeoutMs:timeout}),timeout);await host.call('Runtime.enable');
    const before=new Set((await host.call('DSHInspector.getSources')).sources.map(source=>source.sourceId));
    stage='browser';browser=await chromium.launch({headless:true,timeout});context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:false,serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light'});context.setDefaultTimeout(timeout);context.setDefaultNavigationTimeout(timeout);
    await context.route('**/*',async route=>{try{new URL(route.request().url()).origin===new URL(GUI_URL).origin?await route.continue():await route.abort('blockedbyclient');}catch{await route.abort('failed').catch(()=>{});}});
    page=await context.newPage();stage='owner-login';launchUrl=await hostCall(host,function(){return(this.root??this).get('connection').authenticatedUrl('http://127.0.0.1:51781/');}.toString());assertOfficialLaunchUrl(launchUrl);try{await page.goto(launchUrl,{waitUntil:'domcontentloaded',timeout});}finally{launchUrl=undefined;}
    stage='clean-root';await page.waitForURL(url=>isCleanRoot(url.href),{timeout});if(!isCleanRoot(page.url()))throw new Error();clean=true;
    stage='preview';await acknowledgePreviewNotice(page,timeout);if(await page.locator('[role="dialog"],dialog[open]').count())throw new Error();
    stage='client-source';const source=await wait(async()=>{const fresh=(await host.call('DSHInspector.getSources')).sources.filter(row=>row.kind==='client'&&!before.has(row.sourceId));if(fresh.length>1)throw new Error();return fresh[0];},Boolean,timeout);
    client=await(dependencies.connect??connectInspector)({endpoint:INSPECTOR_URL,timeoutMs:timeout,client:source.sourceId});await client.call('Runtime.enable');stage='client-context';if(!await callClient(client,function(){const ctx=this.root??this;return!!ctx.get('sessions')&&!!ctx.get('uiWorkspace');}))throw new Error();
    await page.getByRole('button',{name:'Kanban',exact:true}).waitFor({state:'visible'});await boardSnapshot(page);shutdown.signal.throwIfAborted();
    stage='fixture-path';paths=await(dependencies.prepareFixture??prepareFixture)(options,fileURLToPath(new URL('../',import.meta.url)),nonce);
    stage='fixture-C';const created=await rpc(page,'session/create',{request:{cwd:paths.repo}});C=created.sessionId;if(typeof C!=='string')throw new Error();owned.add(C);await rpc(page,'session/rename',{request:{sessionId:C,title:title+' main C'}});await callClient(client,OPEN_MAIN,[C]);await wait(mainSelected,Boolean,timeout);
    stage='fixture-project';const saved=await command(page,{type:'project.save',project:{name:projectName,projectPath:paths.repo,gitRootPath:paths.repo,defaultBranch:'main'}});const matches=saved.state.projects.filter(project=>project.name===projectName&&project.projectPath===paths.repo);if(matches.length!==1)throw new Error();projectId=matches[0].id;
    await page.getByRole('button',{name:'Kanban',exact:true}).click();const board=page.locator(BOARD);await board.waitFor({state:'visible'});
    stage='fixture-task';checks.taskUiStep='new-task-open';checks.taskUiBeforeOpen=await taskUiCheckpoint(page,board,projectId);
    await board.getByRole('button',{name:'New task',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New task',exact:true});
    checks.taskUiStep='title-input';checks.taskUiAfterOpen=await taskUiCheckpoint(page,board,projectId);await dialog.getByLabel('Title',{exact:true}).fill(title);
    checks.taskUiStep='project-select';checks.taskUiBeforeProject=await taskUiCheckpoint(page,board,projectId);await selectFixtureProject(dialog,projectId);
    checks.taskUiStep='create-submit';checks.taskUiBeforeSubmit=await taskUiCheckpoint(page,board,projectId);await dialog.getByRole('button',{name:'Create task',exact:true}).click();
    checks.taskUiStep='native-task-created';
    const first=await wait(ownTask,task=>task?.sessionIds?.length===1,timeout);taskId=first.id;A=first.sessionIds[0];if(A===C)throw new Error();owned.add(A);checks.taskUiStep='own-drawer-visible';await drawer().waitFor({state:'visible'});stage='native-target';checks.taskUiStep='native-target-A-ready';await select('Agent 1');
    stage='fixture-B';await drawer().getByRole('button',{name:'New conversation',exact:true}).click();const second=await wait(ownTask,task=>task?.sessionIds?.length===2,timeout);B=second.sessionIds.find(id=>id!==A);if(!B||B===C)throw new Error();owned.add(B);
    stage='tool-guard';assertOwnedIds([C,A,B],owned);toolGuard=await guardFixtureTools(host,options,[C,A,B],paths.repo);snapshots.toolGuard=await toolGuard.snapshot();if(snapshots.toolGuard.activated!==true)throw new Error();checks.guardActivated=true;
    stage='fresh-no-prompt';snapshots.fresh=await summary();if(Object.values(snapshots.fresh).some(item=>item.users||item.assistants||item.turnStarts||item.tools))throw new Error();checks.freshDistinctNoAutomaticPrompt=true;
    stage='draft-A';await select('Agent 1');const draftA='Unsent native A draft '+nonce;await editor().fill(draftA);
    stage='draft-B';await select('Agent 2');if((await editor().innerText()).includes(draftA))throw new Error();const draftB='Unsent native B draft '+nonce;await editor().fill(draftB);
    stage='draft-A-restored';await select('Agent 1');if((await editor().innerText()).trim()!==draftA)throw new Error();await select('Agent 2');if((await editor().innerText()).trim()!==draftB)throw new Error();checks.independentDrafts=true;if(!await mainSelected())throw new Error();checks.mainCUnchangedDuringDrafts=true;snapshots.afterDrafts=await summary();if(Object.values(snapshots.afterDrafts).some(item=>item.users||item.assistants||item.turnStarts||item.tools))throw new Error();
    observer=await observe(host,[C,A,B]);
    if(!toolGuard||!checks.guardActivated)throw new Error();
    stage='model-A';await select('Agent 1');await send('Reply exactly '+markers[0]+'. Do not call any tools.','short',A);snapshots.afterA=await wait(summary,state=>{if(Object.values(state).some(item=>item.tools))throw new Error();if(state[B].users||state[C].users||state[C].assistants)throw new Error();return state[A].humanMarkers.includes(markers[0])&&state[A].assistantMarkers.includes(markers[0])&&!state[A].running;},modelTimeout);if(snapshots.afterA[B].users||snapshots.afterA[C].users||snapshots.afterA[C].assistants)throw new Error();await native().getByText(markers[0],{exact:true}).waitFor({state:'visible'});checks.onlyAReceivedFirstPrompt=true;
    stage='model-B';await select('Agent 2');await send('Reply exactly '+markers[1]+'. Do not call any tools.','short',B);snapshots.afterB=await wait(summary,state=>{if(Object.values(state).some(item=>item.tools))throw new Error();if(state[A].users!==1||state[C].users||state[C].assistants)throw new Error();return state[B].humanMarkers.includes(markers[1])&&state[B].assistantMarkers.includes(markers[1])&&!state[B].running;},modelTimeout);await native().getByText(markers[1],{exact:true}).waitFor({state:'visible'});if(snapshots.afterB[A].users!==1||snapshots.afterB[B].users!==1||snapshots.afterB[C].users||snapshots.afterB[C].assistants)throw new Error();checks.onlyBReceivedSecondPrompt=true;
    stage='stop-A';await select('Agent 1');await send('Do not call tools. Output integers from 1 through 50000, one per line. Continue until explicitly stopped.','long',A);await wait(summary,state=>{if(state[B].users!==1||state[C].users||Object.values(state).some(item=>item.tools))throw new Error();return state[A].running;},timeout);const beforeStop=await summary();await nativeConversationTarget(native(),A).getByRole('button',{name:'Stop generating',exact:true}).first().click();snapshots.afterStop=await wait(summary,state=>!state[A].running,timeout);if(snapshots.afterStop[A].aborted<=beforeStop[A].aborted||snapshots.afterStop[B].aborted!==beforeStop[B].aborted||snapshots.afterStop[B].users!==beforeStop[B].users)throw new Error();checks.nativeStopTargetedA=true;checks.BUnchangedByStop=true;
    stage='routing-evidence';checks.mainCUnchangedAfterModels=await mainSelected();if(!checks.mainCUnchangedAfterModels)throw new Error();snapshots.streams=await observer.snapshot();if(snapshots.streams[A].chunk<1||snapshots.streams[B].chunk<1||snapshots.streams[C].chunk!==0)throw new Error();checks.nativeStreamRoutedToAAndBOnly=true;checks.approval='not-tested';
    stage='screenshot';await evidenceDirectory(paths);if(!isCleanRoot(page.url())||await drawer().count()!==1)throw new Error();await drawer().screenshot({path:join(paths.evidence,'fixture-A-after-stop.png'),animations:'disabled',caret:'hide'});checks.fixtureScreenshot='fixture-A-after-stop.png';
    if(options.verifyApproval){
      stage='approval-precondition';approvalResult={requested:true,status:'not-tested',precondition:'Requires a completed direct-native-Bash escalation header and a public fixture-only workspace-write ask preset.'};
      snapshots.coreToolGuard=await toolGuard.snapshot();checks.coreZeroModelToolAttempts=Object.values(snapshots.coreToolGuard.blockedCounts).every(count=>count===0);
      const guardedApproval=await approvalGuardObject(host,options,{A,B,C},paths.repo,nonce);
      const approvalPreflight=await guardedApproval.snapshot();if(approvalPreflight.unsupported){approvalResult.unsupported=approvalPreflight.unsupported;await guardedApproval.dispose();throw new Error();}
      try{await toolGuard.dispose();}catch{await guardedApproval.dispose();throw new Error();}toolGuard=guardedApproval;
      approvalResult.guard=await toolGuard.preparePreset();await select('Agent 1');
      stage='approval-request';approvalResult.initialPromptRequested=true;await send(await toolGuard.prompt(),'short',A);
      const pending=await wait(async()=>{const state=await toolGuard.state();approvalResult.last=state;if(state.unexpected||state.granted||state.decidedCount>0||state.noApprovalIdle||Object.values(state.blockedCounts).some(count=>count>0))throw new Error();return state;},state=>state.pending,modelTimeout);
      const identity=await toolGuard.identity();
      const clientEvidence=await wait(async()=>{const value=await callClient(client,function(id,callId){const pending=(this.root??this).get('uiSession').sessionStatus.getSnapshot().get(id)?.pendingInteraction;return{clientPendingPresent:pending!==undefined,clientSessionMatch:pending?.sessionId===id,clientCallMatch:typeof callId==='string'&&pending?.callId===callId,clientIsBashApproval:pending?.kind==='approval'&&pending?.toolName==='bash'};},[A,identity.callId]);if(value.clientPendingPresent&&!Object.values(value).every(item=>item===true))throw new Error();return value;},value=>Object.values(value).every(item=>item===true),timeout);
      stage='approval-reject';approvalResult.client=clientEvidence;const panel=nativeConversationTarget(native(),A).locator('[data-approval-key]');await panel.waitFor({state:'visible',timeout});
      if(await panel.count()!==1||!pending.knownAsked||!Object.values(clientEvidence).every(value=>value===true))throw new Error();
      if(!isCleanRoot(page.url()))throw new Error();await evidenceDirectory(paths);await panel.screenshot({path:join(paths.evidence,'fixture-A-native-approval.png'),animations:'disabled',caret:'hide'});
      await rejectKnownNativeApproval(options,native(),A,{...pending,...clientEvidence},timeout);approvalResult.nativeRejectClicked=true;
      stage='approval-resume';approvalResult.after=await wait(async()=>{const state=await toolGuard.state();approvalResult.last=state;if(state.unexpected||state.granted||Object.values(state.blockedCounts).some(count=>count>0))throw new Error();return state;},state=>state.rejected&&state.resumed&&state.toolRejected&&state.AIdle&&state.completed,modelTimeout);
      approvalResult.mainCUnchanged=await mainSelected();if(!approvalResult.mainCUnchanged)throw new Error();approvalResult.status='passed';checks.approval='passed';
    }
  }catch{checks.failedAt=STAGES.has(stage)?stage:'arguments';if(approvalResult&&approvalResult.status!=='passed')approvalResult.status=approvalResult.initialPromptRequested?'failed':'not-tested';}
  finally{
    launchUrl=undefined;cleanup.attempted=!!paths;
    if(paths&&host){
      try{for(const id of await hostCall(host,OWNED_IDS.toString(),[paths.repo]))owned.add(id);}catch{cleanup.errors.push('owned-session-discovery');}
      // Only identities created under this exclusive run's canonical cwd are eligible.
      for(const id of owned){try{const current=await hostCall(host,SUMMARIZE.toString(),[[id],paths.repo,markers]);if(!current[id]?.running)continue;let clicked=false;if(page&&clean&&(id===A||id===B)){try{await select(id===A?'Agent 1':'Agent 2',false);await nativeConversationTarget(native(),id).getByRole('button',{name:'Stop generating',exact:true}).first().click();cleanup.nativeStopClicked.push(id);clicked=true;}catch{}}if(!clicked&&await hostCall(host,CANCEL.toString(),[id,paths.repo]))cleanup.stopFallback.push(id);}catch{cleanup.errors.push('native-stop');}}
      try{await until(async()=>hostCall(host,SUMMARIZE.toString(),[[...owned],paths.repo,markers]),state=>Object.values(state).every(item=>!item.running),timeout);ownedIdle=true;}catch{cleanup.errors.push('idle');}
      if(page&&clean&&projectId){try{const task=await ownTask();if(task){if(task.id!==taskId&&taskId)throw new Error();if(task.worktree!==null)throw new Error();await command(page,{type:'task.delete',taskId:task.id,confirmed:true,expectedWorktreePath:null});taskId=task.id;await until(ownTask,value=>value===undefined,timeout);checks.fixtureTaskDeleted=true;}}catch{cleanup.errors.push('task-delete');}}
      for(const id of owned){try{await hostCall(host,ARCHIVE.toString(),[id,paths.repo]);cleanup.archived.push(id);}catch{cleanup.errors.push('archive');}}
      try{snapshots.retainedHistories=await hostCall(host,SUMMARIZE.toString(),[[...owned],paths.repo,markers]);}catch{cleanup.errors.push('retained-history-inspection');}
    }
    try{await observer?.dispose();}catch{cleanup.errors.push('observer');}
    if(toolGuard){try{snapshots.toolGuard=await toolGuard.snapshot();checks.blockedCounts=snapshots.toolGuard.blockedCounts;if(Object.values(checks.blockedCounts).some(count=>count>0)){checks.zeroModelToolAttempts=false;checks.failedAt??='tool-guard';}else checks.zeroModelToolAttempts=(snapshots.toolGuard.allowedCount??0)===0;if(ownedIdle){snapshots.toolGuardAfterCleanup=await toolGuard.dispose();cleanup.toolGuardDisposed=snapshots.toolGuardAfterCleanup.activated===false;}else{cleanup.toolGuardRetained=true;cleanup.errors.push('tool-guard-retained');}}catch{cleanup.toolGuardRetained=true;cleanup.errors.push('tool-guard-cleanup');}}
    for(const resource of[client,page,context,browser,host])try{await close(resource);}catch{cleanup.errors.push('resource-close');}
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
  }
  const result=safeReport({ok:!checks.failedAt&&cleanup.errors.length===0,stage:checks.failedAt??(cleanup.errors.length?'cleanup':'artifact'),runId:nonce,fixture:paths?{repo:paths.repo,retained:true,projectRetained:!!projectId,report:paths.report}:undefined,ids:{project:projectId,task:taskId,A,B,C},checks,snapshots,modelRequests:budget.snapshot(),cleanup,approval:approvalResult});
  if(paths){try{await evidenceDirectory(paths);await writeFile(paths.report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}catch{result.ok=false;result.stage='artifact';}}
  return result;
}
export async function main(argv=process.argv.slice(2)){const options=parseArgs(argv);if(options.help)return{help:HELP};return runVerification(options);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.includes("--allow-model-requests")){process.stderr.write("Real-model verification is disabled; use the deterministic kanban-fixture adapter.\n");process.exit(1);}try{const result=await main();process.stdout.write((result.help??JSON.stringify(result,null,2))+'\n',()=>process.exit(result.help||result.ok?0:1));}catch(error){const safe=error instanceof NativeUatFailure?error.stage:'arguments';process.stderr.write('Native G2 verification refused/failed at stage: '+safe+'\n',()=>process.exit(1));}}
