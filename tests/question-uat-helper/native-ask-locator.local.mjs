/** Offline-only locator regression: setContent, no network, auth, GUI, Inspector, or Native. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { answerOwnedNativeAsk, assertQuietEnvironment, nativeAskPanel } from '../../scripts/verify-native-questions.mjs';

assertQuietEnvironment(process.env);
const options={allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true,timeoutMs:1000,modelTimeoutMs:1000,nativePreset:'standard',ptcPreset:'ptc'};
const question='Local isolated native question';
const panel=(text=question)=>'<div data-question-key="local-question"><h2>'+text+'</h2><div role="radiogroup"><button role="radio" aria-label="Confirmed" aria-checked="false">Confirmed</button></div><button>Submit</button></div>';
const document=(own,other='')=>'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'none\'"><section data-conversation-session="local-owned">'+own+'</section><section data-conversation-session="local-other">'+other+'</section>';
let browser,context,networkAttempts=0;
try{
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>{networkAttempts++;return route.abort('blockedbyclient');});
  await context.routeWebSocket(()=>true,socket=>{networkAttempts++;socket.close();});
  const page=await context.newPage();page.setDefaultTimeout(1000);
  const root=()=>page.locator('[data-conversation-session="local-owned"]');
  await page.setContent(document(panel(),panel()));
  const old=root().locator('[data-question-key]').filter({has:root().getByText(question,{exact:true})});
  const oldCount=await old.count(),newCount=await nativeAskPanel(page,root(),question).count();
  assert.equal(oldCount,0);assert.equal(newCount,1);
  await page.setContent(document(panel('Different local question'),panel()));
  const wrongSessionCount=await nativeAskPanel(page,root(),question).count();assert.equal(wrongSessionCount,0);
  await page.setContent(document(panel()+panel()));
  const duplicateCount=await nativeAskPanel(page,root(),question).count(),checkpoint={};assert.equal(duplicateCount,2);
  await assert.rejects(()=>answerOwnedNativeAsk(options,{page,root:root(),sessionId:'local-owned',question,checkpoint}));
  assert.equal(checkpoint.outcome,'panel-ambiguous');assert.notEqual(checkpoint.radioClicked,true);assert.notEqual(checkpoint.submitClicked,true);
  assert.equal(page.url(),'about:blank');assert.equal(networkAttempts,0);
  console.log(JSON.stringify({offline:true,oldCount,newCount,wrongSessionCount,duplicateCount,duplicateRejected:true,networkAttempts}));
}catch{console.log(JSON.stringify({offline:true,passed:false,rawErrorsOmitted:true}));process.exitCode=1;}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
