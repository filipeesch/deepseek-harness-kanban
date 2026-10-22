#!/usr/bin/env node
/** Inspect an already-running DSH synthetic inspector. No generic eval/auth/DOM mutation verbs. */
import {readFile, realpath, stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:9230';
const MUTATIONS = new Set(['install','enable','disable']);
const COMMANDS = new Set(['inventory','clients','snapshot',...MUTATIONS]);
export const HELP = [
  'Usage: node scripts/dsh-inspect.mjs [inventory|clients|snapshot] [options]',
  '  inventory [--package NAME]  Public plugin/bundle state, no configuration values',
  '  clients                    Active inspector sources and Runtime contexts',
  '  snapshot [--client ID]      Cordis semantic tree + text/value-free page structure',
  '',
  'Explicit mutations, never run implicitly:',
  '  install --path /absolute/built/package --allow-mutation',
  '    Calls public pluginManager.installBundle(link:/path, {enabled:false}).',
  '  enable --path /absolute/built/package --allow-mutation',
  '    Calls public pluginManager.setBundleEnabled(manifest.name, true).',
  '  disable --path /absolute/built/package --allow-mutation',
  '    Calls public pluginManager.setBundleEnabled(manifest.name, false).',
  '',
  'Options: --endpoint http://127.0.0.1:9230 (existing loopback inspector only)',
  '  --timeout-ms N  Per-operation timeout 100..300000, default 10000',
  '  --registry https://registry.npmjs.org  One-shot install override, never a settings edit',
  '  --depth N       Snapshot depth 1..12, default 6',
  '  --max-nodes N   Output node limit 1..2000, default 300',
  '  --help',
  '',
  'No browser/server launches, restarts, auth extraction, arbitrary evaluation,',
  'profile edits, or implicit retries. DSH pnpm installs may fetch dependencies.',
  'A timed-out mutation may STILL be running: inspect inventory before retrying.',
  'A connected Client inspector realm is required for rendered page structure.',
  'DOM.* is DSH Cordis semantic DOM, not Chromium DOM. No text/input values read.',
].join('\n');

function integer(value,name,min,max) {
  const number=Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(number) || number<min || number>max) throw new Error(name+' must be an integer between '+min+' and '+max);
  return number;
}
export function validateEndpoint(raw) {
  const url=new URL(raw);
  if(url.protocol!=='http:' || !['127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('Use an explicit loopback HTTP inspector origin without credentials/path/query');
  return url.origin;
}
export function parseArgs(argv) {
  const args=[...argv];
  const command=args[0] && !args[0].startsWith('--') ? args.shift() : 'inventory';
  if(!COMMANDS.has(command)) throw new Error('Unknown command: '+command);
  const options={command,endpoint:DEFAULT_ENDPOINT,timeoutMs:10000,depth:6,maxNodes:300,allowMutation:false};
  const seen=new Set();
  while(args.length) {
    const flag=args.shift();
    if(seen.has(flag)) throw new Error('Duplicate option: '+flag);
    seen.add(flag);
    if(flag==='--help') {options.help=true;continue;}
    if(flag==='--allow-mutation') {options.allowMutation=true;continue;}
    if(!['--endpoint','--timeout-ms','--depth','--max-nodes','--client','--package','--path','--registry'].includes(flag)) throw new Error('Unknown option: '+flag);
    const value=args.shift();
    if(!value || value.startsWith('--')) throw new Error('Missing value for '+flag);
    if(flag==='--endpoint') options.endpoint=value;
    if(flag==='--timeout-ms') options.timeoutMs=integer(value,flag,100,300000);
    if(flag==='--depth') options.depth=integer(value,flag,1,12);
    if(flag==='--max-nodes') options.maxNodes=integer(value,flag,1,2000);
    if(flag==='--client') options.client=value;
    if(flag==='--package') options.packageName=value;
    if(flag==='--path') options.packagePath=value;
    if(flag==='--registry'){if(value!=='https://registry.npmjs.org')throw new Error('This helper permits only the explicit public npm registry override');options.registry=value;}
  }
  options.endpoint=validateEndpoint(options.endpoint);
  if(options.help) return options;
  if(MUTATIONS.has(command)) {
    if(!options.allowMutation || !isAbsolute(options.packagePath??'')) throw new Error(command+' requires --allow-mutation AND --path /absolute/built/package');
    if(options.client || options.packageName) throw new Error('Mutation target must come only from the built package manifest');
  } else if(options.allowMutation || options.packagePath) throw new Error('Mutation options require an explicit install/enable verb');
  if(options.registry && command!=='install')throw new Error('--registry applies only to install');
  if(options.client && command!=='snapshot') throw new Error('--client is valid only for snapshot');
  if(options.packageName && command!=='inventory') throw new Error('--package is valid only for inventory');
  return options;
}

/** Validate trusted built artifacts BEFORE opening the inspector connection. */
export async function validateBuiltPackage(directory, io={readFile,realpath,stat}) {
  if(!isAbsolute(directory)) throw new Error('Package path must be absolute');
  const root=await io.realpath(directory);
  const manifest=JSON.parse(await io.readFile(resolve(root,'package.json'),'utf8'));
  if(typeof manifest.name!=='string' || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(manifest.name)) throw new Error('Manifest must declare a valid npm package name');
  if(manifest.dsh?.client?.platform!=='web') throw new Error('Package must declare dsh.client.platform=web');
  const exportPath=value=>typeof value==='string'?value:value?.default;
  const patch=manifest.dsh?.bundle?.patch;
  const patches=typeof patch==='string'?[patch]:patch;
  if(!Array.isArray(patches) || !patches.length) throw new Error('Package must declare dsh.bundle.patch');
  const paths=[exportPath(manifest.exports?.['.'])??manifest.main,exportPath(manifest.exports?.['./client']),...patches];
  const files=[];
  for(const path of paths) {
    if(typeof path!=='string' || !path.startsWith('./')) throw new Error('Artifacts and patches must use package-relative ./ paths');
    const file=await io.realpath(resolve(root,path));
    const local=relative(root,file);
    if(local==='..' || local.startsWith('..'+sep) || isAbsolute(local) || !(await io.stat(file)).isFile()) throw new Error('Artifact must be a regular file within the package');
    files.push(file);
  }
  const source=await io.readFile(files[1],'utf8');
  const registration=source.match(/\bid\s*:\s*(["'])(.*?)\1/s);
  if(!/__ModuleLoader__\s*\.\s*load\s*\(/.test(source) || registration?.[2]!==manifest.name) throw new Error('Built client must register its exact name through __ModuleLoader__.load');
  return {root,name:manifest.name,version:manifest.version??null,spec:'link:'+root};
}

/** Native WebSocket CDP correlation, bounded waits, and explicit local cleanup. */
export class CdpClient {
  constructor(socket,timeoutMs=10000) {
    this.socket=socket;this.timeoutMs=timeoutMs;this.nextId=0;this.pending=new Map();this.contexts=new Map();this.disposed=false;
    this.onMessage=event=>{
      try {
        if(typeof event.data!=='string' || Buffer.byteLength(event.data)>8*1024*1024) throw new Error('Invalid or oversized CDP response');
        const message=JSON.parse(event.data);
        if(message.method==='Runtime.executionContextCreated' && Number.isSafeInteger(message.params?.context?.id)) this.contexts.set(message.params.context.id,message.params.context);
        if(message.method==='Runtime.executionContextDestroyed') this.contexts.delete(message.params?.executionContextId);
        if(message.method==='Runtime.executionContextsCleared') this.contexts.clear();
        const entry=this.pending.get(message.id);
        if(!entry) return;
        this.pending.delete(message.id);clearTimeout(entry.timer);
        message.error?entry.reject(new Error('CDP '+entry.method+': '+message.error.message)):entry.resolve(message.result);
      } catch(error) {this.rejectPending(error);try{this.socket.close(1008,'invalid CDP response');}catch{}}
    };
    this.onClose=()=>this.rejectPending(new Error('Inspector connection closed'));
    this.onError=()=>this.rejectPending(new Error('Inspector WebSocket failed'));
    socket.addEventListener('message',this.onMessage);socket.addEventListener('close',this.onClose);socket.addEventListener('error',this.onError);
  }
  static async connect(url,{timeoutMs=10000,WebSocketImpl=globalThis.WebSocket}={}) {
    if(typeof WebSocketImpl!=='function') throw new Error('Native WebSocket unavailable; use Node.js 22+');
    const socket=new WebSocketImpl(url),client=new CdpClient(socket,timeoutMs);
    try {
      await new Promise((resolveOpen,rejectOpen)=>{
        const finish=error=>{clearTimeout(timer);socket.removeEventListener('open',open);socket.removeEventListener('error',fail);socket.removeEventListener('close',fail);error?rejectOpen(error):resolveOpen();};
        const open=()=>finish(),fail=()=>finish(new Error('Could not connect to existing inspector'));
        const timer=setTimeout(()=>finish(new Error('Inspector connect timeout')),timeoutMs);
        socket.addEventListener('open',open,{once:true});socket.addEventListener('error',fail,{once:true});socket.addEventListener('close',fail,{once:true});
      });
      return client;
    } catch(error) {await client.close();throw error;}
  }
  call(method,params={}) {
    if(this.disposed || this.socket.readyState!==1) return Promise.reject(new Error('Inspector connection is not open'));
    const id=++this.nextId;
    return new Promise((resolveCall,rejectCall)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);rejectCall(new Error('CDP '+method+' timed out; a requested mutation may STILL be running'));},this.timeoutMs);
      this.pending.set(id,{method,resolve:resolveCall,reject:rejectCall,timer});
      try{this.socket.send(JSON.stringify({id,method,params}));}catch(error){clearTimeout(timer);this.pending.delete(id);rejectCall(error);}
    });
  }
  rejectPending(error){for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();}
  async close() {
    if(this.disposed) return;
    this.disposed=true;this.rejectPending(new Error('Inspector client disposed'));
    if(this.socket.readyState!==3) await new Promise(done=>{
      const finish=()=>{clearTimeout(timer);this.socket.removeEventListener('close',finish);done();};
      const timer=setTimeout(finish,500);this.socket.addEventListener('close',finish,{once:true});
      try{this.socket.close(1000,'inspection complete');}catch{finish();}
    });
    this.socket.removeEventListener('message',this.onMessage);this.socket.removeEventListener('close',this.onClose);this.socket.removeEventListener('error',this.onError);
  }
}

export async function connectInspector(options,{fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket}={}) {
  const endpoint=validateEndpoint(options.endpoint);
  const response=await fetchImpl(endpoint+'/json/list',{signal:AbortSignal.timeout(options.timeoutMs),redirect:'error'});
  if(!response.ok) throw new Error('Inspector discovery HTTP '+response.status);
  const text=await response.text();if(Buffer.byteLength(text)>65536) throw new Error('Inspector discovery is oversized');
  const targets=JSON.parse(text),target=Array.isArray(targets)&&targets.find(row=>row.url==='dsh://host'&&row.type==='page');
  if(!target) throw new Error('Endpoint is not the supported DSH synthetic Host inspector');
  const ws=new URL(target.webSocketDebuggerUrl),origin=new URL(endpoint);
  if(ws.protocol!=='ws:' || ws.host!==origin.host || ws.username || ws.password || ws.search || ws.hash || !/^\/devtools\/page\/[^/]+$/.test(ws.pathname)) throw new Error('Inspector advertised a nonlocal or unexpected WebSocket target');
  if(options.client) ws.searchParams.set('clientSourceId',options.client);
  return CdpClient.connect(ws.href,{timeoutMs:options.timeoutMs,WebSocketImpl});
}
function runtimeValue(completion) {
  if(completion.exceptionDetails) throw new Error('Inspector evaluation failed: '+(completion.exceptionDetails.text??'exception'));
  if(!completion.result || !Object.hasOwn(completion.result,'value')) throw new Error('Inspector returned no by-value metadata');
  return completion.result.value;
}
export async function callHost(client,declaration,args=[]) {
  const group='dsh-kanban-inspect-'+randomUUID();
  try {
    const {root}=await client.call('DOM.getDocument',{depth:2});
    const context=root.children?.find(node=>node.localName==='host')?.children?.find(node=>node.localName==='context');
    if(!context) throw new Error('No live Host Cordis context is published');
    const {object}=await client.call('DOM.resolveNode',{nodeId:context.nodeId,objectGroup:group});
    if(!object?.objectId) throw new Error('Host semantic node has no live Runtime object');
    return runtimeValue(await client.call('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:declaration,arguments:args.map(value=>({value})),returnByValue:true,awaitPromise:true}));
  } finally {await client.call('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});}
}

// Fixed source functions + by-value CDP arguments. Never interpolate user input into code.
const INVENTORY=async function(filter) {
  const ctx=this.root??this,manager=ctx.get('pluginManager');
  if(!manager) throw new Error('Public pluginManager service unavailable');
  return {managementAvailable:true,hmrAvailable:!!ctx.get('hmr'),
    hasLiveOwnerClient:ctx.get('typertGateway')?.hasLiveClient()??null,
    clientInspectorAdvertised:ctx.get('clientModules')?.graph()?.entries?.some(row=>row.id==='@deepseek-ai/dsh-experimental-inspector')??false,
    plugins:(await manager.listPlugins()).filter(p=>!filter||p.moduleName===filter).map(({entryId,moduleName,enabled,fiberPhase,readOnlyReason})=>({entryId,moduleName,enabled,fiberPhase,readOnlyReason})),
    bundles:(await manager.listBundles()).filter(p=>!filter||p.name===filter).map(({name,version,enabled,installed,availability,removable,error,rows})=>({name,version,enabled,installed,availability,removable,errorCode:error?.code,rows:rows.map(({rowId,moduleName,entryId})=>({rowId,moduleName,entryId}))}))};
};
const MUTATE=async function(command,target,requestId) {
  const manager=(this.root??this).get('pluginManager');
  if(!manager) throw new Error('Public pluginManager service unavailable');
  const change=command==='install'?await manager.installBundle(target.spec,{enabled:false,requestId,...(target.registry?{registry:target.registry}:{})}):await manager.setBundleEnabled(target.name,command==='enable');
  const raw=JSON.stringify(change.packageResult??{});
  const diagnosticCodes=['ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ERR_PNPM_META_FETCH_FAIL','ERR_PNPM_FETCH_401','ERR_PNPM_FETCH_403','ERR_PNPM_FETCH_404','ERR_PNPM_UNSUPPORTED_ENGINE','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].filter(code=>raw.includes(code));
  const registryHosts=['registry.npmjs.org','registry.npmmirror.com'].filter(host=>raw.includes(host));
  return {requestId,name:target.name,changed:change.changed,application:change.application,restartReason:change.restartReason,stage:change.stage,bundle:change.bundle,enabled:change.enabled,errorCode:change.error?.code,warningCount:change.warnings?.length??0,pendingBuilds:change.pendingBuilds,
    packageResult:change.packageResult&&{exitCode:change.packageResult.exitCode,kind:change.packageResult.kind,timedOut:change.packageResult.timedOut,...(diagnosticCodes.length?{diagnosticCodes}:{}),...(registryHosts.length?{registryHosts}:{})}};
};
const PAGE_SNAPSHOT=function(depth,maxNodes) {
  let count=0,truncated=false;
  const walk=(element,level)=>{
    if(!element||count>=maxNodes){truncated=true;return null;}count++;
    const node={tag:element.tagName.toLowerCase()};
    for(const key of ['role','data-testid','data-plugin-row']) {const value=element.getAttribute(key);if(value!==null)node[key]=value.slice(0,160);}
    if(level<depth){node.children=[];for(const child of element.children){if(count>=maxNodes){truncated=true;break;}const next=walk(child,level+1);if(next)node.children.push(next);}}
    else if(element.children.length)truncated=true;
    return node;
  };
  return {readyState:document.readyState,root:walk(document.body,0),returnedNodes:count,truncated,note:'Structure only: no text, values, URLs, cookies, storage, or arbitrary attributes'};
};
export function projectSources(sources,contexts) {
  return sources.map(({sourceId,kind,label,capabilities})=>{
    const context=contexts.find(row=>row.auxData?.sourceId===sourceId||(kind==='host'&&row.auxData?.isDefault===true));
    return {sourceId,kind,label,capabilities,contextId:context?.id??null,runtimeAvailable:!!context};
  });
}
export function projectSemanticTree(root,maxNodes=300) {
  let count=0,truncated=false;
  const visit=node=>{
    count++;const attributes={};
    for(let i=0;i<(node.attributes?.length??0);i+=2)if(['uid','disconnected'].includes(node.attributes[i]))attributes[node.attributes[i]]=node.attributes[i+1];
    const children=[];
    for(const child of node.children??[]){if(count>=maxNodes){truncated=true;break;}children.push(visit(child));}
    if((node.childNodeCount??children.length)>children.length)truncated=true;
    return {kind:node.localName||node.nodeName,attributes,childCount:node.childNodeCount??children.length,children};
  };
  return {root:visit(root),returnedNodes:count,truncated,note:'Cordis semantic projection, NOT rendered browser DOM'};
}
export async function runCommand(options,dependencies={}) {
  // Recheck authorization when used as a module, before discovery/any inspector command.
  if(MUTATIONS.has(options.command)&&(!options.allowMutation||!isAbsolute(options.packagePath??''))) throw new Error('Mutation requires explicit confirmation and an absolute built package path');
  const target=MUTATIONS.has(options.command)?await(dependencies.validatePackage??validateBuiltPackage)(options.packagePath):null;
  const client=await(dependencies.connect??connectInspector)(options);
  try {
    await client.call('Runtime.enable');
    if(options.command==='inventory')return await callHost(client,INVENTORY.toString(),[options.packageName??null]);
    if(MUTATIONS.has(options.command)) {
      const requestId=randomUUID();
      try{return await callHost(client,MUTATE.toString(),[options.command,options.registry?{...target,registry:options.registry}:target,requestId]);}
      catch(error){throw new Error('Mutation '+options.command+' requestId='+requestId+' did not return; it may still be running. Do not retry before checking inventory. '+(error instanceof Error?error.message:String(error)));}
    }
    const {sources}=await client.call('DSHInspector.getSources');
    const descriptions=projectSources(sources,[...client.contexts.values()]);
    if(options.command==='clients')return {sources:descriptions,clients:descriptions.filter(source=>source.kind==='client')};
    const clients=descriptions.filter(source=>source.kind==='client'&&source.runtimeAvailable);
    if(options.client&&!clients.some(source=>source.sourceId===options.client))throw new Error('Selected Client is not connected to inspector');
    if(clients.length>1&&!options.client)throw new Error('Multiple Clients connected; choose snapshot --client SOURCE_ID');
    const {root}=await client.call('DOM.getDocument',{depth:options.depth});
    const semantic=projectSemanticTree(root,options.maxNodes),selected=options.client?clients.find(source=>source.sourceId===options.client):clients[0];
    if(!selected)return {clients,semantic,page:null,limitation:'No connected Client inspector realm; cannot verify rendered GUI/page DOM'};
    const page=runtimeValue(await client.call('Runtime.callFunctionOn',{functionDeclaration:PAGE_SNAPSHOT.toString(),executionContextId:selected.contextId,arguments:[{value:options.depth},{value:options.maxNodes}],returnByValue:true,awaitPromise:false}));
    return {client:selected,semantic,page};
  } finally {await client.close();}
}
export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);
  if(options.help)return {output:HELP,exitCode:0,text:true};
  const output=await runCommand(options);
  return {output,exitCode:output.application==='restart-required'?3:output.application&&output.application!=='applied'?2:0,text:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result=await main();
    // Native WebSocket has no terminate(); process exit also bounds an uncooperative local close handshake.
    process.stdout.write((result.text?result.output:JSON.stringify(result.output,null,2))+'\n',()=>process.exit(result.exitCode));
  } catch(error) {process.stderr.write('dsh-inspect: '+(error instanceof Error?error.message:String(error))+'\n',()=>process.exit(1));}
}
