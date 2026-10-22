/** Isolated VM Inspector models only; never native gate evidence or a live connection. */
import {describe,expect,it} from 'vitest';
import {createContext,runInContext,type Context} from 'node:vm';
// @ts-expect-error Source-only bridge module has no generated declaration file.
import {createCoordinationLifecycleBridge,hostObjectReference,BRIDGE_CONTRACT} from '../../scripts/coordination-lifecycle-bridge.mjs';

const secret='https://127.0.0.1:51781/?token=PRIVATE_SYNTHETIC_BRIDGE_TOKEN_123456';
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}
/** This entire model is created INSIDE the isolated Host realm. */
function makeRealmRoot(){
  const nonce='abcdef123456',run='/workspace/.verification/native-fixtures/g3/run-'+nonce,base=run+'/monorepo/apps/api',owner='session-12345678-1234-1234-1234-123456789abc';
  const spec={id:'kanban-uat-coordination-owned-1',owner,kind:'kanban-uat-coordination',label:'Owned native producer',rootCallId:'g3-root-'+nonce};
  const config={transactionId:'g3-lifecycle-'+nonce,bundleName:'dsh-kanban',allowOwnerTest:true,allowFixtureData:true,allowNativeJobProducer:true,allowPluginLifecycle:true,exclusiveOperatorWindow:true,fixture:{nonce,run,base},ownedTaskIds:['owned-task'],ownedSessionIds:[owner],jobs:[spec]};
  const copy=(value:unknown)=>JSON.parse(JSON.stringify(value));
  const defer=()=>{let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return{promise,resolve};};
  const holds=new Map<string,ReturnType<typeof defer>>(),signals=new Map<string,ReturnType<typeof defer>>();
  const signal=(key:string)=>{if(!signals.has(key))signals.set(key,defer());return signals.get(key)!;};
  const wait=async(key:string)=>{signal(key).resolve();if(holds.has(key))await holds.get(key)!.promise;};
  const trace:string[]=[],history:any[]=[{type:'job/registered',data:{jobId:spec.id,owner,kind:spec.kind,label:spec.label,startedAt:1,toolCall:{callId:spec.rootCallId,rootCallId:spec.rootCallId}}}];
  const job:any={...spec,startedAt:1,status:'running',output:{total:0,earliest:0}},waiters:Array<(value:any)=>void>=[],listeners=new Set<(event:any)=>void>();
  const actor={id:owner,session:{id:owner},current:base,guardAlive:true};let read=false,resourcesSettled=false,enabled=true,listCount=0,facadeEpoch=0,controllerDisposals=0;
  const hooks={onApplication:'applied',offApplication:'applied',migrateOnRestore:true,proofNotReady:false};
  const task:any={id:'owned-task',projectId:'project',title:'Owned VM fixture',description:'Memory only',columnId:'backlog',position:0,sessionIds:[owner],closedSessionIds:[],effectiveCwd:base,worktree:null,operation:{id:'waiting-op',request:{kind:'create',mode:'new',path:run+'/journal-tree',branchName:'owned',sourceBranch:'main'},phase:'waiting',targetPath:run+'/journal-tree',previousDirectories:{},switchedSessionIds:[],archivedSessionIds:[],gitCompleted:false,createdAt:'2026-10-22T00:00:00.000Z'},archivedAt:null,createdAt:'2026-10-22T00:00:00.000Z',updatedAt:'2026-10-22T00:00:00.000Z'};
  const snapshot=()=>({ok:true,value:{state:{schemaVersion:1,revision:0,projects:[{id:'project',name:'Owned VM fixture',projectPath:base,gitRootPath:run+'/monorepo'}],tasks:[task],notes:[]},attention:{},sequence:0}});
  function facade(){const epoch=++facadeEpoch;return{
    async snapshot(){if(!enabled)throw new Error('APP_RPC_WHILE_OFF');trace.push('snapshot-'+epoch);await wait('snapshot');return copy(snapshot());},
    async command(request:any){if(!enabled)throw new Error('APP_RPC_WHILE_OFF');trace.push('command-'+epoch);await wait('command');if(request.type==='operation.return'){actor.current=base;task.effectiveCwd=base;task.operation=null;history.push({type:'working-directory/change',data:{cwd:base}});}if(request.type==='task.edit')task.title=request.title;return copy(snapshot());}
  };}
  let currentFacade:any=facade();
  const jobs={get(id:string,caller:string){if(id!==spec.id||caller!==owner)throw new Error('Unknown owner');return Object.freeze(copy(job));},list(caller:string){return caller===owner?[Object.freeze(copy(job))]:[];},wait(id:string,_ms:number,caller:string){const value=this.get(id,caller);if(value.status!=='running')return Promise.resolve(value);return new Promise<any>(resolve=>{waiters.push(resolve);});},read(id:string,caller:string){this.get(id,caller);read=true;return{job:copy(job),chunks:[]};},events:{subscribe(_filter:unknown,listener:(event:any)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}}};
  const sessions={async inspect(id:string){if(id!==owner)throw new Error('Unknown native actor');return{meta:{cwd:base},events:copy(history)};}};
  const wd={get(session:{id:string}){if(session.id!==owner)throw new Error('Unknown native actor');return actor.current;}};
  const fs={async resolve(value:string){return value;},processPath(value:string){return value;},contains(parent:string,child:string){return child.startsWith(parent+'/');},async stat(){return{type:'directory'};}};
  const manager={async listBundles(){listCount++;if(listCount===2)await wait('final-list');return[{name:'dsh-kanban',enabled}];},async setBundleEnabled(name:string,on:boolean){if(name!=='dsh-kanban')throw new Error('Wrong bundle');trace.push(on?'on-enter':'off-enter');await wait(on?'on':'off');enabled=on;currentFacade=on?facade():undefined;trace.push(on?'on-commit':'off-commit');if(on&&hooks.migrateOnRestore&&job.status==='completed'){actor.current=run+'/journal-tree/apps/api';task.effectiveCwd=actor.current;task.operation=null;history.push({type:'working-directory/change',data:{cwd:actor.current}});}return{stage:'enable',target:name,enabled:on,changed:true,application:on?hooks.onApplication:hooks.offApplication};}};
  const services:any={pluginManager:manager,jobs,fs,sessionController:sessions,workingDirectory:wd,agents:{get(id:string){return id===owner?actor:undefined;}}};
  const coreServiceReads:string[]=[];
  const root:any={get(name:string){if(name!=='kanbanController')coreServiceReads.push(name);return name==='kanbanController'?currentFacade:services[name];}};root.root=root;
  const makeController=(wrongRoot=false)=>{
    const baseline=copy(history),knownActor=actor;
    const controller:any={
      async assertRetained(){if(this!==controller)throw new Error('Controller receiver lost');if(root.get('agents').get(owner)!==knownActor||!knownActor.guardAlive)throw new Error('Independent native guard lost');},
      async settleOwnedWhileOff(permit:any){if(this!==controller)throw new Error('Controller receiver lost');if(enabled||JSON.stringify(permit.jobIds)!==JSON.stringify([spec.id]))throw new Error('Wrong settlement permit');trace.push('work-enter');await wait('work');job.status='completed';resourcesSettled=true;trace.push('native-completed');const queued=waiters.splice(0);for(const resolve of queued)resolve(copy(job));for(const listener of listeners)listener({type:'settled',job:copy(job),awaited:queued.length>0});await jobs.wait(spec.id,120000,owner);jobs.read(spec.id,owner);},
      async assertDisposalReady(permit:any){if(this!==controller)throw new Error('Controller receiver lost');trace.push('disposal-proof');if(root.get('agents').get(owner)!==knownActor)throw new Error('Native actor identity changed');if(hooks.proofNotReady||!enabled||!resourcesSettled||!read||permit.base!==base||JSON.stringify(permit.ownerIds)!==JSON.stringify([owner])||JSON.stringify(permit.jobIds)!==JSON.stringify([spec.id])||!['completed','failed','killed'].includes(root.get('jobs').get(spec.id,owner).status)||root.get('workingDirectory').get(knownActor.session)!==base)throw new Error('Native resources or canonical base not ready');const current=await root.get('sessionController').inspect(owner);if(!baseline.every((event:any,index:number)=>JSON.stringify(event)===JSON.stringify(current.events[index])))throw new Error('Native history prefix changed');},
      dispose(){controllerDisposals++;knownActor.guardAlive=false;}
    };
    controller[Symbol.for('dsh-kanban.uat.independent-controller.v1')]={contract:'independent-native-controller-v1',root:wrongRoot?{get(){}}:root};return controller;
  };
  return{root,makeController,config,trace,hooks,coreServiceReads,invalidateRead(){read=false;},damagePrefix(){history[0].data.label='changed-prefix';},hold(key:string){holds.set(key,defer());},release(key:string){holds.get(key)?.resolve();},signal:(key:string)=>signal(key).promise,state(){return{enabled,actorCurrent:actor.current,read,resourcesSettled,controllerDisposals,guardAlive:actor.guardAlive};}};
}
class FakeSocket extends EventTarget{readyState=1;lose(){this.readyState=3;this.dispatchEvent(new Event('close'));}}
type Remote={value:any;group:string};
class FakeInspector{
  socket=new FakeSocket();disposed=false;realm:Context;fixture:ReturnType<typeof makeRealmRoot>;objects=new Map<string,Remote>();serial=0;calls:Array<{method:string;params:any}>=[];running=new Set<Promise<any>>();
  deadlines:Array<(method:string,params:any)=>boolean>=[];corrupt?: (method:string,params:any,result:any)=>any;
  constructor(){this.realm=createContext({});this.fixture=runInContext('('+makeRealmRoot.toString()+')()',this.realm);}
  retain(value:any,group:string){const objectId='host-object-'+(++this.serial);this.objects.set(objectId,{value,group});return{type:'object',objectId};}
  controller(group:string,wrongRoot=false){return hostObjectReference(this,group,this.retain(this.fixture.makeController(wrongRoot),group));}
  async call(method:string,params:any={}){
    if(this.socket.readyState!==1)throw new Error('Inspector connection closed '+secret);this.calls.push({method,params});
    const server=this.execute(method,params);this.running.add(server);server.then(()=>this.running.delete(server),()=>this.running.delete(server));
    const rule=this.deadlines.findIndex(test=>test(method,params));
    return new Promise<any>((resolve,reject)=>{
      const close=()=>reject(new Error('Inspector connection closed '+secret));this.socket.addEventListener('close',close,{once:true});
      server.then(value=>{this.socket.removeEventListener('close',close);resolve(this.corrupt?this.corrupt(method,params,value):value);},error=>{this.socket.removeEventListener('close',close);reject(error);});
      if(rule>=0){this.deadlines.splice(rule,1);this.socket.removeEventListener('close',close);const error=Object.assign(new Error('Client deadline '+secret),{code:'INSPECTOR_CLIENT_DEADLINE'});reject(error);}
    });
  }
  async execute(method:string,params:any){
    if(method==='DOM.getDocument')return{root:{children:[{localName:'host',children:[{localName:'context',nodeId:1}]}]}};
    if(method==='DOM.resolveNode')return{object:this.retain(this.fixture.root,params.objectGroup)};
    if(method==='Runtime.releaseObjectGroup'){for(const[id,row]of this.objects)if(row.group===params.objectGroup)this.objects.delete(id);return{};}
    if(method!=='Runtime.callFunctionOn')throw new Error('Unsupported protocol');
    try{
      const target=this.objects.get(params.objectId)?.value;if(!target)throw new Error('Unknown remote object');
      const fn=runInContext('('+params.functionDeclaration+')',this.realm);
      const args=(params.arguments??[]).map((arg:any)=>{if(Object.hasOwn(arg,'objectId')){const row=this.objects.get(arg.objectId);if(!row)throw new Error('Unknown reference');return row.value;}return runInContext('JSON.parse('+JSON.stringify(JSON.stringify(arg.value))+')',this.realm);});
      let value=fn.apply(target,args);if(params.awaitPromise)value=await value;
      if(params.returnByValue)return{result:value===undefined?{type:'undefined'}:{type:typeof value,value:JSON.parse(JSON.stringify(value))}};
      return{result:this.retain(value,params.objectGroup)};
    }catch{return{exceptionDetails:{text:secret}};}
  }
  isTransaction(params:any){return typeof this.objects.get(params.objectId)?.value?.start==='function';}
  isGate(params:any){return typeof this.objects.get(params.objectId)?.value?.begin==='function';}
}
function setup(){const host=new FakeInspector(),group='bridge-owned-group';const bridge=createCoordinationLifecycleBridge({connection:host,objectGroup:group,allowOwnerTest:true,allowFixtureData:true});return{host,group,bridge};}
async function installed(){const f=setup();await f.bridge.prepare();await f.bridge.bindIndependentController(f.host.controller(f.group));await f.bridge.install(JSON.parse(JSON.stringify(f.host.fixture.config)));return f;}
async function runRestored(){const f=await installed();await f.bridge.start();const result=await f.bridge.result();return{...f,result};}
async function cleanupAtBase(f:Awaited<ReturnType<typeof installed>>){const reply=await f.bridge.invoke('command','cleanup-base',{type:'operation.return',taskId:'owned-task'});await f.bridge.ack(reply);}
const method=(params:any)=>params.arguments?.[0]?.value;

