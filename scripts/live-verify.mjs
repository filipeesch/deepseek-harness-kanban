#!/usr/bin/env node
/**
 * Explicit owner-authorized UI verification against the EXISTING DSH backend.
 * Never use this module to dump an authenticated URL or existing credentials.
 * No authentication/browser runs on import, --help, or without --allow-owner-test.
 */
import {mkdir, lstat, realpath} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {connectInspector, callHost} from './dsh-inspect.mjs';

export const GUI_URL = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:51781/';
export const INSPECTOR_URL = 'http://127.0.0.1:9230';
export const DEFAULT_COLUMNS = ['Backlog', 'Plan', 'In Progress', 'In Review', 'Done'];
export const BOARD_SELECTOR = 'section.dsh-kanban[aria-label="Kanban"]';
export const NATIVE_DIALOG_SELECTOR = '[role="dialog"]:visible, [role="alertdialog"]:visible, [aria-modal="true"]:visible, dialog[open]:visible';
const STAGES = new Set(['arguments','owner-authorization','debug-guard','dependency','inspector','plugin-preflight','browser-launch','browser-context','request-fence','page','owner-login-url','owner-login','clean-redirect','preview-notice','native-dialog','startup-selection','sidebar','board','heading','default-columns','evidence-path','screenshot','cleanup']);
export const HELP = [
  'Usage: node scripts/live-verify.mjs --allow-owner-test [--timeout-ms 30000]',
  'Pins EXISTING backend http://127.0.0.1:51781/ and inspector 127.0.0.1:9230.',
  'Requires built+enabled dsh-kanban and installed Playwright Chromium.',
  'Uses official ctx.connection.authenticatedUrl only in private process memory.',
  'Creates a temporary browser context; acknowledges ONLY known Preview Notice',
  'with its normal Continue button, asserts startup did not select Kanban, then',
  'real-clicks Kanban and checks header/default columns. Captures ONLY the plugin',
  'region after clean-root login redirect and an unobstructed-dialog assertion.',
  'Screenshot: .verification/kanban-existing-backend-<unique>.png',
  'No server, core changes, origin spoof, token output, raw errors, tracing, HAR,',
  'video, storageState, persistent browser profile, or deeper board mutations.',
  'Verifies an HTTP browser client of the same backend, NOT the Desktop renderer.',
  'Only parent/operator should run this after authorizing owner-login UI testing.',
].join('\n');

