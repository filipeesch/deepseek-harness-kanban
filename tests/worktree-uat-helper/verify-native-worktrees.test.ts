import {afterEach,describe,expect,it,vi} from 'vitest';
// @ts-expect-error Standalone guarded acceptance CLI intentionally has no TypeScript build step.
import {NativeWorktreeFailure,assertAuthorizations,assertOwnedIds,assertOwnedPath,assertQuietEnvironment,fixtureHook,fixturePaths,main,modelBudget,nativeAction,parseArgs,prepareFixture,runVerification,safeReport,boardSnapshot,rpc,unwrapRpcEnvelope,unwrapBusinessOutcome,creationId,sessionCreationId,isEntityId,isNativeSessionId,operationDiagnostic,returnForeignFixturesBeforeRemoval,acquire,until,moveOwnedBase} from '../../scripts/verify-native-worktrees.mjs';

// Synthetic seams ONLY: these tests never authenticate, launch a live browser, create a real
// fixture, change native policies, mutate existing sessions, or contact a model.
const flags=['--allow-owner-test','--allow-fixture-data','--allow-fixture-policy-changes'];
const authorized=()=>({allowOwnerTest:true,allowFixtureData:true,allowFixturePolicyChanges:true,allowModelRequests:false,timeoutMs:1000});
const nonce='abcdef123456';
const entityId='12345678-1234-1234-1234-123456789abc';
const id='session-'+entityId;
const secret='https://127.0.0.1:51781/?token=SYNTHETIC_PRIVATE_SECRET_12345678901234567890';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function ioFixture(){
  return {io:{mkdir:vi.fn(async(_path:string,_options?:unknown)=>{}),lstat:vi.fn(async(_path:string):Promise<{isSymbolicLink:()=>boolean;isDirectory:()=>boolean}>=>({isSymbolicLink:()=>false,isDirectory:()=>true})),realpath:vi.fn(async(path:string)=>path),writeFile:vi.fn(async(_path:string,_value:string,_options?:unknown)=>{})},run:vi.fn(async(_file:string,_args:string[],_options:unknown)=>({stdout:'',stderr:''}))};
}
function nativeFixture(){
  const paths=fixturePaths('/workspace',nonce),session={id},live={id,status:'idle',session,inbox:{nextTurn:[]}};
  const modes=new Map([[id,'workspace-write']]);const dirs=new Map([[id,paths.root]]);const events:Array<{type:string;data:unknown}>=[];
  const controller={inspect:vi.fn(async(_id:string)=>({meta:{cwd:paths.root},events})),projections:vi.fn(async()=>({kind:'sequenced',values:{workingDirectory:dirs.get(id),turnBoundary:{openTurnStartSeq:null},inbox:{'next-turn':[]},userQuestions:{active:[]}}})),resolveAgent:vi.fn(async()=>({agent:live})),cancel:vi.fn(async()=>{}),prompt:vi.fn(async()=>{})};
  const presets={names:['read-only','workspace-write','danger-full-access'],catalog:()=>({defaultPreset:'workspace-write'}),resolve:(name:string)=>({sandbox:name}),current:()=>modes.get(id),set:vi.fn((value:{id:string},mode:string)=>modes.set(value.id,mode))};
  const working={get:()=>dirs.get(id),set:vi.fn(async(_agent:unknown,cwd:string)=>{dirs.set(id,cwd);})};
  const workspace={archivedSessionIds:[] as string[],archiveSession:vi.fn(async(sid:string)=>{workspace.archivedSessionIds.push(sid);}),unarchiveSession:vi.fn(async(sid:string)=>{workspace.archivedSessionIds=workspace.archivedSessionIds.filter(item=>item!==sid);})};
  const services:Record<string,unknown>={sessionController:controller,permissionPresets:presets,workingDirectory:working,workspaceRegistry:workspace,sandboxPolicy:{resolve:()=>({mode:modes.get(id)})},agents:{get:()=>live},sessions:{get:()=>session},sandbox:{confine:()=>{}}};
  const ctx={get:(key:string)=>services[key],waterfall:vi.fn(async()=>[])};
  const payload=(action:Record<string,unknown>)=>({...authorized(),action,origins:[{id,origin:paths.root}],allowedOrigins:[paths.root,paths.monoProject],allowedCwds:[paths.root,paths.rootNew,paths.monoProject],allowedFullOrigins:[paths.monoProject],modelRequests:0,prefixes:{}});
  return{paths,ctx,payload,controller,presets,working,workspace,events,modes,dirs,live};
}