describe('same-Host opaque lifecycle bridge, fake Inspector only',()=>{
  it('is inert until prepare and executes actual frozen serialized factories in the Host realm',async()=>{
    const f=setup();expect(f.host.calls).toEqual([]);await f.bridge.prepare();expect(f.host.calls.every(call=>['DOM.getDocument','DOM.resolveNode','Runtime.callFunctionOn'].includes(call.method))).toBe(true);expect(runInContext('typeof createRunnerKanbanGate+":"+typeof installNativeLifecycleTransaction',f.host.realm)).toBe('undefined:undefined');
    const snapshot=await f.bridge.invoke('snapshot','first-snapshot');expect(snapshot.value.ok).toBe(true);await expect(f.bridge.ack(JSON.parse(JSON.stringify(snapshot)))).rejects.toThrow('APP_RECEIPT_SCOPE_MISMATCH');await f.bridge.ack(snapshot);
    expect(f.host.fixture.trace).toContain('snapshot-1');expect(f.bridge.state().pendingCallReceipts).toBe(0);
  });
  it('passes actual gate/controller/outside references and retains all objects in one group',async()=>{
    const f=await installed();const declarations=f.host.calls.filter(call=>call.method==='Runtime.callFunctionOn');const outside=declarations.find(call=>call.params.functionDeclaration.includes('function buildOutside'))!;expect(outside.params.arguments.every((arg:any)=>typeof arg.objectId==='string'&&!Object.hasOwn(arg,'value'))).toBe(true);
    const transaction=declarations.find(call=>call.params.functionDeclaration.includes('function installNativeLifecycleTransaction'))!;expect(transaction.params.arguments[1]).toHaveProperty('objectId');expect([...f.host.objects.values()].every(row=>row.group===f.group)).toBe(true);expect(f.host.fixture.trace).toEqual([]);
  });
  it('does not confuse a client deadline with actual server completion of an app call',async()=>{
    const f=setup();await f.bridge.prepare();f.host.fixture.hold('command');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&f.host.isGate(params)&&method(params)==='result');
    await expect(f.bridge.invoke('command','held-edit',{type:'task.edit',taskId:'owned-task',title:'Exact owned update'})).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');await f.host.fixture.signal('command');
    expect(f.bridge.state().pendingCallReceipts).toBe(1);await expect(f.bridge.invoke('snapshot','unsafe-new')).rejects.toThrow('APP_ADMISSION_CLOSED');f.host.fixture.release('command');const recovered=await f.bridge.recoverCall('held-edit');expect(recovered.value.value.state.tasks[0].title).toBe('Exact owned update');await f.bridge.ack(recovered);expect(f.bridge.state().pendingCallReceipts).toBe(0);
  });
  it('recovers an ACK deadline from the same cached server receipt without replaying the app command',async()=>{
    const f=setup();await f.bridge.prepare();const receipt=await f.bridge.invoke('snapshot','ack-timeout');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&method(params)==='acknowledge');await expect(f.bridge.ack(receipt)).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');
    const recovered=await f.bridge.recoverCall('ack-timeout');expect(recovered.delivery).toBe(receipt.delivery);await f.bridge.ack(recovered);expect(f.host.fixture.trace.filter(value=>value.startsWith('snapshot-'))).toHaveLength(1);
  });
  it('keeps delayed OFF prelude and finally ON on the same server promise after client timeout',async()=>{
    const f=await installed();f.host.fixture.hold('final-list');await f.bridge.start();await f.host.fixture.signal('final-list');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&f.host.isTransaction(params)&&method(params)==='result');
    await expect(f.bridge.result()).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');expect(f.host.fixture.trace).not.toContain('on-enter');await expect(f.bridge.invoke('snapshot','while-pending')).rejects.toThrow('APP_ADMISSION_CLOSED');expect((f.bridge as any).restore).toBeUndefined();
    f.host.fixture.release('final-list');const result=await f.bridge.result();expect(result.ok).toBe(true);expect(f.host.fixture.trace.filter(value=>value.endsWith('-commit'))).toEqual(['off-commit','on-commit']);expect(result.nativeJournalGate).toBe('not-verified');
  });
  it('refuses every app call and cleanup/disposal while OFF but permits public presence-get only',async()=>{
    const f=await installed();f.host.fixture.hold('work');await f.bridge.start();await f.host.fixture.signal('work');expect((await f.bridge.presence()).present).toBe(false);
    for(const kind of ['snapshot','command'])await expect(f.bridge.invoke(kind,'blocked-'+kind,{type:'operation.return',taskId:'owned-task'})).rejects.toThrow('APP_ADMISSION_CLOSED');await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_NOT_SAFE');
    expect(f.host.fixture.trace.filter(value=>value.startsWith('command-'))).toEqual([]);f.host.fixture.release('work');await f.bridge.result();
  });
  it('requires actual independent public base/read/prefix disposal proof after restored terminal status',async()=>{
    const f=await runRestored();expect(f.result.ok).toBe(true);expect(f.host.fixture.state().actorCurrent).not.toBe(f.host.fixture.config.fixture.base);await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_PUBLIC_PROOF_NOT_READY');expect(f.host.objects.size).toBeGreaterThan(0);
    await cleanupAtBase(f);const disposed=await f.bridge.dispose();expect(disposed).toEqual({disposed:true,connectionClosedByBridge:false,independentControllerDisposedByBridge:false});expect(f.host.socket.readyState).toBe(1);expect(f.host.objects.size).toBe(0);expect(f.host.fixture.state().controllerDisposals).toBe(0);expect(f.host.fixture.state().guardAlive).toBe(true);expect((await f.bridge.status()).state).toBe('disposed');
  });
  it('does not allow final disposal with an unacknowledged post-ON cleanup receipt',async()=>{
    const f=await runRestored();const cleanup=await f.bridge.invoke('command','unacked-cleanup',{type:'operation.return',taskId:'owned-task'});await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_NOT_SAFE');await f.bridge.ack(cleanup);await f.bridge.dispose();
  });
  it('preserves metadata cancellation without aborting actual work or disposing native guards',async()=>{
    const f=await installed();f.host.fixture.hold('work');await f.bridge.start();await f.host.fixture.signal('work');await f.bridge.requestCancel();expect(f.host.fixture.trace).not.toContain('on-enter');f.host.fixture.release('work');const result=await f.bridge.result();expect(result.errors).toContain('LIFECYCLE_CANCELLED');expect(f.host.fixture.trace.indexOf('native-completed')).toBeLessThan(f.host.fixture.trace.indexOf('on-enter'));expect(f.host.fixture.state().guardAlive).toBe(true);await cleanupAtBase(f);await f.bridge.dispose();
  });
  it('keeps admission closed for unknown ON and never retries restore or disposes',async()=>{
    const f=await installed();f.host.fixture.hooks.onApplication='unknown';await f.bridge.start();const result=await f.bridge.result();expect(result.operational.restorationConfirmed).toBe(false);await expect(f.bridge.invoke('snapshot','unknown-on')).rejects.toThrow('APP_ADMISSION_CLOSED');await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_NOT_SAFE');expect(f.host.fixture.trace.filter(value=>value==='on-enter')).toHaveLength(1);expect(f.host.fixture.state().guardAlive).toBe(true);
  });
  it('is permanently UNVERIFIED after connection loss, while the original server finally continues',async()=>{
    const f=await installed();f.host.fixture.hold('work');await f.bridge.start();await f.host.fixture.signal('work');const result=f.bridge.result();f.host.socket.lose();await expect(result).rejects.toThrow('BRIDGE_UNVERIFIED');const count=f.host.calls.length;
    expect((await f.bridge.status()).state).toBe('UNVERIFIED');await expect(f.bridge.invoke('snapshot','after-loss')).rejects.toThrow('BRIDGE_UNVERIFIED');await expect(f.bridge.requestCancel()).rejects.toThrow('BRIDGE_UNVERIFIED');await expect(f.bridge.dispose()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(count);expect((f.bridge as any).reconnect).toBeUndefined();
    f.host.fixture.release('work');await f.host.fixture.signal('on');await Promise.all([...f.host.running]);expect(f.host.fixture.trace.filter(value=>value.endsWith('-commit'))).toEqual(['off-commit','on-commit']);expect(f.host.fixture.state().guardAlive).toBe(true);expect(JSON.stringify(f.bridge.state())).not.toContain('PRIVATE_SYNTHETIC');
  });
  it('releasing client object references cannot abort the original server OFF/work/finally continuation',async()=>{
    const f=await installed();f.host.fixture.hold('work');await f.bridge.start();await f.host.fixture.signal('work');await f.host.call('Runtime.releaseObjectGroup',{objectGroup:f.group});await expect(f.bridge.status()).rejects.toThrow('BRIDGE_UNVERIFIED');
    f.host.fixture.release('work');await f.host.fixture.signal('on');await Promise.all([...f.host.running]);expect(f.host.fixture.trace.filter(value=>value.endsWith('-commit'))).toEqual(['off-commit','on-commit']);expect(f.host.fixture.state().guardAlive).toBe(true);expect(f.bridge.state().admissionState).toBe('unknown');
  });
  it('rejects wrong-connection/group and Node by-value controller injection',async()=>{
    const f=setup();await f.bridge.prepare();const other=new FakeInspector();await expect(f.bridge.bindIndependentController(other.controller(f.group))).rejects.toThrow('HOST_REFERENCE_SCOPE_MISMATCH');await expect(f.bridge.bindIndependentController(f.host.controller('wrong-group'))).rejects.toThrow('HOST_REFERENCE_SCOPE_MISMATCH');await expect(f.bridge.bindIndependentController({assertRetained(){},settleOwnedWhileOff(){}})).rejects.toThrow('HOST_REFERENCE_SCOPE_MISMATCH');
  });
  it('rejects a by-reference controller branded to another root in the same realm',async()=>{
    const f=setup();await f.bridge.prepare();await expect(f.bridge.bindIndependentController(f.host.controller(f.group,true))).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.fixture.trace).toEqual([]);expect(f.host.fixture.state().guardAlive).toBe(true);
  });
  it('rejects a Node object masquerading as a Host objectId instead of evaluating its callbacks',async()=>{
    const f=setup();await f.bridge.prepare();const fake=hostObjectReference(f.host,f.group,{type:'object',objectId:'not-a-host-reference'});await expect(f.bridge.bindIndependentController(fake)).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.fixture.trace).toEqual([]);
  });
  it('rejects unsupported controller interface before installing the transaction',async()=>{
    const f=setup();await f.bridge.prepare();const value=f.host.fixture.makeController();delete value.assertDisposalReady;await expect(f.bridge.bindIndependentController(hostObjectReference(f.host,f.group,f.host.retain(value,f.group)))).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls.some(call=>call.params?.functionDeclaration?.includes('function installNativeLifecycleTransaction'))).toBe(false);
  });
  it('acquires a real opaque gate lease, refuses calls, then resumes only after server release',async()=>{
    const f=setup();await f.bridge.prepare();const lease=await f.bridge.acquireLease('manual-quiescence');expect((await f.bridge.leaseStatus(lease)).admissionsPaused).toBe(true);await expect(f.bridge.invoke('snapshot','leased')).rejects.toThrow('APP_ADMISSION_CLOSED');await expect(f.bridge.releaseLease(JSON.parse(JSON.stringify(lease)))).rejects.toThrow('LEASE_SCOPE_MISMATCH');await f.bridge.releaseLease(lease);const result=await f.bridge.invoke('snapshot','after-lease');await f.bridge.ack(result);
  });
  it('fails closed for unknown protocol/extra private fields without leaking raw payloads',async()=>{
    const f=await installed();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&f.host.isTransaction(params)&&method(params)==='start'?{result:{type:'object',value:{...value.result.value,rawError:secret}}}:value;
    await expect(f.bridge.start()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(JSON.stringify(f.bridge.state())).not.toContain('PRIVATE_SYNTHETIC');await expect(f.bridge.invoke('snapshot','after-corruption')).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.fixture.state().controllerDisposals).toBe(0);
  });

  it('rejects callback/gate injection and missing explicit preparation authorization before transport',()=>{
    const host=new FakeInspector();expect(()=>createCoordinationLifecycleBridge({connection:host,objectGroup:'owned',allowOwnerTest:true,allowFixtureData:false})).toThrow('BRIDGE_NOT_AUTHORIZED');expect(()=>createCoordinationLifecycleBridge({connection:host,objectGroup:'owned',allowOwnerTest:true,allowFixtureData:true,gate:{}})).toThrow('BRIDGE_ARGUMENT_INVALID');expect(host.calls).toEqual([]);
  });
  it('keeps outcome ACKs mandatory before lifecycle installation/start',async()=>{
    const f=setup();await f.bridge.prepare();await f.bridge.bindIndependentController(f.host.controller(f.group));const value=await f.bridge.invoke('snapshot','not-acked');await expect(f.bridge.install(JSON.parse(JSON.stringify(f.host.fixture.config)))).rejects.toThrow('TRANSACTION_NOT_INSTALLABLE');await f.bridge.ack(value);await f.bridge.install(JSON.parse(JSON.stringify(f.host.fixture.config)));
    const second=await f.bridge.invoke('snapshot','still-not-acked');await expect(f.bridge.start()).rejects.toThrow('TRANSACTION_NOT_STARTABLE');await f.bridge.ack(second);await f.bridge.start();await f.bridge.result();
  });
  it('the actual frozen server gate refuses app admission OFF, not only the Node guard',async()=>{
    const f=await installed();f.host.fixture.hold('work');await f.bridge.start();await f.host.fixture.signal('work');const gate=[...f.host.objects.entries()].find(([,row])=>typeof row.value.begin==='function')![0];const response=await f.host.call('Runtime.callFunctionOn',{objectId:gate,objectGroup:f.group,functionDeclaration:"function(){return this.begin('snapshot','raw-bypass',{});}",arguments:[],returnByValue:true,awaitPromise:true});expect(response.exceptionDetails).toBeTruthy();expect(f.host.fixture.trace.filter(value=>value.startsWith('snapshot-'))).toHaveLength(1);f.host.fixture.release('work');await f.bridge.result();
  });
  it('never cleans up through an unconfirmed no-OFF cancellation outcome',async()=>{
    const f=await installed();f.host.fixture.hold('final-list');await f.bridge.start();await f.host.fixture.signal('final-list');await f.bridge.requestCancel();f.host.fixture.release('final-list');const result=await f.bridge.result();expect(result.operational.offAttempted).toBe(false);expect(f.host.fixture.trace.filter(value=>value.endsWith('-commit'))).toEqual([]);await expect(f.bridge.invoke('snapshot','not-restored-proof')).rejects.toThrow('APP_ADMISSION_CLOSED');await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_NOT_SAFE');expect(f.host.fixture.state().guardAlive).toBe(true);
  });
  it('does not allow foreign or new creation mutations as post-ON cleanup',async()=>{
    const f=await runRestored();const before=f.host.calls.length;await expect(f.bridge.invoke('command','foreign-cleanup',{type:'operation.return',taskId:'foreign-task'})).rejects.toThrow('POST_ON_OWN_CLEANUP_REQUIRED');await expect(f.bridge.invoke('command','new-after-on',{type:'task.create',projectId:'project',title:'New'})).rejects.toThrow('POST_ON_OWN_CLEANUP_REQUIRED');await expect(f.bridge.invoke('command','foreign-path',{type:'task.delete',taskId:'owned-task',confirmed:true,expectedWorktreePath:'/foreign'})).rejects.toThrow('OWN_CLEANUP_TARGET_UNVERIFIED');expect(f.host.calls).toHaveLength(before);
  });
  it('retains group/guards if actual public job-read evidence is missing',async()=>{
    const f=await runRestored();await cleanupAtBase(f);f.host.fixture.invalidateRead();await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_PUBLIC_PROOF_NOT_READY');expect(f.host.objects.size).toBeGreaterThan(0);expect(f.host.fixture.state().guardAlive).toBe(true);expect(f.host.fixture.state().controllerDisposals).toBe(0);
  });
  it('retains group/guards if the actual native history prefix no longer matches',async()=>{
    const f=await runRestored();await cleanupAtBase(f);f.host.fixture.damagePrefix();await expect(f.bridge.dispose()).rejects.toThrow('DISPOSE_PUBLIC_PROOF_NOT_READY');expect(f.host.objects.size).toBeGreaterThan(0);expect(f.host.fixture.state().guardAlive).toBe(true);
  });
  it('lets the external owner tear down its controller only after safety, without the bridge doing it',async()=>{
    const f=await runRestored();await cleanupAtBase(f);const controller=[...f.host.objects.entries()].find(([,row])=>typeof row.value.assertDisposalReady==='function'&&typeof row.value.dispose==='function')![0];await f.host.call('Runtime.callFunctionOn',{objectId:controller,objectGroup:f.group,functionDeclaration:'function(){this.dispose();return{closed:true};}',arguments:[],returnByValue:true,awaitPromise:true});expect(f.host.fixture.state().controllerDisposals).toBe(1);await f.bridge.dispose();expect(f.host.fixture.state().controllerDisposals).toBe(1);
  });
  it('cannot recover by swapping a socket or reopening it after connection loss',async()=>{
    const f=setup();await f.bridge.prepare();const before=f.host.calls.length;f.host.socket=new FakeSocket();expect((await f.bridge.status()).state).toBe('UNVERIFIED');await expect(f.bridge.invoke('snapshot','new-connection')).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(before);f.host.socket.readyState=1;expect((await f.bridge.status()).state).toBe('UNVERIFIED');
  });
  it('treats a lost object-reference result as unverified instead of constructing a replacement gate',async()=>{
    const f=setup();f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&params.functionDeclaration.includes('function createRunnerKanbanGate'));await expect(f.bridge.prepare()).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');expect(f.bridge.state().state).toBe('UNVERIFIED');const before=f.host.calls.length;await expect(f.bridge.prepare()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(before);expect(f.host.fixture.trace).toEqual([]);
  });
  it('treats a lost lease-reference result as unknown, not as proof that a client owns the lease',async()=>{
    const f=setup();await f.bridge.prepare();f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&method(params)==='acquire');await expect(f.bridge.acquireLease('lost-lease')).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');expect(f.bridge.state().state).toBe('UNVERIFIED');expect(f.bridge.state().admissionState).toBe('unknown');await expect(f.bridge.invoke('snapshot','after-lost-lease')).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.fixture.trace).toEqual([]);
  });
  it('recovers a client deadline on transaction start through the same server handle only',async()=>{
    const f=await installed();f.host.fixture.hold('work');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&f.host.isTransaction(params)&&method(params)==='start');await expect(f.bridge.start()).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');await f.host.fixture.signal('work');expect((await f.bridge.status()).serverReceipt.operational.serverSettled).toBe(false);await expect(f.bridge.invoke('snapshot','during-start-unknown')).rejects.toThrow('APP_ADMISSION_CLOSED');f.host.fixture.release('work');const result=await f.bridge.result();expect(result.operational.restorationConfirmed).toBe(true);expect(f.host.fixture.trace.filter(value=>value==='off-enter')).toHaveLength(1);expect(f.host.fixture.trace.filter(value=>value==='on-enter')).toHaveLength(1);
  });
  it('rejects Node callbacks passed as ordinary application arguments before transport',async()=>{
    const f=setup();await f.bridge.prepare();const before=f.host.calls.length;await expect(f.bridge.invoke('command','node-callback',{callback:()=>Promise.resolve()})).rejects.toThrow('NON_JSON_ARGUMENT');expect(f.host.calls).toHaveLength(before);
  });

  it('does not let a delayed earlier start receipt revoke a terminal restored server receipt',async()=>{
    const f=await installed(),held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&f.host.isTransaction(params)&&method(params)==='start'?held.promise.then(()=>value):value;
    const starting=f.bridge.start();const final=await f.bridge.result();expect(final.operational.serverSettled).toBe(true);expect(final.operational.restorationConfirmed).toBe(true);held.resolve();const late=await starting;expect(late.operational.serverSettled).toBe(true);expect(f.bridge.state().state).toBe('terminal-restored');
  });
  it('cannot assert safe disposal from a client JSON readiness object',async()=>{
    const f=await runRestored();await cleanupAtBase(f);f.host.fixture.hooks.proofNotReady=true;await expect(f.bridge.dispose({ready:true})).rejects.toThrow('DISPOSE_PUBLIC_PROOF_NOT_READY');expect(f.host.fixture.trace).toContain('disposal-proof');expect(f.host.objects.size).toBeGreaterThan(0);
  });

  it('keeps an unknown lease release UNVERIFIED instead of guessing the lease is still held',async()=>{
    const f=setup();await f.bridge.prepare();const lease=await f.bridge.acquireLease('release-unknown');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&method(params)==='release');await expect(f.bridge.releaseLease(lease)).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.bridge.state().admissionState).toBe('unknown');await expect(f.bridge.invoke('snapshot','after-release-unknown')).rejects.toThrow('BRIDGE_UNVERIFIED');
  });
  it('does not run any app RPC after an unknown object-group release outcome',async()=>{
    const f=await runRestored();await cleanupAtBase(f);f.host.deadlines.push(name=>name==='Runtime.releaseObjectGroup');await expect(f.bridge.dispose()).rejects.toThrow('BRIDGE_UNVERIFIED');const before=f.host.calls.length;await expect(f.bridge.invoke('snapshot','disposed-unknown')).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(before);expect(f.host.fixture.state().controllerDisposals).toBe(0);
  });

  it('accepts semantically identical terminal receipts regardless of JSON object key order',async()=>{
    const f=await runRestored();const reverse=(value:any):any=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverse(value[key])])):value;
    f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&f.host.isTransaction(params)&&method(params)==='status'?{...value,result:{...value.result,value:reverse(value.result.value)}}:value;expect((await f.bridge.status()).state).toBe('terminal-restored');
  });

  it('closes only an empty prepared app gate, leaving a separate native controller group untouched',async()=>{
    const f=setup();const externalGroup='independent-native-owned-group';f.host.controller(externalGroup);const external=[...f.host.objects.keys()];const prepared=await f.bridge.prepare();expect(prepared).toEqual({prepared:true,objectGroup:f.group});expect(prepared.root).toBeUndefined();
    const before=f.host.fixture.state();const receipt=await f.bridge.closePreparedGateOnly();expect(receipt).toMatchObject({state:'preparedGateClosed',scope:'bridge-object-group-only',nativeJournalGate:'NOT_TESTED',nativeControllerOwnership:'NO_NATIVE_CONTROLLER_OWNED',lifecycleTransaction:'NOT_CREATED',objectGroupReleased:true,serverGate:{admissionsPaused:true,sealed:true,inFlight:0,unknownOutcomes:0}});
    expect(f.host.fixture.state()).toEqual(before);expect(f.host.fixture.trace).toEqual([]);expect(f.host.fixture.coreServiceReads).toEqual([]);expect([...f.host.objects.values()].every(row=>row.group===externalGroup)).toBe(true);expect([...f.host.objects.keys()]).toEqual(external);expect(f.host.socket.readyState).toBe(1);
    expect(Object.isFrozen(receipt)).toBe(true);expect(Object.isFrozen(receipt.serverGate)).toBe(true);expect(()=>{receipt.nativeJournalGate='PASSED';}).toThrow();const count=f.host.calls.length;expect(await f.bridge.closePreparedGateOnly()).toBe(receipt);expect(await f.bridge.status()).toBe(receipt);expect(f.bridge.state()).toBe(receipt);expect(f.host.calls).toHaveLength(count);
  });
  it('closes an ACKed command/snapshot ledger without adding app or Native calls',async()=>{
    const f=setup();await f.bridge.prepare();const command=await f.bridge.invoke('command','stage-a-edit',{type:'task.edit',taskId:'owned-task',title:'Owned update'});await f.bridge.ack(command);const snapshot=await f.bridge.invoke('snapshot','stage-a-snapshot');await f.bridge.ack(snapshot);const before=[...f.host.fixture.trace];
    const receipt=await f.bridge.closePreparedGateOnly();expect(receipt.nativeJournalGate).toBe('NOT_TESTED');expect(f.host.fixture.trace).toEqual(before);expect(f.host.fixture.coreServiceReads).toEqual([]);expect(f.host.calls.filter(call=>call.method==='Runtime.releaseObjectGroup')).toHaveLength(1);await expect(f.bridge.invoke('snapshot','after-prepared-close')).rejects.toThrow('PREPARED_GATE_CLOSED');
  });
  it('rejects an active actual app promise, then allows close only after real settlement and ACK',async()=>{
    const f=setup();await f.bridge.prepare();f.host.fixture.hold('command');const pending=f.bridge.invoke('command','stage-a-active',{type:'task.edit',taskId:'owned-task',title:'Active'});await f.host.fixture.signal('command');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.calls.filter(call=>call.method==='Runtime.releaseObjectGroup')).toEqual([]);
    f.host.fixture.release('command');const reply=await pending;await f.bridge.ack(reply);expect((await f.bridge.closePreparedGateOnly()).state).toBe('preparedGateClosed');
  });
  it('rejects unACKed and Node-fake-ACK receipts before a gate-only close',async()=>{
    const f=setup();await f.bridge.prepare();const reply=await f.bridge.invoke('snapshot','stage-a-unacked');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');await expect(f.bridge.ack(JSON.parse(JSON.stringify(reply)))).rejects.toThrow('APP_RECEIPT_SCOPE_MISMATCH');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');await f.bridge.ack(reply);await f.bridge.closePreparedGateOnly();
  });
  it('cannot release a gate after a client deadline until the actual promise is recovered and ACKed',async()=>{
    const f=setup();await f.bridge.prepare();f.host.fixture.hold('command');f.host.deadlines.push((name,params)=>name==='Runtime.callFunctionOn'&&f.host.isGate(params)&&method(params)==='result');await expect(f.bridge.invoke('command','stage-a-unknown',{type:'task.edit',taskId:'owned-task',title:'Unknown'})).rejects.toThrow('CLIENT_DEADLINE_SERVER_CONTINUES');
    await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);f.host.fixture.release('command');const reply=await f.bridge.recoverCall('stage-a-unknown');await f.bridge.ack(reply);await f.bridge.closePreparedGateOnly();
  });
  it('closes Node admission synchronously, so a call racing the first close await never reaches the server',async()=>{
    const f=setup();await f.bridge.prepare();const held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='acquire'?held.promise.then(()=>value):value;const closing=f.bridge.closePreparedGateOnly();
    await expect(f.bridge.invoke('snapshot','racing-close')).rejects.toThrow('APP_ADMISSION_CLOSED');expect(()=>f.bridge.rootReference()).toThrow('PREPARED_GATE_CLOSING');
    held.resolve();expect((await closing).state).toBe('preparedGateClosed');expect(f.host.fixture.trace).toEqual([]);
  });
  it('uses the actual server ledger, rejecting a server-cached unACKed call invisible to Node bookkeeping',async()=>{
    const f=setup();await f.bridge.prepare();const gate=[...f.host.objects.entries()].find(([,row])=>typeof row.value.begin==='function')![0];await f.host.call('Runtime.callFunctionOn',{objectId:gate,objectGroup:f.group,functionDeclaration:"function(){this.begin('snapshot','server-only',{});return this.result('server-only');}",arguments:[],returnByValue:true,awaitPromise:true});expect(f.bridge.state().pendingCallReceipts).toBe(0);
    await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);expect(f.host.objects.size).toBeGreaterThan(0);expect(f.bridge.state().admissionState).toBe('unknown');
  });
  it('drains a real server promise before detecting its unACKed outcome and retains the group',async()=>{
    const f=setup();await f.bridge.prepare();f.host.fixture.hold('command');const gate=[...f.host.objects.entries()].find(([,row])=>typeof row.value.begin==='function')![0];await f.host.call('Runtime.callFunctionOn',{objectId:gate,objectGroup:f.group,functionDeclaration:"function(){return this.begin('command','server-active',{type:'task.edit',taskId:'owned-task',title:'Server only'});}",arguments:[],returnByValue:true,awaitPromise:true});await f.host.fixture.signal('command');
    const closing=f.bridge.closePreparedGateOnly();expect(f.bridge.state().state).toBe('prepared-gate-closing');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);f.host.fixture.release('command');await expect(closing).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);
  });
  it('rejects gate-only close after ever acquiring and releasing a manual lease',async()=>{
    const f=setup();await f.bridge.prepare();const lease=await f.bridge.acquireLease('stage-a-prior-lease');await f.bridge.releaseLease(lease);await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.objects.size).toBeGreaterThan(0);
  });
  it.each(['binding','installation','start'])('rejects gate-only close after any attempted %s surface',async surface=>{
    const f=setup();await f.bridge.prepare();if(surface==='binding')await expect(f.bridge.bindIndependentController({})).rejects.toThrow();if(surface==='installation')await expect(f.bridge.install({})).rejects.toThrow();if(surface==='start')await expect(f.bridge.start()).rejects.toThrow();await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);
  });
  it('rejects gate-only close after a Root reference was ever exposed, even with no binding',async()=>{
    const f=setup();await f.bridge.prepare();f.bridge.rootReference();await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);
  });
  it('rejects gate-only close after any factory target exposure',async()=>{
    const f=setup();await f.bridge.prepare();const reference=hostObjectReference(f.host,f.group,f.host.retain(f.host.fixture.root,f.group));f.bridge.inspectorTarget(reference);await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');
  });
  it('never extends gate-only close to a bound pre-start controller or installed transaction',async()=>{
    const f=await installed();await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');expect(f.host.fixture.state().guardAlive).toBe(true);expect(f.host.fixture.trace).toEqual([]);await f.bridge.start();await f.bridge.result();await cleanupAtBase(f);expect((await f.bridge.dispose()).disposed).toBe(true);
  });
  it('retains an unverified outcome after socket loss during gate-only close',async()=>{
    const f=setup();await f.bridge.prepare();const held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='acquire'?held.promise.then(()=>value):value;const closing=f.bridge.closePreparedGateOnly();f.host.socket.lose();held.resolve();await expect(closing).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.bridge.state().state).toBe('UNVERIFIED');expect(f.bridge.state().admissionState).toBe('unknown');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('BRIDGE_UNVERIFIED');
  });
  it('does not claim preparedGateClosed after an unknown group release, and never retries',async()=>{
    const f=setup();await f.bridge.prepare();f.host.deadlines.push(name=>name==='Runtime.releaseObjectGroup');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.bridge.state().state).toBe('UNVERIFIED');expect(f.bridge.state().nativeJournalGate).not.toBe('NOT_TESTED');const before=f.host.calls.length;await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(before);
  });

  it('rejects gate-only close after a protocol-unknown ACK even if the actual server ledger was ACKed',async()=>{
    const f=setup();await f.bridge.prepare();const reply=await f.bridge.invoke('snapshot','stage-a-bad-ack');f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='acknowledge'?{result:{type:'object',value:{callId:'wrong',acknowledged:true,rawError:secret}}}:value;await expect(f.bridge.ack(reply)).rejects.toThrow('BRIDGE_UNVERIFIED');const before=f.host.calls.length;await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls).toHaveLength(before);expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);expect(JSON.stringify(f.bridge.state())).not.toContain('PRIVATE_SYNTHETIC');
  });
  it('refuses an independent-binding race and makes the in-progress gate-only close unverified',async()=>{
    const f=setup();await f.bridge.prepare();const held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='acquire'?held.promise.then(()=>value):value;const closing=f.bridge.closePreparedGateOnly();await expect(f.bridge.bindIndependentController({})).rejects.toThrow('PREPARED_GATE_CLOSING');held.resolve();await expect(closing).rejects.toThrow('BRIDGE_UNVERIFIED');expect(f.host.calls.some(call=>call.method==='Runtime.releaseObjectGroup')).toBe(false);expect(f.host.fixture.coreServiceReads).toEqual([]);
  });
  it('rejects close while a client metadata request remains in flight even with all semantic outcomes ACKed',async()=>{
    const f=setup();await f.bridge.prepare();const reply=await f.bridge.invoke('snapshot','stage-a-cached');await f.bridge.ack(reply);const held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='result'?held.promise.then(()=>value):value;const recovery=f.bridge.recoverCall('stage-a-cached');await expect(f.bridge.closePreparedGateOnly()).rejects.toThrow('PREPARED_GATE_CLOSE_NOT_ELIGIBLE');held.resolve();await recovery;await f.bridge.closePreparedGateOnly();
  });
  it('the actual paused server gate rejects a late raw admission during close, without invoking the app',async()=>{
    const f=setup();await f.bridge.prepare();const held=deferred();f.host.corrupt=(name,params,value)=>name==='Runtime.callFunctionOn'&&method(params)==='acquire'?held.promise.then(()=>value):value;const closing=f.bridge.closePreparedGateOnly();const gate=[...f.host.objects.entries()].find(([,row])=>typeof row.value.begin==='function')![0];const late=await f.host.call('Runtime.callFunctionOn',{objectId:gate,objectGroup:f.group,functionDeclaration:"function(){return this.begin('snapshot','late-stage-a',{});}",arguments:[],returnByValue:true,awaitPromise:true});expect(late.exceptionDetails).toBeTruthy();held.resolve();await closing;expect(f.host.fixture.trace).toEqual([]);expect(f.host.fixture.coreServiceReads).toEqual([]);
  });
  it('never authorizes integration from a bridge or transaction success alone',()=>{expect(BRIDGE_CONTRACT.status).toBe('prepared-not-executed');expect(BRIDGE_CONTRACT.nativeJournalGate).toBe('not-verified');expect(BRIDGE_CONTRACT.limits).toContain('not native journal proof');});
});
