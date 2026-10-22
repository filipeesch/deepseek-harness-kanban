/** In-memory protocol/race tests only. These mocks are NOT native gate evidence. */
import {describe,expect,it,vi} from 'vitest';
import type {ContextOperation,Project,Task} from '../../src/shared/types.js';
import {BoardStateSchema,initialState} from '../../src/domain/schema.js';
// @ts-expect-error The source-only .mjs preparation has no generated declaration file.
import {PLAN,INTEGRATION_CONTRACT,PINNED_API_PROOF,createRunnerKanbanGate,installNativeLifecycleTransaction} from '../../scripts/native-coordination-lifecycle.mjs';

type NativeStatus='running'|'stopping'|'completed'|'failed'|'killed';
type View={id:string;owner:string;kind:string;label:string;startedAt:number;status:NativeStatus;output:{total:number;earliest:number}};
type Event={type:'settled';job:View;awaited:boolean};
function deferred<T=void>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const secret='https://127.0.0.1:51781/?token=PRIVATE_SYNTHETIC_AUTH_TOKEN_123456789';
function fixture(){
  const nonce='abcdef123456',run='/workspace/.verification/native-fixtures/g3/run-'+nonce,base=run+'/monorepo/apps/api';
  const owner='session-12345678-1234-1234-1234-123456789abc';
  const spec={id:'kanban-uat-coordination-owned-1',owner,kind:'kanban-uat-coordination',label:'Owned native producer',rootCallId:'g3-coordination-'+nonce+'-1'};
  const config={transactionId:'g3-lifecycle-'+nonce,bundleName:'dsh-kanban',allowOwnerTest:true,allowFixtureData:true,allowNativeJobProducer:true,allowPluginLifecycle:true,exclusiveOperatorWindow:true,fixture:{nonce,run,base},ownedTaskIds:['owned-task'],ownedSessionIds:[owner],jobs:[spec]};
  const calls:string[]=[],listeners=new Set<(event:Event)=>void>(),waiters=new Map<string,Array<(view:View)=>void>>();
  const records=new Map<string,View>([[spec.id,{...spec,startedAt:1,status:'running',output:{total:0,earliest:0}}]]);
  const signals={listBlocked:deferred(),offEntered:deferred(),offCommitted:deferred(),onEntered:deferred(),workEntered:deferred()};
  const hooks:{listDelayAt?:number;listDelay?:Promise<unknown>;offDelay?:Promise<unknown>;onDelay?:Promise<unknown>;workDelay?:Promise<unknown>;offReject?:boolean;onReject?:boolean;workReject?:boolean;offApplication?:string;onApplication?:string;offObserved?:boolean;onObserved?:boolean;workLies?:boolean;waitRunning?:boolean;waitReject?:boolean;terminal?:NativeStatus;afterOff?:()=>void;suppressSettledEvent?:boolean;settledEventPatch?:Partial<Event>;settledJobPatch?:Partial<View>;duplicateSettledEvent?:boolean}={};
  let enabled=true,listCount=0;
  const copy=(view:View)=>Object.freeze({...view,output:Object.freeze({...view.output})});
  const jobs={
    get:vi.fn((id:string,caller:string)=>{const view=records.get(id);if(!view||view.owner!==caller)throw new Error(secret);return copy(view);}),
    list:vi.fn((caller:string)=>[...records.values()].filter(view=>view.owner===caller).map(copy)),
    wait:vi.fn((id:string,_timeout:number,caller:string)=>{const view=jobs.get(id,caller);if(hooks.waitReject)return Promise.reject(new Error(secret));if(hooks.waitRunning||view.status!=='running'&&view.status!=='stopping')return Promise.resolve(view);return new Promise<View>(resolve=>{const held=waiters.get(id)??[];held.push(resolve);waiters.set(id,held);});}),
    events:{subscribe:vi.fn((_filter:unknown,listener:(event:Event)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};})}
  };
  const finish=(status:NativeStatus='completed',jobId=spec.id)=>{const view=records.get(jobId)!;view.status=status;calls.push('native-'+status);const queued=waiters.get(jobId)??[];waiters.delete(jobId);for(const resolve of queued)resolve(copy(view));if(!hooks.suppressSettledEvent){const event={type:'settled' as const,job:{...copy(view),...hooks.settledJobPatch},awaited:queued.length>0,...hooks.settledEventPatch};for(const listener of listeners){listener(event);if(hooks.duplicateSettledEvent)listener(event);}}};
  const manager={
    listBundles:vi.fn(async()=>{listCount++;if(hooks.listDelayAt===listCount){signals.listBlocked.resolve();await hooks.listDelay;}return[{name:'dsh-kanban',enabled}];}),
    setBundleEnabled:vi.fn(async(name:string,on:boolean)=>{expect(name).toBe('dsh-kanban');if(!on){calls.push('off-enter');signals.offEntered.resolve();await hooks.offDelay;enabled=hooks.offObserved===false;calls.push('off-commit');signals.offCommitted.resolve();hooks.afterOff?.();if(hooks.offReject)throw new Error(secret);}else{calls.push('on-enter');signals.onEntered.resolve();await hooks.onDelay;enabled=hooks.onObserved!==false;calls.push('on-commit');if(hooks.onReject)throw new Error(secret);}return{stage:'enable',target:name,enabled:on,changed:true,application:(on?hooks.onApplication:hooks.offApplication)??'applied'};})
  };
  const timestamp='2026-10-22T00:00:00.000Z',state=initialState();
  const project:Project={id:'owned-project',name:'Owned lifecycle fixture',projectPath:base,gitRootPath:run+'/monorepo',defaultBranch:'main'};
  const operation:ContextOperation={id:'owned-waiting-operation',request:{kind:'create',mode:'new',path:run+'/journal-tree',branchName:'lifecycle-'+nonce,sourceBranch:'main'},phase:'waiting',targetPath:run+'/journal-tree',previousDirectories:{},switchedSessionIds:[],archivedSessionIds:[],gitCompleted:false,createdAt:timestamp};
  const task:Task={id:'owned-task',projectId:project.id,title:'Owned lifecycle fixture',description:'In-memory protocol fixture only.',columnId:state.workflow.initialColumnId,position:0,sessionIds:[owner],closedSessionIds:[],effectiveCwd:base,worktree:null,operation,archivedAt:null,createdAt:timestamp,updatedAt:timestamp};
  state.projects=[project];state.tasks=[task];
  const board={ok:true,value:{state,attention:{},sequence:0}};
  const invokers={command:vi.fn(async(_request:unknown)=>board),snapshot:vi.fn(async()=>{expect(enabled).toBe(true);calls.push('public-snapshot');return board;})};
  const services:Record<string,unknown>={kanbanController:invokers};
  const ctx={get:vi.fn((name:string)=>services[name])};
  const gate=createRunnerKanbanGate.call(ctx);
  const outside={gate,assertRetained:vi.fn(async()=>{}),settleOwnedWhileOff:vi.fn(async(permit:{jobIds:string[];ownerIds:string[]})=>{expect(enabled).toBe(false);expect(permit.jobIds).toEqual([spec.id]);expect(permit.ownerIds).toEqual([owner]);expect(gate.status().admissionsPaused).toBe(true);calls.push('work-enter');signals.workEntered.resolve();await hooks.workDelay;if(hooks.workReject)throw new Error(secret);if(!hooks.workLies)finish(hooks.terminal??'completed');return{status:'completed',rawError:secret};})};
  const fs={resolve:vi.fn(async(value:string)=>value),processPath:vi.fn((value:string)=>value),contains:vi.fn((parent:string,child:string)=>child.startsWith(parent+'/')),stat:vi.fn(async()=>({type:'directory'}))};
  const sessions={inspect:vi.fn(async(id:string)=>({meta:{cwd:base},events:[{type:'job/registered',data:{jobId:spec.id,owner:id,kind:spec.kind,label:spec.label,toolCall:{callId:spec.rootCallId,rootCallId:spec.rootCallId}}}]}))};
  Object.assign(services,{pluginManager:manager,jobs,fs,sessionController:sessions});
  const make=()=>installNativeLifecycleTransaction.call(ctx,config,outside);
  return{config,make,ctx,services,manager,jobs,records,finish,signals,hooks,calls,board,invokers,gate,outside,fs,sessions,get enabled(){return enabled;},set enabled(value:boolean){enabled=value;}};
}