describe('independent owner, fixture and native-policy authorizations',()=>{
  it('has an inert help path and requires all three flags',async()=>{
    expect(await main(['--help'])).toHaveProperty('help');
    for(let omit=0;omit<flags.length;omit++)expect(()=>parseArgs(flags.filter((_,index)=>index!==omit))).toThrow(NativeWorktreeFailure);
    expect(()=>parseArgs([])).toThrow(NativeWorktreeFailure);
    expect(parseArgs(flags)).toMatchObject({...authorized(),timeoutMs:30000});
    expect(parseArgs([...flags,'--allow-model-requests'])).toHaveProperty('allowModelRequests',true);
  });
  it('rechecks programmatic guards before dependency, browser, auth or fixture work',async()=>{
    const dependencies={env:{},loadPlaywright:vi.fn(),connect:vi.fn(),hostCall:vi.fn(),prepareFixture:vi.fn()};
    for(const key of ['allowOwnerTest','allowFixtureData','allowFixturePolicyChanges'])await expect(runVerification({...authorized(),[key]:false},dependencies)).rejects.toBeInstanceOf(NativeWorktreeFailure);
    for(const value of Object.values(dependencies))if(typeof value==='function')expect(value).not.toHaveBeenCalled();
    expect(()=>assertAuthorizations({...authorized(),allowModelRequests:'yes'})).toThrow(NativeWorktreeFailure);
  });
  it.each(['--endpoint','--workspace','--profile','--token','--cookie','--unknown'])('rejects alternate targets or credentials via %s',flag=>{
    expect(()=>parseArgs([...flags,flag,secret])).toThrow('Native G3/G5 verification failed at stage: arguments');
  });
  it.each(['0','999','120001','-1','Infinity','oops'])('rejects an unsafe timeout %s',value=>{
    expect(()=>parseArgs([...flags,'--timeout-ms',value])).toThrow(NativeWorktreeFailure);
  });
  it('rejects duplicate flags, unsafe nonces and active debug environments before loading a browser',async()=>{
    expect(()=>parseArgs([...flags,flags[0]!])).toThrow(NativeWorktreeFailure);
    const load=vi.fn();await expect(runVerification(authorized(),{env:{},nonce:()=> '../escape',loadPlaywright:load})).rejects.toBeInstanceOf(NativeWorktreeFailure);expect(load).not.toHaveBeenCalled();
    for(const key of ['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'])expect(()=>assertQuietEnvironment({[key]:secret})).toThrow(NativeWorktreeFailure);
    await expect(runVerification(authorized(),{env:{DEBUG:'1'},loadPlaywright:load})).rejects.toBeInstanceOf(NativeWorktreeFailure);expect(load).not.toHaveBeenCalled();
  });
  it('permits at most one explicitly authorized fixed boundary prompt reservation',()=>{
    const budget=modelBudget();expect(budget.snapshot()).toBe(0);expect(()=>budget.reserve(false)).toThrow(NativeWorktreeFailure);expect(budget.snapshot()).toBe(0);
    budget.reserve(true);expect(budget.snapshot()).toBe(1);expect(()=>budget.reserve(true)).toThrow(NativeWorktreeFailure);expect(budget.snapshot()).toBe(1);
  });
});

