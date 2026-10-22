#!/usr/bin/env node
/** Explicit owner-authorized off/on verification of ONLY dsh-kanban on the existing backend. */
import {mkdir, lstat, realpath, readFile, stat} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {connectInspector, callHost} from './dsh-inspect.mjs';
import {GUI_URL, INSPECTOR_URL, DEFAULT_COLUMNS, BOARD_SELECTOR, NATIVE_DIALOG_SELECTOR, isCleanRoot, assertOfficialLaunchUrl, acknowledgePreviewNotice} from './live-verify.mjs';

export const NATIVE_PANELS = ['Automation tasks', 'Plugins'];
const STAGES=new Set(['arguments','owner-authorization','debug-guard','dependency','inspector','initial-state','current-artifact','browser-launch','browser-context','request-fence','page','owner-login-url','owner-login','clean-redirect','preview-notice','native-dialog','startup-selection','native-before','open-board','disable','disable-application','disabled-state','ui-withdrawal','native-disabled','enable','enable-application','enabled-state','ui-return','native-enabled','board-assertions','evidence-path','screenshot','restore','cleanup']);
export const HELP=[
  'Usage: node scripts/live-lifecycle.mjs --allow-owner-test [--timeout-ms 30000]',
  'DELIBERATELY disables then enables ONLY dsh-kanban through the public Host',
  'pluginManager on EXISTING http://127.0.0.1:51781/ and inspector127.0.0.1:9230.',
  'Run ONLY after the parent has confirmed final build/install READY.',
  'Requires initial own bundle enabled+active and current linked client artifact.',
  'Uses official owner login privately in an ephemeral browser; exact Preview',
  'Notice Continue and Kanban navigation only. No data/model/settings actions.',
  'Checks Automation tasks + Plugins stay present while Kanban withdraws/returns.',
  'Always inspects state and attempts to restore initial enabled=true after a',
  'disable request, including uncertain/timed-out requests. Never restarts.',
  'If restoration is unverified, inspect inventory before retrying: a timed-out',
  'change may STILL be running. No implicit mutation retries or restarts.',
  'Outputs safe application/restart reason + warning summaries, not raw errors.',
  'Final screenshot is only the unobstructed plugin under .verification.',
  'Normal HTTP client of SAME backend; NOT the existing Desktop renderer.',
].join('\n');
class LifecycleFailure extends Error {
  constructor(stage){super('Lifecycle verification failed');this.stage=STAGES.has(stage)?stage:'arguments';}
}
export function parseArgs(argv) {
  const options={allowOwnerTest:false,timeoutMs:30000,help:false};const seen=new Set();
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];if(seen.has(flag))throw new LifecycleFailure('arguments');seen.add(flag);
    if(flag==='--help'){options.help=true;continue;}
    if(flag==='--allow-owner-test'){options.allowOwnerTest=true;continue;}
    if(flag==='--timeout-ms') {
      const raw=argv[++i],value=Number(raw);
      if(!/^[0-9]+$/.test(raw??'')||!Number.isSafeInteger(value)||value<1000||value>120000)throw new LifecycleFailure('arguments');
      options.timeoutMs=value;continue;
    }
    throw new LifecycleFailure('arguments');
  }
  if(!options.help&&!options.allowOwnerTest)throw new LifecycleFailure('owner-authorization');return options;
}
async function bounded(operation,timeoutMs) {
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
async function closeResource(resource){if(resource)await bounded(()=>resource.close(),5000);}
async function acquire(operation,timeoutMs) {
  let expired=false;
  try{return await bounded(async()=>{const resource=await operation();if(expired){await closeResource(resource).catch(()=>{});throw new Error();}return resource;},timeoutMs);}
  catch(error){expired=true;throw error;}
}
function quietEnvironment(env) {
  if(['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'].some(key=>!!env[key]))throw new Error();
}
const OWN_STATE=async function() {
  const ctx=this.root??this,manager=ctx.get('pluginManager');
  if(!manager)throw new Error();
  const bundle=(await manager.listBundles()).find(row=>row.name==='dsh-kanban');
  const rows=(await manager.listPlugins()).filter(row=>row.moduleName==='dsh-kanban');
  const modules=ctx.get('clientModules'),row=modules?.graph()?.entries?.find(row=>row.id==='dsh-kanban');
  return {selected:bundle?.enabled===true,active:rows.some(row=>row.enabled&&row.fiberPhase==='active'),
    clientAdvertised:!!row,version:bundle?.version??null,clientRevision:row?.rev??null,
    clientArtifact:modules?.artifactBaseline('dsh-kanban')??null};
};
const OWN_CHANGE=async function(enabled) {
  if(typeof enabled!=='boolean')throw new Error();
  const manager=(this.root??this).get('pluginManager');if(!manager)throw new Error();
  const change=await manager.setBundleEnabled('dsh-kanban',enabled);
  const applications=['applied','restart-required','failed','overridden','cancelled'];
  const reasons=['no-hmr','package-moved','host-module','unmanaged-plugin','module-comparison'];
  const errors=['management-required','unaddressable','unknown-plugin','invalid-spec','already-installed','ambiguous-install','not-bundle','not-removable','stop-profile','bundle-in-use','stale-approval','incompatible-version','operation-error'];
  const warningCount=Array.isArray(change.warnings)?change.warnings.length:0;
  return {application:applications.includes(change.application)?change.application:'unknown',
    restartReason:change.restartReason===undefined?null:reasons.includes(change.restartReason)?change.restartReason:'unknown',
    changed:change.changed===true,enabled,
    errorCode:change.error===undefined?null:errors.includes(change.error.code)?change.error.code:'unknown',
    warningCount,warnings:warningCount?['Profile reconciliation reported warnings; inspect native Plugins for details.']:[]};
};
const OWNER_LOGIN=function(){return (this.root??this).get('connection').authenticatedUrl('http://127.0.0.1:51781/');};
function publicState(state) {
  return {selected:state.selected===true,active:state.active===true,clientAdvertised:state.clientAdvertised===true,
    version:typeof state.version==='string'&&/^[0-9A-Za-z.+-]{1,64}$/.test(state.version)?state.version:null,
    clientRevision:typeof state.clientRevision==='string'&&/^[0-9a-f]{12}$/.test(state.clientRevision)?state.clientRevision:null};
}
function isInitiallyActive(state){return state.selected===true&&state.active===true&&state.clientAdvertised===true;}
function isWithdrawn(state){return state.selected===false&&state.active===false&&state.clientAdvertised===false;}
/** Read public artifact baseline + local built bytes only, not profile configuration or private caches. */
export async function verifyCurrentArtifact(state,io={realpath,readFile,stat}) {
  const workspace=await io.realpath(fileURLToPath(new URL('../',import.meta.url)));
  const local=await io.realpath(resolve(workspace,'lib/client.js')),baseline=state.clientArtifact;
  if(!baseline||typeof baseline.path!=='string'||await io.realpath(baseline.path)!==local)throw new Error();
  const observed=await io.stat(local);
  if(observed.size!==baseline.size||observed.mtimeMs!==baseline.mtimeMs||observed.ctimeMs!==baseline.ctimeMs)throw new Error();
  const bytes=await io.readFile(local),after=await io.stat(local);
  if(after.size!==baseline.size||after.mtimeMs!==baseline.mtimeMs||after.ctimeMs!==baseline.ctimeMs)throw new Error();
  return {clientSha256:createHash('sha256').update(bytes).digest('hex'),clientRevision:publicState(state).clientRevision};
}
async function prepareScreenshot() {
  const workspace=await realpath(fileURLToPath(new URL('../',import.meta.url))),directory=resolve(workspace,'.verification');
  await mkdir(directory,{recursive:true});const info=await lstat(directory);
  if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==directory)throw new Error();
  const absolute=resolve(directory,'kanban-lifecycle-existing-backend-'+randomUUID()+'.png');return {absolute,relative:relative(workspace,absolute)};
}
async function nativePanels(page,timeoutMs) {
  for(const label of NATIVE_PANELS){const button=page.getByRole('button',{name:label,exact:true});await button.waitFor({state:'visible',timeout:timeoutMs});if(await button.count()!==1)throw new Error();}
}
async function noDialog(page){if(await page.locator(NATIVE_DIALOG_SELECTOR).count()!==0)throw new Error();}
async function assertBoard(page,board,timeoutMs) {
  await board.waitFor({state:'visible',timeout:timeoutMs});if(await board.count()!==1)throw new Error();
  await board.getByRole('heading',{name:'Kanban',level:1,exact:true}).waitFor({state:'visible',timeout:timeoutMs});
  for(const label of DEFAULT_COLUMNS){const column=board.locator('.kb-column').filter({has:page.getByRole('heading',{name:label,level:2,exact:true})});await column.waitFor({state:'visible',timeout:timeoutMs});if(await column.count()!==1)throw new Error();}
  if(await board.locator('.kb-column').count()!==DEFAULT_COLUMNS.length||await board.getByRole('alert').count()!==0)throw new Error();
}