/** No underlying exception/cause is retained: Playwright errors may contain login URLs. */
export class LiveVerificationFailure extends Error {
  constructor(stage) {
    const safeStage=STAGES.has(stage)?stage:'arguments';
    super('Live verification failed at stage: '+safeStage);
    this.name='LiveVerificationFailure';this.stage=safeStage;
  }
}
export function parseArgs(argv) {
  const result={allowOwnerTest:false,timeoutMs:30000,help:false};
  const seen=new Set();
  try {
    for(let index=0;index<argv.length;index++) {
      const flag=argv[index];
      if(seen.has(flag))throw new Error();seen.add(flag);
      if(flag==='--help'){result.help=true;continue;}
      if(flag==='--allow-owner-test'){result.allowOwnerTest=true;continue;}
      if(flag==='--timeout-ms') {
        const raw=argv[++index],value=Number(raw);
        if(!/^[0-9]+$/.test(raw??'')||!Number.isSafeInteger(value)||value<1000||value>120000)throw new Error();
        result.timeoutMs=value;continue;
      }
      throw new Error();
    }
  } catch {throw new LiveVerificationFailure('arguments');}
  if(!result.help&&!result.allowOwnerTest)throw new LiveVerificationFailure('owner-authorization');
  return result;
}
export function isCleanRoot(raw) {
  try {const url=new URL(raw);return url.href===GUI_URL&&url.origin===new URL(GUI_URL).origin&&!url.username&&!url.password&&!url.search&&!url.hash;}
  catch {return false;}
}
export function assertOfficialLaunchUrl(raw) {
  try {
    const url=new URL(raw);
    const keys=[...url.searchParams.keys()];
    if(url.origin!==new URL(GUI_URL).origin||url.pathname!=='/'||url.username||url.password||url.hash
      ||keys.length!==1||keys[0]!=='token'||!/^[A-Za-z0-9_-]{32,256}$/.test(url.searchParams.get('token')??''))throw new Error();
  } catch {throw new LiveVerificationFailure('owner-login-url');}
}
function assertQuietEnvironment(env) {
  // Debug is checked BEFORE importing Playwright; its errors/API logs can repeat page.goto's URL.
  if(['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'].some(key=>!!env[key]))throw new LiveVerificationFailure('debug-guard');
}
async function bounded(operation,timeoutMs) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),timeoutMs);})]);}
  finally {clearTimeout(timer);}
}
async function acquire(operation,dispose,timeoutMs) {
  let expired=false;
  try {
    return await bounded(async()=>{
      const resource=await operation();
      if(expired){await dispose(resource).catch(()=>{});throw new Error();}
      return resource;
    },timeoutMs);
  } catch(error) {expired=true;throw error;}
}
async function closeResource(resource) {
  if(resource)await bounded(()=>resource.close(),5000);
}
/** Only the known native informational Preview Notice is allowed; never accept other consent. */
export async function acknowledgePreviewNotice(page,timeoutMs) {
  const notice=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Preview Notice',level:2,exact:true})});
  try {await notice.waitFor({state:'visible',timeout:Math.min(timeoutMs,8000)});}
  catch(error) {if(error?.name==='TimeoutError')return false;throw new Error();}
  if(!isCleanRoot(page.url())||await notice.count()!==1||await page.locator(NATIVE_DIALOG_SELECTOR).count()!==1)throw new Error();
  const proceed=notice.getByRole('button',{name:'Continue',exact:true});
  if(await proceed.count()!==1)throw new Error();
  await proceed.click({timeout:timeoutMs});
  await notice.waitFor({state:'hidden',timeout:timeoutMs});
  return true;
}
async function assertNoObstructingDialog(page) {
  if(await page.locator(NATIVE_DIALOG_SELECTOR).count()!==0)throw new Error();
}
async function prepareScreenshot() {
  const workspace=await realpath(fileURLToPath(new URL('../',import.meta.url))),directory=resolve(workspace,'.verification');
  await mkdir(directory,{recursive:true});
  const info=await lstat(directory);
  if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==directory)throw new Error();
  const absolute=resolve(directory,'kanban-existing-backend-'+randomUUID()+'.png');
  return {absolute,relative:relative(workspace,absolute)};
}

const PREFLIGHT=async function() {
  const ctx=this.root??this,manager=ctx.get('pluginManager');
  const entries=manager?await manager.listPlugins():[];
  return {hostActive:entries.some(row=>row.moduleName==='dsh-kanban'&&row.enabled&&row.fiberPhase==='active'),
    clientAdvertised:ctx.get('clientModules')?.graph()?.entries?.some(row=>row.id==='dsh-kanban')??false};
};
// Official public owner-login API, not private launchToken/browserAuth/cookie/config extraction.
// The secret-bearing return value must remain solely within runVerification's private variable.
const OFFICIAL_OWNER_LOGIN=function(base='http://127.0.0.1:51781/') {
  return (this.root??this).get('connection').authenticatedUrl(base);
};