describe('retained owned fixture preparation guards, with fake I/O only',()=>{
  it('rejects missing approval before even resolving a path',async()=>{
    const f=ioFixture();await expect(prepareFixture({...authorized(),allowFixturePolicyChanges:false},'/workspace',nonce,f.io,f.run)).rejects.toBeInstanceOf(NativeWorktreeFailure);
    expect(f.io.realpath).not.toHaveBeenCalled();expect(f.io.mkdir).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();
  });
  it('pins root, monorepo, sentinel and every target to the new workspace namespace',()=>{
    const paths=fixturePaths('/workspace',nonce);expect(paths.run).toBe('/workspace/.verification/native-fixtures/g3/run-'+nonce);
    expect(paths.monoProject).toBe(paths.mono+'/apps/api');expect(paths.sentinel.startsWith(paths.run+'/')).toBe(true);expect(paths.sentinel.startsWith(paths.root+'/')).toBe(false);
    expect(assertOwnedPath(paths,paths.rootNew)).toBe(paths.rootNew);
    for(const value of ['../escape','ABCDEF123456','abcdef123456/more',''])expect(()=>fixturePaths('/workspace',value)).toThrow(NativeWorktreeFailure);
    for(const value of ['/workspace/user-file',paths.run+'/../other',paths.run+'/bad\0path'])expect(()=>assertOwnedPath(paths,value)).toThrow(NativeWorktreeFailure);
  });
  it('prepares only exclusive owned repos, local Git config and one owned confinement sentinel hook',async()=>{
    const f=ioFixture();const paths=await prepareFixture(authorized(),'/workspace',nonce,f.io,f.run);
    expect(f.io.mkdir.mock.calls.filter(([path])=>path===paths.run)).toEqual([[paths.run]]);
    const init=f.run.mock.calls.filter(([,args])=>args.includes('init'));expect(init).toHaveLength(2);expect(init.every(([,args])=>args.includes('--template='))).toBe(true);
    for(const [file,args,opts]of f.run.mock.calls){expect(file).toBe('git');expect(args).not.toContain('--global');const options=opts as {cwd:string;env:Record<string,string>};expect([paths.root,paths.mono]).toContain(options.cwd);expect(options.env.GIT_CONFIG_NOSYSTEM).toBe('1');expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');expect(Object.keys(options.env)).not.toContain('OPENAI_API_KEY');expect(Object.keys(options.env)).not.toContain('DEEPSEEK_API_KEY');}
    const writes=f.io.writeFile.mock.calls;expect(writes.every(([path])=>path.startsWith(paths.run+'/'))).toBe(true);expect(writes.every(([, ,opts])=>(opts as {flag:string}).flag==='wx')).toBe(true);
    const hook=writes.find(([path])=>path.endsWith('/.git/hooks/post-checkout'));expect(hook?.[1]).toContain(paths.sentinel);expect(hook?.[1]).toContain('/bin/sleep 3');expect(hook?.[2]).toMatchObject({mode:0o700});
    expect(fixtureHook(paths)).toContain('\nexit 0\n');expect(fixtureHook(paths)).not.toContain('curl');
  });
  it('refuses symlinked or aliased parents before running Git or writing files',async()=>{
    for(const alias of [false,true]){const f=ioFixture();if(alias)f.io.realpath.mockImplementation(async path=>path==='/workspace/.verification'?'/elsewhere':path);else f.io.lstat.mockResolvedValue({isSymbolicLink:()=>true,isDirectory:()=>true});await expect(prepareFixture(authorized(),'/workspace',nonce,f.io,f.run)).rejects.toBeInstanceOf(NativeWorktreeFailure);expect(f.io.writeFile).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();}
  });
  it('refuses to overwrite a prior run and has no recursive deletion seam',async()=>{
    const f=ioFixture();f.io.mkdir.mockImplementation(async path=>{if(path.endsWith('run-'+nonce))throw Object.assign(new Error(),{code:'EEXIST'});});
    await expect(prepareFixture(authorized(),'/workspace',nonce,f.io,f.run)).rejects.toMatchObject({code:'EEXIST'});expect(f.io.writeFile).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();
  });
});

describe('fixed public native action unit seams (not live gate evidence)',()=>{
  it('checks exact IDs and header origins before every effect',async()=>{
    const f=nativeFixture();expect(()=>assertOwnedIds(['foreign'],new Set([id]))).toThrow(NativeWorktreeFailure);expect(()=>assertOwnedIds([],new Set([id]))).toThrow(NativeWorktreeFailure);
    await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id:'foreign',mode:'read-only'}))).rejects.toThrow();expect(f.presets.set).not.toHaveBeenCalled();
    f.controller.inspect.mockResolvedValue({meta:{cwd:'/existing-user-project'},events:[]});await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'read-only'}))).rejects.toThrow();expect(f.presets.set).not.toHaveBeenCalled();expect(f.controller.resolveAgent).not.toHaveBeenCalled();
  });
  it('uses the public per-session preset setter and never fabricates events or changes defaults',async()=>{
    const f=nativeFixture();const result=await nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'read-only'}));expect(result).toMatchObject({before:'workspace-write',after:'read-only'});expect(f.presets.set).toHaveBeenCalledWith({id},'read-only');expect(f.presets.catalog().defaultPreset).toBe('workspace-write');expect(nativeAction.toString()).not.toContain('.append(');
    await expect(nativeAction.call({root:f.ctx},{...f.payload({kind:'policy',id,mode:'danger-full-access'}),allowFixturePolicyChanges:false})).rejects.toThrow();expect(f.presets.set).toHaveBeenCalledTimes(1);
  });
  it('refuses busy writes, unapproved writes and arbitrary directory destinations',async()=>{
    const f=nativeFixture();await expect(nativeAction.call({root:f.ctx},{...f.payload({kind:'directory',id,directory:f.paths.rootNew}),allowFixtureData:false})).rejects.toThrow();
    await expect(nativeAction.call({root:f.ctx},f.payload({kind:'directory',id,directory:'/user/project'}))).rejects.toThrow();expect(f.working.set).not.toHaveBeenCalled();
    f.ctx.waterfall.mockResolvedValue(['native-work'] as never[]);await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'read-only'}))).rejects.toThrow();expect(f.presets.set).not.toHaveBeenCalled();
  });
  it('returns only safe history fingerprints and retains archived native conversations',async()=>{
    const f=nativeFixture();f.events.push({type:'runtime/metadata',data:{private:secret}});let summary=await nativeAction.call({root:f.ctx},f.payload({kind:'summary',ids:[id]}));expect(summary[id].prefixMatches).toBe(true);expect(summary[id].prefixFingerprint).toMatch(/^[0-9a-f]{16}$/);expect(JSON.stringify(summary)).not.toContain(secret);
    await nativeAction.call({root:f.ctx},f.payload({kind:'archive',id}));expect(f.workspace.archivedSessionIds).toContain(id);summary=await nativeAction.call({root:f.ctx},f.payload({kind:'summary',ids:[id]}));expect(summary[id].archived).toBe(true);
    await nativeAction.call({root:f.ctx},f.payload({kind:'unarchive',id}));expect(f.workspace.archivedSessionIds).not.toContain(id);expect(f.events).toHaveLength(1);
  });
  it('never accepts caller-provided model text and rejects model work without the optional flag',async()=>{
    const f=nativeFixture();await expect(nativeAction.call({root:f.ctx},f.payload({kind:'prompt',id,requestId:id,text:secret}))).rejects.toThrow();expect(f.controller.prompt).not.toHaveBeenCalled();
    await nativeAction.call({root:f.ctx},{...f.payload({kind:'prompt',id,requestId:id,text:secret}),allowModelRequests:true,modelRequests:1});
    const call=f.controller.prompt.mock.calls[0] as unknown as [{content:Array<{text:string}>}];expect(call[0].content[0]!.text).toContain('Do not call any tools');expect(call[0].content[0]!.text).not.toContain(secret);
  });
});