export async function runLifecycle(options,dependencies={}) {
  const report={ok:false,backend:GUI_URL,scope:'Ephemeral HTTP client of existing backend; NOT existing Desktop renderer',
    startupUnchanged:false,previewAcknowledged:false,disableRequested:false,restoration:{required:false,attempted:false,verified:false}};
  const timeoutMs=options?.timeoutMs??30000;
  let stage='owner-authorization',client,restorationClient,browser,context,page,loginUrl;
  let mutationUncertain=false,enabledVerified=false;
  const hostCall=dependencies.hostCall??callHost;
  const state=(connection=client)=>bounded(()=>hostCall(connection,OWN_STATE.toString()),timeoutMs);
  const change=(enabled,connection=client)=>bounded(()=>hostCall(connection,OWN_CHANGE.toString(),[enabled]),timeoutMs);
  try {
    if(options?.allowOwnerTest!==true||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new Error();
    stage='debug-guard';quietEnvironment(dependencies.env??process.env);
    stage='dependency';const {chromium}=await bounded(dependencies.loadPlaywright??(()=>import('@playwright/test')),timeoutMs);if(!chromium?.launch)throw new Error();
    stage='inspector';client=await acquire(()=>(dependencies.connect??connectInspector)({endpoint:INSPECTOR_URL,timeoutMs}),timeoutMs);await client.call('Runtime.enable');
    stage='initial-state';const initial=await state();report.initial=publicState(initial);if(!isInitiallyActive(initial))throw new Error();
    stage='current-artifact';report.artifact=await bounded(()=>(dependencies.verifyArtifact??verifyCurrentArtifact)(initial),timeoutMs);
    stage='browser-launch';browser=await acquire(()=>chromium.launch({headless:true,timeout:timeoutMs}),timeoutMs);
    stage='browser-context';context=await acquire(()=>browser.newContext({viewport:{width:1920,height:1000},acceptDownloads:false,serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light',locale:'en-US'}),timeoutMs);
    context.setDefaultTimeout(timeoutMs);context.setDefaultNavigationTimeout(timeoutMs);
    stage='request-fence';await bounded(()=>context.route('**/*',async route=>{try{if(new URL(route.request().url()).origin!==new URL(GUI_URL).origin)return await route.abort('blockedbyclient');await route.continue();}catch{await route.abort('failed').catch(()=>{});}}),timeoutMs);
    stage='page';page=await acquire(()=>context.newPage(),timeoutMs);
    stage='owner-login-url';loginUrl=await bounded(()=>hostCall(client,OWNER_LOGIN.toString()),timeoutMs);assertOfficialLaunchUrl(loginUrl);
    stage='owner-login';try{await page.goto(loginUrl,{waitUntil:'domcontentloaded',timeout:timeoutMs});}finally{loginUrl=undefined;}
    stage='clean-redirect';await page.waitForURL(url=>isCleanRoot(url.href),{waitUntil:'domcontentloaded',timeout:timeoutMs});if(!isCleanRoot(page.url()))throw new Error();
    stage='preview-notice';report.previewAcknowledged=await acknowledgePreviewNotice(page,timeoutMs);
    stage='native-dialog';await noDialog(page);
    const kanban=page.getByRole('button',{name:/^kanban$/i}),board=page.locator(BOARD_SELECTOR);
    await kanban.waitFor({state:'visible',timeout:timeoutMs});
    stage='startup-selection';if(await board.isVisible())throw new Error();report.startupUnchanged=true;
    stage='native-before';await nativePanels(page,timeoutMs);report.nativeBefore=true;
    stage='open-board';await kanban.click({timeout:timeoutMs});await assertBoard(page,board,timeoutMs);if(!isCleanRoot(page.url()))throw new Error();
    stage='disable';report.disableRequested=true;report.restoration.required=true;
    try{report.off=await change(false);}catch{mutationUncertain=true;throw new Error();}
    stage='disable-application';if(report.off.application!=='applied')throw new Error();
    stage='disabled-state';const disabled=await state();report.disabledState=publicState(disabled);if(!isWithdrawn(disabled))throw new Error();
    stage='ui-withdrawal';await kanban.waitFor({state:'hidden',timeout:timeoutMs});await board.waitFor({state:'hidden',timeout:timeoutMs});report.entryWithdrawn=true;report.regionWithdrawn=true;
    stage='native-disabled';await nativePanels(page,timeoutMs);report.nativeWhileDisabled=true;
    stage='enable';try{report.on=await change(true);}catch{mutationUncertain=true;throw new Error();}
    stage='enable-application';if(report.on.application!=='applied')throw new Error();
    stage='enabled-state';const enabled=await state();report.enabledState=publicState(enabled);if(!isInitiallyActive(enabled))throw new Error();enabledVerified=true;
    stage='ui-return';await kanban.waitFor({state:'visible',timeout:timeoutMs});report.entryReturned=true;
    stage='native-enabled';await nativePanels(page,timeoutMs);report.nativeAfter=true;
    stage='board-assertions';await kanban.click({timeout:timeoutMs});await assertBoard(page,board,timeoutMs);
    stage='preview-notice';if(!report.previewAcknowledged)report.previewAcknowledged=await acknowledgePreviewNotice(page,timeoutMs);
    stage='evidence-path';const screenshot=await bounded(dependencies.prepareScreenshot??prepareScreenshot,timeoutMs);
    stage='native-dialog';await noDialog(page);
    stage='screenshot';if(!isCleanRoot(page.url()))throw new Error();await board.screenshot({path:screenshot.absolute,animations:'disabled',caret:'hide',timeout:timeoutMs});
    report.screenshot=screenshot.relative;report.columns=[...DEFAULT_COLUMNS];report.ok=true;
  } catch {report.failedStage=STAGES.has(stage)?stage:'arguments';}
  finally {
    loginUrl=undefined;
    if(report.disableRequested) {
      let restoreConnection=client;
      try {
        // A timeout is NOT proof of failure: inspect status first, then serialize an idempotent true request.
        let before;
        try{before=await state();}
        catch{restorationClient=await acquire(()=>(dependencies.connect??connectInspector)({endpoint:INSPECTOR_URL,timeoutMs}),timeoutMs);await restorationClient.call('Runtime.enable');restoreConnection=restorationClient;before=await state(restoreConnection);}
        report.restoration.before=publicState(before);report.restoration.uncertainRequest=mutationUncertain;
        if(mutationUncertain||!enabledVerified||!isInitiallyActive(before)) {
          report.restoration.attempted=true;report.restoration.change=await change(true,restoreConnection);
          if(report.restoration.change.application!=='applied'){report.ok=false;report.failedStage??='restore';}
          // Never restart, even if the manager says the profile change requires it.
        }
        const after=await state(restoreConnection);report.restoration.after=publicState(after);
        report.restoration.verified=isInitiallyActive(after);
        if(!report.restoration.verified){report.ok=false;report.failedStage??='restore';}
      } catch {report.restoration.verified=false;report.ok=false;report.failedStage??='restore';}
    }
    let cleanupFailed=false;
    for(const resource of [page,context,browser,restorationClient,client])try{await closeResource(resource);}catch{cleanupFailed=true;}
    if(cleanupFailed){report.ok=false;report.failedStage??='cleanup';}
  }
  return report;
}
export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);if(options.help)return {help:HELP};return runLifecycle(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{const report=await main();const restart=[report.off,report.on,report.restoration?.change].some(change=>change?.application==='restart-required');process.stdout.write((report.help??JSON.stringify(report,null,2))+'\n',()=>process.exit(report.help||report.ok?0:restart?3:1));}
  catch(error){const stage=error instanceof LifecycleFailure?error.stage:'arguments';process.stdout.write(JSON.stringify({ok:false,failedStage:stage,backend:GUI_URL})+'\n',()=>process.exit(1));}
}