export async function runVerification(options,dependencies={}) {
  let stage='owner-authorization',client,browser,context,page,launchUrl;
  let failed=false;
  const timeoutMs=options?.timeoutMs??30000;
  try {
    if(options?.allowOwnerTest!==true)throw new Error();
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new Error();
    stage='debug-guard';assertQuietEnvironment(dependencies.env??process.env);
    stage='dependency';
    const {chromium}=await bounded(dependencies.loadPlaywright??(()=>import('@playwright/test')),timeoutMs);
    if(!chromium?.launch)throw new Error();
    stage='inspector';
    client=await acquire(()=>(dependencies.connect??connectInspector)({endpoint:INSPECTOR_URL,timeoutMs}),closeResource,timeoutMs);
    await client.call('Runtime.enable');
    const hostCall=dependencies.hostCall??callHost;
    stage='plugin-preflight';
    const preflight=await bounded(()=>hostCall(client,PREFLIGHT.toString()),timeoutMs);
    if(preflight.hostActive!==true||preflight.clientAdvertised!==true)throw new Error();
    stage='browser-launch';
    browser=await acquire(()=>chromium.launch({headless:true,timeout:timeoutMs}),closeResource,timeoutMs);
    stage='browser-context';
    context=await acquire(()=>browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:false,serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light'}),closeResource,timeoutMs);
    context.setDefaultTimeout(timeoutMs);context.setDefaultNavigationTimeout(timeoutMs);
    stage='request-fence';
    await bounded(()=>context.route('**/*',async route=>{
      // No request/header/Origin rewriting. HTTP requests stay on the exact owned backend.
      try {if(new URL(route.request().url()).origin!==new URL(GUI_URL).origin)return await route.abort('blockedbyclient');await route.continue();}
      catch {await route.abort('failed').catch(()=>{});}
    }),timeoutMs);
    stage='page';page=await acquire(()=>context.newPage(),closeResource,timeoutMs);
    stage='owner-login-url';
    launchUrl=await bounded(()=>hostCall(client,OFFICIAL_OWNER_LOGIN.toString(),[GUI_URL]),timeoutMs);
    assertOfficialLaunchUrl(launchUrl);
    stage='owner-login';
    try {await page.goto(launchUrl,{waitUntil:'domcontentloaded',timeout:timeoutMs});}
    finally {launchUrl=undefined;}
    stage='clean-redirect';
    await page.waitForURL(url=>isCleanRoot(url.href),{waitUntil:'domcontentloaded',timeout:timeoutMs});
    if(!isCleanRoot(page.url()))throw new Error();
    stage='preview-notice';let previewAcknowledged=await acknowledgePreviewNotice(page,timeoutMs);
    stage='native-dialog';await assertNoObstructingDialog(page);
    stage='sidebar';
    const sidebar=page.getByRole('button',{name:/^kanban$/i});
    await sidebar.waitFor({state:'visible',timeout:timeoutMs});
    if(await sidebar.count()!==1)throw new Error();
    const board=page.locator(BOARD_SELECTOR);
    stage='startup-selection';if(await board.isVisible())throw new Error();
    const startupUnchanged=true;
    stage='sidebar';await sidebar.click({timeout:timeoutMs}); // Explicit native navigation; no synthetic service/panel selection.
    stage='board';
    await board.waitFor({state:'visible',timeout:timeoutMs});
    if(await board.count()!==1||!isCleanRoot(page.url()))throw new Error();
    stage='heading';await board.getByRole('heading',{name:'Kanban',level:1,exact:true}).waitFor({state:'visible',timeout:timeoutMs});
    stage='default-columns';
    for(const label of DEFAULT_COLUMNS) {
      const column=board.locator('.kb-column').filter({has:page.getByRole('heading',{name:label,level:2,exact:true})});
      await column.waitFor({state:'visible',timeout:timeoutMs});if(await column.count()!==1)throw new Error();
    }
    if(await board.locator('.kb-column').count()!==DEFAULT_COLUMNS.length)throw new Error();
    if(await board.getByRole('alert').count()!==0)throw new Error();
    // Catch a known notice that arrived after the first bounded arrival window.
    stage='preview-notice';if(!previewAcknowledged)previewAcknowledged=await acknowledgePreviewNotice(page,timeoutMs);
    stage='evidence-path';const screenshot=await bounded(dependencies.prepareScreenshot??prepareScreenshot,timeoutMs);
    stage='native-dialog';await assertNoObstructingDialog(page);
    stage='screenshot';if(!isCleanRoot(page.url()))throw new Error();
    // Locator screenshot is clipped to the plugin; never capture the initial login page, native chat, or sidebar.
    await board.screenshot({path:screenshot.absolute,animations:'disabled',caret:'hide',timeout:timeoutMs});
    return {ok:true,backend:GUI_URL,scope:'Ephemeral HTTP browser client of existing backend; NOT existing Desktop renderer',previewAcknowledged,startupUnchanged,sidebarClicked:true,heading:'Kanban',columns:[...DEFAULT_COLUMNS],screenshot:screenshot.relative};
  } catch {
    failed=true;throw new LiveVerificationFailure(stage);
  } finally {
    launchUrl=undefined;
    let cleanupFailed=false;
    for(const resource of [page,context,browser,client])try{await closeResource(resource);}catch{cleanupFailed=true;}
    if(cleanupFailed&&!failed)throw new LiveVerificationFailure('cleanup');
  }
}
export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);
  if(options.help)return {help:HELP};
  return runVerification(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {const output=await main();process.stdout.write((output.help??JSON.stringify(output,null,2))+'\n',()=>process.exit(0));}
  catch(error) {const stage=error instanceof LiveVerificationFailure?error.stage:'arguments';process.stderr.write('Live verification failed at stage: '+stage+'\n',()=>process.exit(1));}
}