describe('real transport and business Outcome shapes (synthetic only)',()=>{
  const board={state:{projects:[],tasks:[],notes:[]},sequence:1,attention:{}};
  const pageFor=(value:unknown)=>({url:()=> 'http://127.0.0.1:51781/',evaluate:vi.fn(async(_fn:unknown,request:{rpcId:string})=>({type:'server-response',rpcId:request.rpcId,result:{ok:true,value}}))});
  it('unwraps BOTH native envelope and business Outcome before snapshot.state access',async()=>{
    const page=pageFor({ok:true,value:board});expect(await boardSnapshot(page,1000)).toBe(board);
    const raw=await rpc(page,'kanban/snapshot',{},1000);expect(raw).toEqual({ok:true,value:board});
    expect(unwrapBusinessOutcome(raw)).toBe(board);
    expect(page.evaluate.mock.calls[0]?.[1]).toMatchObject({endpoint:'kanban/snapshot',args:{},timeoutMs:1000});
  });
  it('leaves public native session/create values unwrapped from business Outcomes',async()=>{
    const page=pageFor({sessionId:id});expect(await rpc(page,'session/create',{request:{cwd:'/fixture'}},1000)).toEqual({sessionId:id});
    expect(()=>unwrapBusinessOutcome({sessionId:id})).toThrow();
  });
  it('rejects failed/mismatched/missing native envelope fields without spreading private errors',()=>{
    for(const body of [{rpcId:id,result:{ok:true,value:board}},{type:'server-response',rpcId:'wrong',result:{ok:true,value:board}},{type:'server-response',rpcId:id,result:{ok:false,error:{message:secret}}},{type:'server-response',rpcId:id,result:{ok:true}}]){
      let failure:unknown;try{unwrapRpcEnvelope(body,id);}catch(error){failure=error;}
      expect(failure).toBeInstanceOf(Error);expect(String(failure)).not.toContain(secret);
    }
  });
  it('rejects business failure before reading state and never turns rejection into an empty board',async()=>{
    const state=vi.fn(()=>{throw new Error(secret);});const value={ok:false,error:{code:'FORBIDDEN',message:secret}};Object.defineProperty(value,'state',{get:state});
    await expect(boardSnapshot(pageFor(value),1000)).rejects.toThrow();expect(state).not.toHaveBeenCalled();
    for(const outcome of [undefined,{ok:true},{ok:false,error:{message:secret}},{value:board}])expect(()=>unwrapBusinessOutcome(outcome)).toThrow();
    await expect(boardSnapshot(pageFor({ok:true,value:{state:{projects:[],tasks:[]}}}),1000)).rejects.toThrow();
  });
  it('requires canonical command receipts rather than guessing matching existing IDs',()=>{
    expect(creationId({commandReceipt:{kind:'task',id:entityId}},'task')).toBe(entityId);
    for(const snapshot of [{state:{tasks:[{id}]}},{commandReceipt:{kind:'project',id}},{commandReceipt:{kind:'task',id:'arbitrary'}},{ok:true,value:{commandReceipt:{kind:'task',id}}}])expect(()=>creationId(snapshot,'task')).toThrow();
  });
  it('rejects nonclean roots, alternate endpoints and malformed payloads before page evaluation',async()=>{
    const page=pageFor({ok:true,value:board});
    for(const endpoint of ['settings/update','session/rename','session/delete','../kanban/command'])await expect(rpc(page,endpoint,{},1000)).rejects.toThrow();
    await expect(rpc({...page,url:()=> 'http://127.0.0.1:51781/?token=x'},'kanban/snapshot',{},1000)).rejects.toThrow();
    await expect(rpc(page,'kanban/snapshot',[],1000)).rejects.toThrow();expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('exact native observations and post-ensure effects',()=>{
  it('reads archived/fresh history and cwd without resolving or resuming an Agent',async()=>{
    const f=nativeFixture();f.controller.resolveAgent.mockRejectedValue(new Error('Archived actors must not be activated'));
    f.workspace.archivedSessionIds.push(id);
    const summary=await nativeAction.call({root:f.ctx},f.payload({kind:'summary',ids:[id]}));
    expect(summary[id]).toMatchObject({cwd:f.paths.root,archived:true,idle:true});
    expect(f.controller.projections).toHaveBeenCalled();expect(f.controller.resolveAgent).not.toHaveBeenCalled();expect(f.working.set).not.toHaveBeenCalled();
  });
  it('archives/unarchives owned native identity without an unnecessary ensure activation',async()=>{
    const f=nativeFixture();f.controller.resolveAgent.mockRejectedValue(new Error('No activation'));
    await nativeAction.call({root:f.ctx},f.payload({kind:'archive',id}));await nativeAction.call({root:f.ctx},f.payload({kind:'unarchive',id}));
    expect(f.controller.resolveAgent).not.toHaveBeenCalled();expect(f.events).toEqual([]);
  });
  it('detects a native ensure cwd recovery before applying policy or another directory effect',async()=>{
    const f=nativeFixture();f.dirs.set(id,f.paths.rootNew);
    f.controller.resolveAgent.mockImplementation(async()=>{f.dirs.set(id,f.paths.root);return {agent:f.live};});
    await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'read-only'}))).rejects.toThrow();
    expect(f.presets.set).not.toHaveBeenCalled();expect(f.working.set).not.toHaveBeenCalled();
  });
  it.each(['boundary','inbox','question','approval'])('refuses %s native pending state before a policy write',async kind=>{
    const f=nativeFixture();
    if(kind==='approval')f.events.push({type:'approval/asked',data:{id:'owned-approval'}});
    else f.controller.projections.mockResolvedValue({kind:'sequenced',values:{workingDirectory:f.paths.root,turnBoundary:{openTurnStartSeq:kind==='boundary'?1:null},inbox:{'next-turn':kind==='inbox'?[{}]:[]},userQuestions:{active:kind==='question'?[{}]:[]}}} as never);
    await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'read-only'}))).rejects.toThrow();
    expect(f.presets.set).not.toHaveBeenCalled();expect(f.controller.resolveAgent).not.toHaveBeenCalled();
  });
  it('rechecks native activity after resolving the allowed fixture Agent',async()=>{
    const f=nativeFixture();f.controller.resolveAgent.mockImplementation(async()=>{f.live.status='running';return {agent:f.live};});
    await expect(nativeAction.call({root:f.ctx},f.payload({kind:'directory',id,directory:f.paths.rootNew}))).rejects.toThrow();expect(f.working.set).not.toHaveBeenCalled();
  });
  it('allows explicit full access ONLY for the owned monorepo subproject origin',async()=>{
    const f=nativeFixture();await expect(nativeAction.call({root:f.ctx},f.payload({kind:'policy',id,mode:'danger-full-access'}))).rejects.toThrow();
    expect(f.controller.resolveAgent).not.toHaveBeenCalled();
    f.controller.inspect.mockResolvedValue({meta:{cwd:f.paths.monoProject},events:[]});f.dirs.set(id,f.paths.monoProject);
    const payload={...f.payload({kind:'policy',id,mode:'danger-full-access'}),origins:[{id,origin:f.paths.monoProject}]};
    expect(await nativeAction.call({root:f.ctx},payload)).toMatchObject({after:'danger-full-access'});
    expect(f.presets.set).toHaveBeenCalledOnce();expect(f.presets.catalog().defaultPreset).toBe('workspace-write');
  });
  it('does not cancel or prompt a fixture without the separately reserved one-request budget',async()=>{
    const f=nativeFixture();
    for(const kind of ['cancel','prompt'])await expect(nativeAction.call({root:f.ctx},{...f.payload({kind,id,requestId:id}),allowModelRequests:true})).rejects.toThrow();
    expect(f.controller.cancel).not.toHaveBeenCalled();expect(f.controller.prompt).not.toHaveBeenCalled();
  });
});