describe('runner-owned public-call ledger',()=>{
  it('counts actual promises, pauses admissions, and requires delivery acknowledgment',async()=>{
    const held=deferred<unknown>(),entered=deferred();const command=vi.fn(async()=>{entered.resolve();return held.promise;});const gate=createRunnerKanbanGate.call({get:()=>({command,snapshot:vi.fn(async()=>({ok:true}))})});
    gate.begin('command','call-1',{});await entered.promise;const acquiring=gate.acquire('lifecycle');
    expect(gate.status()).toMatchObject({scope:'runner-owned-only',inFlight:1,admissionsPaused:true});
    expect(()=>gate.begin('snapshot','blocked',{})).toThrow('RUNNER_ADMISSIONS_PAUSED');expect(()=>gate.acknowledge('call-1','guessed')).toThrow();
    held.resolve({ok:true,value:'exact'});const lease=await acquiring;expect(()=>lease.assertHeld()).toThrow('RUNNER_OUTCOME_UNKNOWN');
    const delivered=await gate.result('call-1');expect(delivered.value).toEqual({ok:true,value:'exact'});gate.acknowledge('call-1',delivered.delivery);lease.assertHeld();lease.seal();
    await expect(lease.snapshotBeforeOff()).rejects.toThrow('KANBAN_READ_AFTER_OFF_SEAL');lease.release();expect(gate.status().admissionsPaused).toBe(false);
  });
  it('retains rejected/unknown outcomes without raw errors and supports exact recovery receipts',async()=>{
    const gate=createRunnerKanbanGate.call({get:()=>({command:vi.fn(async()=>{throw new Error(secret);}),snapshot:vi.fn(async()=>({ok:true}))})});gate.begin('command','rejected',{});
    const result=await gate.result('rejected');expect(result).toMatchObject({outcome:'rejected',failure:'PUBLIC_CALL_REJECTED'});expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    const lease=await gate.acquire('lifecycle');expect(()=>lease.assertHeld()).toThrow('RUNNER_OUTCOME_UNKNOWN');gate.acknowledge('rejected',result.delivery);lease.assertHeld();lease.release();
  });
  it('does not execute callbacks on construction or trust duplicate calls and arbitrary booleans',()=>{
    const command=vi.fn(),snapshot=vi.fn();const gate=createRunnerKanbanGate.call({get:()=>({command,snapshot})});expect(command).not.toHaveBeenCalled();expect(snapshot).not.toHaveBeenCalled();
    expect(()=>gate.acknowledge('missing',true)).toThrow();gate.begin('snapshot','one',{});expect(()=>gate.begin('snapshot','one',{})).toThrow('RUNNER_CALL_INVALID');
  });
});