describe('late private-resource cleanup and bounded observations',()=>{
  it('closes a browser handle that arrives after its acquisition deadline',async()=>{
    vi.useFakeTimers();const browser={close:vi.fn(async()=>{})};let release:((value:typeof browser)=>void)|undefined;
    const pending=expect(acquire(()=>new Promise(resolve=>{release=resolve;}),1000)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);await pending;release?.(browser);await vi.advanceTimersByTimeAsync(0);expect(browser.close).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds observation polling and removes wait timers on abort',async()=>{
    vi.useFakeTimers();const stop=new AbortController(),read=vi.fn(async()=>false);
    const pending=expect(until(read,Boolean,1000,stop.signal)).rejects.toThrow();await vi.advanceTimersByTimeAsync(20);stop.abort();await vi.advanceTimersByTimeAsync(0);await pending;
    expect(read).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('retains an explicit incomplete live-gate statement even if implemented synthetic checks are true',()=>{
    const report=safeReport({ok:true,stage:'artifact',checks:{newBranch:true,monorepoCwd:true,osConfinement:true},remaining:['native-busy-wait-not-exercised','partial-cwd-not-exercised','pending-journal-recovery-not-exercised']});
    expect(report.fullGatePass).toBe(false);expect(report.remaining).toContain('pending-journal-recovery-not-exercised');
  });
  it('rejects a hook path outside the owned fixture and never overwrites a held origin destination',async()=>{
    const paths=fixturePaths('/workspace',nonce);expect(()=>fixtureHook({...paths,sentinel:'/user/private'})).toThrow();
    const io={lstat:vi.fn(async()=>({isDirectory:()=>true,isSymbolicLink:()=>false})),realpath:vi.fn(async(path:string)=>path),rename:vi.fn(async()=>{})};
    await expect(moveOwnedBase(authorized(),paths,{from:paths.monoProject,to:paths.monoProject+'.held-'+nonce},io)).rejects.toThrow();expect(io.rename).not.toHaveBeenCalled();
  });
});

describe('private acquisitions and unambiguous native creation receipts',()=>{
  it('does not confuse raw native SessionCreated with a business Outcome',()=>{
    expect(sessionCreationId({sessionId:id})).toBe(id);
    for(const value of [{ok:true,value:{sessionId:id}},{sessionId:secret},{sessionId:''},{commandReceipt:{kind:'conversation',id}}])expect(()=>sessionCreationId(value)).toThrow();
  });
  it('cleans a late browser acquisition in the actual runner seam and never reaches auth/fixture creation',async()=>{
    vi.useFakeTimers();let release:((value:{close:ReturnType<typeof vi.fn>})=>void)|undefined;
    const browser={close:vi.fn(async()=>{})},host={call:vi.fn(async()=>({})),close:vi.fn(async()=>{})},prepare=vi.fn(),hostCall=vi.fn();
    const before={interrupt:process.listenerCount('SIGINT'),terminate:process.listenerCount('SIGTERM')};
    const pending=runVerification(authorized(),{env:{},nonce:()=>nonce,loadPlaywright:async()=>({chromium:{launch:()=>new Promise(resolve=>{release=resolve;})}}),connect:async()=>host,hostCall,prepareFixture:prepare});
    await vi.advanceTimersByTimeAsync(1000);const result=await pending;
    expect(result).toMatchObject({ok:false,stage:'browser',modelRequests:0});expect(host.close).toHaveBeenCalledOnce();expect(hostCall).not.toHaveBeenCalled();expect(prepare).not.toHaveBeenCalled();
    release?.(browser);await vi.advanceTimersByTimeAsync(0);expect(browser.close).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt);expect(process.listenerCount('SIGTERM')).toBe(before.terminate);
  });
  it('cleans a late page and its earlier context/browser/inspector without minting a login URL',async()=>{
    vi.useFakeTimers();let release:((value:{close:ReturnType<typeof vi.fn>})=>void)|undefined;
    const page={close:vi.fn(async()=>{})};const context={setDefaultTimeout:vi.fn(),setDefaultNavigationTimeout:vi.fn(),route:vi.fn(async()=>{}),newPage:()=>new Promise(resolve=>{release=resolve;}),close:vi.fn(async()=>{})};
    const browser={newContext:async()=>context,close:vi.fn(async()=>{})},host={call:vi.fn(async()=>({})),close:vi.fn(async()=>{})},hostCall=vi.fn();
    const pending=runVerification(authorized(),{env:{},nonce:()=>nonce,loadPlaywright:async()=>({chromium:{launch:async()=>browser}}),connect:async()=>host,hostCall});
    await vi.advanceTimersByTimeAsync(1000);const result=await pending;
    expect(result).toMatchObject({ok:false,stage:'browser'});expect(hostCall).not.toHaveBeenCalled();
    for(const resource of [context,browser,host])expect(resource.close).toHaveBeenCalledOnce();
    release?.(page);await vi.advanceTimersByTimeAsync(0);expect(page.close).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
});

describe('canonical native Session namespace regression from core1',()=>{
  const secondEntity='abcdefab-1234-4321-8123-0123456789ab',second='session-'+secondEntity;
  it('distinguishes native session-UUIDs from plugin project/task/note UUIDs',()=>{
    expect(isNativeSessionId(id)).toBe(true);expect(isNativeSessionId(entityId)).toBe(false);
    expect(isEntityId(entityId)).toBe(true);expect(isEntityId(id)).toBe(false);
    for(const bad of ['session-'+secret,'session-abc','sessions-'+entityId,undefined,{},''])expect(isNativeSessionId(bad)).toBe(false);
  });
  it('claims the real conversation receipt namespace after native B creation succeeds',()=>{
    const snapshot={commandReceipt:{kind:'conversation',id:second},state:{tasks:[{id:entityId,sessionIds:[id,second]}]}};
    expect(creationId(snapshot,'conversation')).toBe(second);
    expect(()=>assertOwnedIds([id,second],new Set(snapshot.state.tasks[0]!.sessionIds))).not.toThrow();
    expect(()=>creationId({commandReceipt:{kind:'conversation',id:secondEntity}},'conversation')).toThrow();
  });
  it.each(['project','task','note'])('keeps %s receipts unprefixed rather than changing all UUID rules',kind=>{
    expect(creationId({commandReceipt:{kind,id:entityId}},kind)).toBe(entityId);
    expect(()=>creationId({commandReceipt:{kind,id}},kind)).toThrow();
  });
  it('admits native create values only with session namespace and explicit ownership',()=>{
    expect(sessionCreationId({sessionId:second})).toBe(second);expect(()=>sessionCreationId({sessionId:secondEntity})).toThrow();
    expect(()=>assertOwnedIds([second],new Set([id]))).toThrow();
    expect(()=>assertOwnedIds([entityId],new Set([entityId]))).toThrow();
    expect(()=>assertOwnedIds([id,id],new Set([id]))).toThrow();
    expect(()=>assertOwnedIds([entityId],new Set([entityId]),'entity')).not.toThrow();
  });
  it('never silently drops captured/archived native IDs or their per-session policy audit',()=>{
    const report=safeReport({ok:false,stage:'root-fresh',ids:{projects:[entityId,id],tasks:[entityId,id],sessions:[id,second,entityId]},cleanup:{attempted:true,baseRestored:true,deletedTasks:[entityId,id],archived:[id,second,entityId],errors:[]},policies:[{id,before:'workspace-write',after:'read-only',reason:'cleanup-restrict'},{id:entityId,before:'workspace-write',after:'read-only',reason:'cleanup-restrict'}]});
    expect(report.ids).toEqual({projects:[entityId],tasks:[entityId],sessions:[id,second]});
    expect(report.cleanup.deletedTasks).toEqual([entityId]);expect(report.cleanup.archived).toEqual([id,second]);
    expect(report.policies).toEqual([{id,before:'workspace-write',after:'read-only',reason:'cleanup-restrict'}]);
  });
  it('rejects an entity UUID masquerading as an owned native Session before native inspect/effects',async()=>{
    const f=nativeFixture(),payload=f.payload({kind:'policy',id:entityId,mode:'read-only'});
    payload.origins=[{id:entityId,origin:f.paths.root}];
    await expect(nativeAction.call({root:f.ctx},payload)).rejects.toThrow();
    expect(f.controller.inspect).not.toHaveBeenCalled();expect(f.presets.set).not.toHaveBeenCalled();
  });
});

describe('foreign fixture return precedes task removal',()=>{
  function foreignFixture(){
    const paths=fixturePaths('/workspace',nonce),foreign='session-11111111-2222-4333-8444-555555555555';
    const origins=new Map([[id,paths.root],[foreign,paths.root]]),tasks=[{id:entityId,sessions:[id]}];
    const state={origin:paths.root,cwd:paths.rootNew,idle:true,prefixMatches:true,archived:false};const events:string[]=[];
    const actions={summary:vi.fn(async(key:string)=>{events.push('summary:'+key);return {...state};}),validateOrigin:vi.fn(async()=>{events.push('validate-base');}),unarchive:vi.fn(async(key:string)=>{events.push('unarchive:'+key);state.archived=false;}),directory:vi.fn(async(key:string,directory:string)=>{events.push('directory:'+key);state.cwd=directory;})};
    return {paths,foreign,origins,tasks,state,actions,events};
  }
  it('returns ONLY known unassociated C before the task-deletion phase',async()=>{
    const f=foreignFixture();const returned=await returnForeignFixturesBeforeRemoval(authorized(),f.paths,f.tasks,f.origins,f.actions);f.events.push('task-delete');
    expect(returned).toEqual([f.foreign]);expect(f.actions.directory).toHaveBeenCalledExactlyOnceWith(f.foreign,f.paths.root);
    expect(f.events.indexOf('directory:'+f.foreign)).toBeLessThan(f.events.indexOf('task-delete'));
    expect(f.actions.summary.mock.calls.every(([key])=>key===f.foreign)).toBe(true);expect(f.actions.unarchive).not.toHaveBeenCalled();
  });
  it('does not reopen or move an already-base archived C',async()=>{
    const f=foreignFixture();f.state.cwd=f.paths.root;f.state.archived=true;
    expect(await returnForeignFixturesBeforeRemoval(authorized(),f.paths,f.tasks,f.origins,f.actions)).toEqual([f.foreign]);
    expect(f.actions.unarchive).not.toHaveBeenCalled();expect(f.actions.directory).not.toHaveBeenCalled();
  });
  it.each(['busy','history-changed','wrong-origin'])('stops before removal if C is %s',async kind=>{
    const f=foreignFixture();if(kind==='busy')f.state.idle=false;if(kind==='history-changed')f.state.prefixMatches=false;if(kind==='wrong-origin')f.state.origin='/user/elsewhere';
    const remove=vi.fn();await expect((async()=>{await returnForeignFixturesBeforeRemoval(authorized(),f.paths,f.tasks,f.origins,f.actions);remove();})()).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();expect(f.actions.directory).not.toHaveBeenCalled();expect(f.actions.unarchive).not.toHaveBeenCalled();
  });
  it('validates the retained base before any reopening/move and stops on inaccessible origin',async()=>{
    const f=foreignFixture();f.state.archived=true;f.actions.validateOrigin.mockRejectedValue(new Error(secret));
    await expect(returnForeignFixturesBeforeRemoval(authorized(),f.paths,f.tasks,f.origins,f.actions)).rejects.toThrow();
    expect(f.actions.unarchive).not.toHaveBeenCalled();expect(f.actions.directory).not.toHaveBeenCalled();
  });
  it('rejects unapproved calls and foreign original paths before any native read/effect',async()=>{
    const f=foreignFixture();await expect(returnForeignFixturesBeforeRemoval({...authorized(),allowFixtureData:false},f.paths,f.tasks,f.origins,f.actions)).rejects.toThrow();
    f.origins.set(f.foreign,'/user/original');await expect(returnForeignFixturesBeforeRemoval(authorized(),f.paths,f.tasks,f.origins,f.actions)).rejects.toThrow();
    expect(f.actions.summary).not.toHaveBeenCalled();expect(f.actions.directory).not.toHaveBeenCalled();
  });
});

describe('precise allowlisted original-failure diagnostics',()=>{
  it('retains original shared result separately when cleanup later records a generic projection failure',()=>{
    const original=operationDiagnostic({code:'SHARED_WORKTREE',message:'Another native session is using this checkout. '+secret},'shared-target-command','business');
    const cleanup=operationDiagnostic({code:'KANBAN_ERROR',message:'Session projection read failed '+secret},'cleanup','business');
    const report=safeReport({ok:false,stage:'shared-target-result',diagnostics:[original,cleanup]});
    expect(report.stage).toBe('shared-target-result');expect(report.diagnostics.map((item:{code:string})=>item.code)).toEqual(['SHARED_WORKTREE','KANBAN_ERROR']);
    expect(report.diagnostics[0]).toMatchObject({stage:'shared-target-command',shared:true,projection:false});expect(report.diagnostics[1]).toMatchObject({stage:'cleanup',projection:true});
    expect(JSON.stringify(report)).not.toContain('SYNTHETIC_PRIVATE_SECRET');expect(JSON.stringify(report)).not.toContain('message');
  });
  it('distinguishes source/ABI, permission and projection classes without printing native messages',()=>{
    expect(operationDiagnostic({message:'TypeError: listed.items.map is not a function'},'shared-target-command','business')).toMatchObject({typeError:true,projection:false});
    expect(operationDiagnostic({message:'EACCES permission denied '+secret},'shared-target-command','business')).toMatchObject({permission:true});
    expect(operationDiagnostic({message:'Session projection read failed'},'shared-target-command','business')).toMatchObject({projection:true,typeError:false});
  });
  it('drops arbitrary codes, fields, stages and nonboolean error flags',()=>{
    const report=safeReport({diagnostics:[{code:secret,stage:secret,surface:secret,message:secret,details:{secret},projection:secret,typeError:true}]});
    expect(report.diagnostics).toEqual([{stage:'arguments',surface:'assertion',code:'UNKNOWN_ERROR',projection:false,typeError:true,missingPath:false,permission:false,shared:false,timeout:false}]);
    expect(JSON.stringify(report)).not.toContain('SYNTHETIC_PRIVATE_SECRET');
  });
});

describe('private context and report failure behavior',()=>{
  it('suppresses dependency errors and removes signal handlers without creating any fixture',async()=>{
    const before={interrupt:process.listenerCount('SIGINT'),terminate:process.listenerCount('SIGTERM')};const prepare=vi.fn();
    const result=await runVerification(authorized(),{env:{},nonce:()=>nonce,prepareFixture:prepare,loadPlaywright:async()=>{throw new Error(secret);}});
    expect(result.ok).toBe(false);expect(result.stage).toBe('dependency');expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_SECRET');expect(prepare).not.toHaveBeenCalled();expect(result.modelRequests).toBe(0);
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt);expect(process.listenerCount('SIGTERM')).toBe(before.terminate);
  });
  it('closes every private resource after a raw navigation failure without leaking its URL',async()=>{
    let fence:((route:unknown)=>Promise<void>)|undefined;
    const page={goto:vi.fn(async()=>{throw new Error(secret);}),url:()=> 'http://127.0.0.1:51781/',close:vi.fn(async()=>{})};
    const context={setDefaultTimeout:vi.fn(),setDefaultNavigationTimeout:vi.fn(),route:vi.fn(async(_pattern:string,handler:(route:unknown)=>Promise<void>)=>{fence=handler;}),newPage:vi.fn(async()=>page),close:vi.fn(async()=>{})};
    const browser={newContext:vi.fn(async(_options:unknown)=>context),close:vi.fn(async()=>{})};const host={call:vi.fn(async()=>({})),close:vi.fn(async()=>{})};const prepare=vi.fn();
    const result=await runVerification(authorized(),{env:{},nonce:()=>nonce,loadPlaywright:async()=>({chromium:{launch:async()=>browser}}),connect:async()=>host,hostCall:async()=> 'http://127.0.0.1:51781/?token='+ 'SYNTHETIC_PRIVATE_SECRET_'.repeat(2),prepareFixture:prepare});
    expect(result.ok).toBe(false);expect(result.stage).toBe('owner-login');expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_SECRET');expect(prepare).not.toHaveBeenCalled();
    for(const resource of [page,context,browser,host])expect(resource.close).toHaveBeenCalledOnce();
    const opts=browser.newContext.mock.calls[0]?.[0] as Record<string,unknown>;for(const key of ['storageState','recordHar','recordVideo','userDataDir'])expect(opts).not.toHaveProperty(key);
    const allowed={request:()=>({url:()=> 'http://127.0.0.1:51781/api/kanban/snapshot'}),continue:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};await fence!(allowed);expect(allowed.continue).toHaveBeenCalledWith();
    const foreign={...allowed,request:()=>({url:()=> 'https://external.example/path'}),continue:vi.fn(async()=>{}),abort:vi.fn(async()=>{})};await fence!(foreign);expect(foreign.abort).toHaveBeenCalledWith('blockedbyclient');expect(foreign.continue).not.toHaveBeenCalled();
  });
  it('whitelists reports instead of spreading raw URLs, cookies, errors or arbitrary nested data',()=>{
    const paths=fixturePaths('/workspace',nonce);const result=safeReport({ok:false,stage:secret,runId:nonce,fixture:{run:paths.run,report:secret,retained:true,projectsRetained:true,rawError:secret},ids:{projects:[entityId,secret],tasks:[entityId],sessions:[id],secret},checks:{newBranch:true,unknown:secret},remaining:['native-busy-wait-not-exercised',secret],policies:[{id,before:'workspace-write',after:'read-only',reason:'cleanup-restrict',secret}],cleanup:{attempted:true,deletedTasks:[entityId,secret],archived:[id],errors:['native-archive-failed',secret],storageState:secret},cookies:secret,authenticatedUrl:secret,rawError:secret});
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_SECRET');expect(result.stage).toBe('arguments');expect(result.fixture.report).toBe(paths.report);expect(result.ids.projects).toEqual([entityId]);expect(result.checks).toEqual({newBranch:true});expect(result.remaining).toEqual(['native-busy-wait-not-exercised']);
  });
});