describe('one-server-function lifecycle preparation (in-memory only)',()=>{
  it('imports inertly and publishes the pinned ordering proof and explicit non-global scope',()=>{
    const f=fixture();f.make();expect(f.ctx.get).not.toHaveBeenCalled();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(PLAN.nativeEffectsExecuted).toBe(0);expect(PLAN.status).toBe('prepared-not-executed');expect(INTEGRATION_CONTRACT.scope).toContain('No global SDK fence');expect(PINNED_API_PROOF.some((row:{lines:number[]})=>row.lines[0]===2373)).toBe(true);
  });
  it('is self-contained when serialized, observes canonical native completion while OFF, and restores ON',async()=>{
    const f=fixture();const factory=(0,eval)('('+installNativeLifecycleTransaction.toString()+')');const controller=factory.call(f.ctx,f.config,f.outside);controller.start();const result=await controller.result();
    expect(result.ok).toBe(true);expect(result.nativeJournalGate).toBe('not-verified');expect(result.verificationScope).toBe('transaction-window-only');expect(f.calls).toEqual(['public-snapshot','off-enter','off-commit','work-enter','native-completed','on-enter','on-commit']);
    expect(result.operational).toMatchObject({serverSettled:true,restorationConfirmed:true,offSettled:true,onSettled:true,leaseRetained:false});expect(result.quiescence.externalClientsAtomicallyFenced).toBe(false);
    expect(result.nativeJobs).toEqual([{jobId:f.config.jobs[0]!.id,owner:f.config.ownedSessionIds[0],nativeStatus:'completed',waitObserved:true,settledEventObserved:true}]);expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');expect(f.jobs.wait).toHaveBeenCalledWith(f.config.jobs[0]!.id,120000,f.config.ownedSessionIds[0]);
  });
  it('cannot restore ON before a delayed OFF prelude settles, even after client timeout',async()=>{
    const f=fixture(),delay=deferred();f.hooks.listDelayAt=2;f.hooks.listDelay=delay.promise;const controller=f.make();controller.start();await f.signals.listBlocked.promise;
    await expect(Promise.race([controller.result(),Promise.reject(new Error('client-timeout'))])).rejects.toThrow('client-timeout');
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(controller.status().operational.serverSettled).toBe(false);expect(()=>controller.dispose()).toThrow('TRANSACTION_STILL_RUNNING');
    controller.start();expect(Object.keys(controller)).not.toContain('restore');delay.resolve();const result=await controller.result();expect(result.ok).toBe(true);expect(f.calls.filter(value=>value.endsWith('commit'))).toEqual(['off-commit','on-commit']);expect(f.enabled).toBe(true);
  });
  it('awaits the actual OFF call before restoring when cancellation arrives during that call',async()=>{
    const f=fixture(),delay=deferred();f.hooks.offDelay=delay.promise;const controller=f.make();controller.start();await f.signals.offEntered.promise;controller.requestCancel();
    expect(f.calls).not.toContain('on-enter');delay.resolve();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('LIFECYCLE_CANCELLED');expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.calls.slice(-2)).toEqual(['on-enter','on-commit']);expect(f.enabled).toBe(true);
  });
  it('does not let client cancellation abandon actual work or precede its settlement with ON',async()=>{
    const f=fixture(),delay=deferred();f.hooks.workDelay=delay.promise;const controller=f.make();controller.start();await f.signals.workEntered.promise;controller.requestCancel();expect(f.calls).not.toContain('on-enter');delay.resolve();const result=await controller.result();expect(result.errors).toContain('LIFECYCLE_CANCELLED');expect(f.calls.indexOf('native-completed')).toBeLessThan(f.calls.indexOf('on-enter'));expect(f.enabled).toBe(true);
  });
  it('restores in finally when actual work rejects, without exposing raw errors or manufacturing native completion',async()=>{
    const f=fixture();f.hooks.workReject=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('OWN_NATIVE_WORK_REJECTED');expect(f.enabled).toBe(true);expect(result.nativeJobs[0].nativeStatus).toBe('running');expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
  });
  it.each(['restart-required','failed','cancelled','overridden','unknown'])('awaits finally ON after non-applied OFF application %s and never permits work',async application=>{
    const f=fixture();f.hooks.offApplication=application;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('OFF_NOT_APPLIED');expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.calls.filter(value=>value.endsWith('commit'))).toEqual(['off-commit','on-commit']);expect(f.enabled).toBe(true);
  });
  it('awaits finally ON even if OFF rejects after an actual disable effect',async()=>{
    const f=fixture();f.hooks.offReject=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OFF_CALL_REJECTED');expect(result.operational.offSettled).toBe(true);expect(f.calls.slice(-2)).toEqual(['on-enter','on-commit']);expect(f.enabled).toBe(true);
  });
  it.each(['restart-required','failed','cancelled','overridden','unknown'])('does not report restored or release admission after ON application %s',async application=>{
    const f=fixture();f.hooks.onApplication=application;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.operational.onSettled).toBe(true);expect(result.operational.restorationConfirmed).toBe(false);expect(result.operational.leaseRetained).toBe(true);expect(f.gate.status().admissionsPaused).toBe(true);expect(()=>controller.dispose()).toThrow('RESTORE_REQUIRES_OPERATOR');expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('keeps the same server promise alive through a delayed ON response',async()=>{
    const f=fixture(),delay=deferred();f.hooks.onDelay=delay.promise;const controller=f.make();controller.start();await f.signals.onEntered.promise;expect(controller.status().operational.serverSettled).toBe(false);expect(f.gate.status().admissionsPaused).toBe(true);delay.resolve();expect((await controller.result()).ok).toBe(true);expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('rejects early canonical settlement rather than substituting job activity flags',async()=>{
    const f=fixture(),delay=deferred();f.hooks.offDelay=delay.promise;const controller=f.make();controller.start();await f.signals.offEntered.promise;f.finish();delay.resolve();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('NATIVE_JOB_SETTLED_BEFORE_PERMISSION');expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.enabled).toBe(true);
  });
  it('does not believe a successful callback return instead of canonical wait/status',async()=>{
    const f=fixture();f.hooks.workLies=true;f.hooks.waitRunning=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('CANONICAL_JOB_WAIT_UNVERIFIED');expect(result.nativeJobs[0].nativeStatus).toBe('running');expect(f.enabled).toBe(true);
  });
  it.each(['failed','killed'] as const)('records actual canonical %s without promoting it to a full pass',async nativeStatus=>{
    const f=fixture();f.hooks.terminal=nativeStatus;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('OWN_NATIVE_JOB_UNSUCCESSFUL');expect(result.nativeJobs[0].nativeStatus).toBe(nativeStatus);expect(f.enabled).toBe(true);
  });
  it('never calls Kanban public invokers while admission is sealed/OFF',async()=>{
    const f=fixture(),delay=deferred();f.hooks.workDelay=delay.promise;const controller=f.make();controller.start();await f.signals.workEntered.promise;
    expect(()=>f.gate.begin('command','late-command',{})).toThrow('RUNNER_ADMISSIONS_PAUSED');expect(()=>f.gate.begin('snapshot','late-snapshot',{})).toThrow('RUNNER_ADMISSIONS_PAUSED');expect(f.invokers.snapshot).toHaveBeenCalledTimes(1);expect(f.invokers.command).not.toHaveBeenCalled();delay.resolve();await controller.result();
  });
  it('requires original enabled true before any effect',async()=>{
    const f=fixture();f.enabled=false;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_BUNDLE_NOT_ENABLED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.enabled).toBe(false);expect(f.jobs.wait).not.toHaveBeenCalled();
  });
  it.each(['operation','pendingTransition'])('aggregates foreign %s across all task rows before effects',async field=>{
    const f=fixture();const foreign:Task=structuredClone(f.board.value.state.tasks[0]!);foreign.id='foreign-task';foreign.projectId='foreign-project';foreign.sessionIds=['foreign-session'];foreign.effectiveCwd='/foreign/project';foreign.operation=null;
    if(field==='operation')foreign.operation={...f.board.value.state.tasks[0]!.operation!,id:'foreign-operation',phase:'failed'};
    else foreign.pendingTransition={id:'foreign-transition',fromColumnId:foreign.columnId,columnId:foreign.columnId,mode:'move',status:'failed'};
    f.board.value.state.projects.push({id:'foreign-project',name:'Foreign fixture',projectPath:'/foreign/project',gitRootPath:'/foreign'});f.board.value.state.tasks.push(foreign);expect(()=>BoardStateSchema.parse(f.board.value.state)).not.toThrow();
    const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('FOREIGN_PENDING_WORK');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.jobs.wait).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('foreign-task');
  });
  it('blocks lifecycle on unacknowledged real runner outcomes, not a client boolean',async()=>{
    const f=fixture();f.gate.begin('command','unknown-call',{});await f.gate.result('unknown-call');const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('RUNNER_OUTCOME_UNKNOWN');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.gate.status().unknownOutcomes).toBe(1);
  });
  it('drains an actual in-flight runner promise before any lifecycle mutation',async()=>{
    const f=fixture(),call=deferred<typeof f.board>(),entered=deferred();f.invokers.command.mockImplementationOnce(async()=>{entered.resolve();return call.promise;});f.gate.begin('command','in-flight',{});await entered.promise;const controller=f.make();controller.start();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.gate.status().inFlight).toBe(1);call.resolve(f.board);const delivery=await f.gate.result('in-flight');f.gate.acknowledge('in-flight',delivery.delivery);const result=await controller.result();expect(result.ok).toBe(true);
  });
  it.each(['allowOwnerTest','allowFixtureData','allowNativeJobProducer','allowPluginLifecycle','exclusiveOperatorWindow'])('rejects missing %s without public service access',field=>{
    const f=fixture();(f.config as unknown as Record<string,unknown>)[field]=false;expect(()=>f.make()).toThrow('LIFECYCLE_NOT_AUTHORIZED');expect(f.ctx.get).not.toHaveBeenCalled();
  });
  it('cannot target a different bundle or accept client callback/signal fields',()=>{
    const f=fixture();f.config.bundleName='@deepseek-ai/core';expect(()=>f.make()).toThrow('LIFECYCLE_REQUEST_INVALID');f.config.bundleName='dsh-kanban';(f.config as unknown as Record<string,unknown>).signal={aborted:false};expect(()=>f.make()).toThrow('LIFECYCLE_REQUEST_INVALID');expect(f.ctx.get).not.toHaveBeenCalled();
  });
  it('checks canonical immutable own-session origin and native registration before effects',async()=>{
    const f=fixture();f.sessions.inspect.mockResolvedValueOnce({meta:{cwd:'/different'},events:[]});const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_SESSION_ORIGIN_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('rejects an unexpected additional owned running job without touching it',async()=>{
    const f=fixture();const original=f.records.get(f.config.jobs[0]!.id)!;f.records.set('extra-job',{...original,id:'extra-job'});const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('UNEXPECTED_OWNED_ACTIVITY');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.records.get('extra-job')!.status).toBe('running');
  });
  it('rejects an unbranded or wrong-Host-root gate before any service access',()=>{
    const f=fixture();const otherRoot={get:vi.fn()};const wrong=createRunnerKanbanGate.call(otherRoot);
    expect(()=>installNativeLifecycleTransaction.call(f.ctx,f.config,{...f.outside,gate:wrong})).toThrow('HOST_SERVER_GATE_REQUIRED');
    expect(()=>installNativeLifecycleTransaction.call(f.ctx,f.config,{...f.outside,gate:{acquire:vi.fn()}})).toThrow('HOST_SERVER_GATE_REQUIRED');expect(f.ctx.get).not.toHaveBeenCalled();
    expect(()=>createRunnerKanbanGate()).toThrow('HOST_SERVER_CONTEXT_REQUIRED');expect(INTEGRATION_CONTRACT.realm).toContain('not universal realm attestation');
  });
  it('does not accept a by-value gate as a substitute for the Host object reference',()=>{
    const f=fixture();const copied=JSON.parse(JSON.stringify(f.gate));expect(copied).toEqual({});expect(()=>installNativeLifecycleTransaction.call(f.ctx,f.config,{...f.outside,gate:copied})).toThrow('INDEPENDENT_CONTROLLER_REQUIRED');expect(f.ctx.get).not.toHaveBeenCalled();
  });
  it('resolves the new public controller after restore, never a stale captured instance',async()=>{
    const f=fixture();const controller=f.make();controller.start();await controller.result();const fresh={command:vi.fn(async()=>f.board),snapshot:vi.fn(async()=>f.board)};f.services.kanbanController=fresh;
    f.gate.begin('snapshot','after-on',{});const result=await f.gate.result('after-on');f.gate.acknowledge('after-on',result.delivery);expect(fresh.snapshot).toHaveBeenCalledTimes(1);expect(f.invokers.snapshot).toHaveBeenCalledTimes(1);
  });
  it('keeps ordinary public RPC payloads out of status and lifecycle receipts',async()=>{
    const f=fixture();f.invokers.command.mockResolvedValueOnce({ok:true,value:{state:{projects:[],tasks:[],rawSecret:secret}}} as never);f.gate.begin('command','private-payload',{});const value=await f.gate.result('private-payload');expect(JSON.stringify(f.gate.status())).not.toContain('PRIVATE_SYNTHETIC');f.gate.acknowledge('private-payload',value.delivery);
    const controller=f.make();controller.start();expect(JSON.stringify(await controller.result())).not.toContain('PRIVATE_SYNTHETIC');
  });
  it('does not reopen a disposed handle or mutate a completed cancellation receipt',async()=>{
    const f=fixture();const unused=f.make();unused.dispose();expect(()=>unused.start()).toThrow('TRANSACTION_DISPOSED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
    const controller=f.make();controller.start();const before=await controller.result();expect(controller.requestCancel()).toEqual(before);controller.dispose();expect(()=>controller.start()).toThrow('TRANSACTION_DISPOSED');
  });
  it('requires all own pending journals quiet before disabling',async()=>{
    const f=fixture();f.board.value.state.tasks.push({...f.board.value.state.tasks[0]!,id:'owned-other',operation:{...f.board.value.state.tasks[0]!.operation!,phase:'git'}});f.config.ownedTaskIds.push('owned-other');const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_JOURNAL_NOT_QUIET');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('requires projected native cwd to remain at the exact fixture base',async()=>{
    const f=fixture();f.sessions.inspect.mockResolvedValueOnce({meta:{cwd:f.config.fixture.base},events:[{type:'working-directory/change',data:{cwd:'/different'}}]} as never);const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_SESSION_CONTEXT_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('requires observed OFF instead of a successful-looking application receipt',async()=>{
    const f=fixture();f.hooks.offObserved=false;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OFF_STATE_UNCONFIRMED');expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.enabled).toBe(true);expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('retains admission after rejected ON without client-side retries',async()=>{
    const f=fixture();f.hooks.onReject=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('ON_CALL_OR_OBSERVATION_REJECTED');expect(result.operational.onApplication).toBe('unknown');expect(result.operational.serverSettled).toBe(true);expect(f.gate.status().admissionsPaused).toBe(true);expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('does not release admission if ON is not observed enabled',async()=>{
    const f=fixture();f.hooks.onObserved=false;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('ON_STATE_UNCONFIRMED');expect(result.operational.leaseRetained).toBe(true);expect(f.enabled).toBe(false);expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed native wait identity rather than trusting its terminal word',async()=>{
    const f=fixture();const original=f.records.get(f.config.jobs[0]!.id)!;f.jobs.wait.mockResolvedValueOnce({...original,kind:'different',status:'completed'});const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('CANONICAL_JOB_WAIT_UNVERIFIED');expect(result.ok).toBe(false);expect(f.enabled).toBe(true);
  });
  it('rejects a failed native wait without leaking its raw error',async()=>{
    const f=fixture();f.hooks.waitReject=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('CANONICAL_JOB_WAIT_UNVERIFIED');expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');expect(f.enabled).toBe(true);
  });
  it('rejects a replaced canonical execution with the same job ID and never permits work',async()=>{
    const f=fixture();f.hooks.afterOff=()=>{f.records.get(f.config.jobs[0]!.id)!.startedAt=2;};const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('CANONICAL_JOB_IDENTITY_CHANGED');expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.enabled).toBe(true);
  });
  it('QR-L1 cancels during the final awaited list prelude without issuing OFF or ON',async()=>{
    const f=fixture(),held=deferred();f.hooks.listDelayAt=2;f.hooks.listDelay=held.promise;const controller=f.make();controller.start();await f.signals.listBlocked.promise;controller.requestCancel();held.resolve();const result=await controller.result();
    expect(result.ok).toBe(false);expect(result.errors).toContain('LIFECYCLE_CANCELLED');expect(result.operational).toMatchObject({offAttempted:false,onAttempted:false,serverSettled:true});expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.outside.settleOwnedWhileOff).not.toHaveBeenCalled();expect(f.enabled).toBe(true);expect(f.gate.status().admissionsPaused).toBe(false);
  });
  it('QR-L2 rejects suppressed settled delivery despite canonical completed wait/get',async()=>{
    const f=fixture();f.hooks.suppressSettledEvent=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('NATIVE_SETTLED_EVENT_UNVERIFIED');expect(result.nativeJobs[0]).toMatchObject({nativeStatus:'completed',waitObserved:true,settledEventObserved:false});expect(f.enabled).toBe(true);expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it.each([
    {name:'id',patch:{id:'other-job'}},
    {name:'owner',patch:{owner:'other-owner'}},
    {name:'kind',patch:{kind:'other-kind'}},
    {name:'label',patch:{label:secret}},
    {name:'startedAt',patch:{startedAt:2}},
    {name:'nonterminal status',patch:{status:'running' as NativeStatus}},
    {name:'inconsistent terminal status',patch:{status:'failed' as NativeStatus}}
  ])('QR-L2 requires matching settled-event $name',async({patch})=>{
    const f=fixture();f.hooks.settledJobPatch=patch;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors.length).toBeGreaterThan(0);expect(result.nativeJobs[0].settledEventObserved).toBe(false);expect(f.enabled).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
  });
  it.each([false,undefined])('QR-L2 requires awaited===true, not %s',async awaited=>{
    const f=fixture();f.hooks.settledEventPatch={awaited};const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('NATIVE_JOB_UNAWAITED');expect(result.nativeJobs[0].settledEventObserved).toBe(false);expect(f.enabled).toBe(true);
  });
  it('QR-L2 requires an exact awaited event for every expected job, not just one',async()=>{
    const f=fixture(),first=f.config.jobs[0]!,second={...first,id:'kanban-uat-coordination-owned-2',label:'Owned second producer',rootCallId:first.rootCallId+'-second'};f.config.jobs.push(second);f.records.set(second.id,{...second,startedAt:2,status:'running',output:{total:0,earliest:0}});
    f.sessions.inspect.mockResolvedValue({meta:{cwd:f.config.fixture.base},events:f.config.jobs.map(spec=>({type:'job/registered',data:{jobId:spec.id,owner:spec.owner,kind:spec.kind,label:spec.label,toolCall:{callId:spec.rootCallId,rootCallId:spec.rootCallId}}}))});
    f.outside.settleOwnedWhileOff.mockImplementationOnce(async()=>{f.finish();f.hooks.suppressSettledEvent=true;f.finish('completed',second.id);return{status:'completed',rawError:secret};});
    const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('NATIVE_SETTLED_EVENT_UNVERIFIED');expect(result.nativeJobs.map((job:{settledEventObserved:boolean})=>job.settledEventObserved)).toEqual([true,false]);expect(result.nativeJobs.every((job:{nativeStatus:string})=>job.nativeStatus==='completed')).toBe(true);expect(f.enabled).toBe(true);
  });
  it('QR-L2 rejects duplicate settled commits rather than silently replacing proof',async()=>{
    const f=fixture();f.hooks.duplicateSettledEvent=true;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('NATIVE_SETTLED_EVENT_DUPLICATE');expect(f.enabled).toBe(true);
  });
  it('uses complete Schema-valid Task DTOs for the positive initial waiting fixture',()=>{
    const f=fixture();const parsed=BoardStateSchema.parse(f.board.value.state);expect(parsed.tasks[0]!.effectiveCwd).toBe(f.config.fixture.base);expect(parsed.tasks[0]!.operation).toMatchObject({phase:'waiting',gitCompleted:false,switchedSessionIds:[],archivedSessionIds:[],previousDirectories:{}});
  });
  it.each(['missing','wrong'])('QR-L3 rejects %s effectiveCwd despite correct native base context',async mode=>{
    const f=fixture();const task=f.board.value.state.tasks[0]!;if(mode==='missing')delete(task as unknown as Record<string,unknown>).effectiveCwd;else task.effectiveCwd=f.config.fixture.run+'/wrong';expect((await f.sessions.inspect(f.config.ownedSessionIds[0]!)).meta.cwd).toBe(f.config.fixture.base);
    const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('OWN_TASK_CONTEXT_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.jobs.wait).not.toHaveBeenCalled();expect(f.enabled).toBe(true);
  });
  it.each([
    {name:'completed Git',field:'gitCompleted',value:true},
    {name:'missing Git flag',field:'gitCompleted',value:undefined},
    {name:'switched participant',field:'switchedSessionIds',value:['session-12345678-1234-1234-1234-123456789abc']},
    {name:'missing switched list',field:'switchedSessionIds',value:undefined},
    {name:'archived participant',field:'archivedSessionIds',value:['session-12345678-1234-1234-1234-123456789abc']},
    {name:'prior directory',field:'previousDirectories',value:{participant:'/wrong'}},
    {name:'missing prior directory map',field:'previousDirectories',value:undefined},
    {name:'target directory already selected',field:'targetDirectory',value:'/wrong'},
    {name:'target mismatch',field:'targetPath',value:'/wrong'},
    {name:'recovery intent',field:'createAttempt',value:{}},
    {name:'prior failure',field:'error',value:{code:'RECOVERY_PENDING',message:'Prior work.'}},
    {name:'missing request',field:'request',value:undefined}
  ])('QR-L3 rejects waiting context with $name before OFF',async({field,value})=>{
    const f=fixture();(f.board.value.state.tasks[0]!.operation as unknown as Record<string,unknown>)[field]=value;const controller=f.make();controller.start();const result=await controller.result();expect(result.ok).toBe(false);expect(result.errors).toContain('OWN_WAITING_CONTEXT_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.jobs.wait).not.toHaveBeenCalled();
  });
  it('QR-L3 rejects an initial create journal whose task already binds a checkout',async()=>{
    const f=fixture();f.board.value.state.tasks[0]!.worktree={path:f.config.fixture.run+'/known-tree',branch:'known',owned:true,status:'ready'};const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_WAITING_CONTEXT_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('accepts a fully valid waiting move transition at base without an operation',async()=>{
    const f=fixture(),task=f.board.value.state.tasks[0]!;task.operation=null;task.pendingTransition={id:'owned-transition',fromColumnId:task.columnId,columnId:task.columnId,mode:'move',status:'waiting'};expect(()=>BoardStateSchema.parse(f.board.value.state)).not.toThrow();const controller=f.make();controller.start();expect((await controller.result()).ok).toBe(true);
  });
  it.each(['wrong source column','missing transition id','missing run participant','prior transition failure'])('QR-L3 rejects %s in a waiting transition',async mode=>{
    const f=fixture(),task=f.board.value.state.tasks[0]!;task.operation=null;task.pendingTransition={id:'owned-transition',fromColumnId:task.columnId,columnId:task.columnId,mode:'move',status:'waiting'};
    if(mode==='wrong source column')task.pendingTransition.fromColumnId='wrong';if(mode==='missing transition id')delete(task.pendingTransition as unknown as Record<string,unknown>).id;if(mode==='missing run participant')task.pendingTransition.mode='run';if(mode==='prior transition failure')task.pendingTransition.error={code:'OLD',message:'Prior failure.'};
    const controller=f.make();controller.start();const result=await controller.result();expect(result.errors).toContain('OWN_WAITING_CONTEXT_UNVERIFIED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('cancellation intent never writes canonical native job state',async()=>{
    const f=fixture();const controller=f.make();controller.requestCancel();controller.start();const result=await controller.result();expect(result.errors).toContain('LIFECYCLE_CANCELLED');expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.jobs.get).not.toHaveBeenCalled();expect(f.records.get(f.config.jobs[0]!.id)!.status).toBe('running');
  });
});
