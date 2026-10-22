import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error Standalone Node-native acceptance helper intentionally has no TypeScript build step.
import {EDITOR, NativeUatFailure, assertAuthorizations, assertOwnedIds, assertQuietEnvironment, fixturePaths, main, modelBudget, parseArgs, prepareFixture, runVerification, safeReport, safePluginCode, selectFixtureProject, taskUiCheckpoint} from '../../scripts/verify-native-conversations.mjs';
const flags=['--allow-owner-test','--allow-fixture-data','--allow-model-requests'];
const authorized=()=>({allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true,timeoutMs:1000,modelTimeoutMs:1000});
afterEach(()=>{vi.restoreAllMocks();});
// Synthetic dependency seams only: NO live browser, auth, repository, native data, or model calls.
function ioFixture() {
  const directories:string[]=[];
  return {directories,io:{mkdir:vi.fn(async(path:string)=>{directories.push(path);}),lstat:vi.fn(async():Promise<{isSymbolicLink:()=>boolean;isDirectory:()=>boolean}>=>({isSymbolicLink:()=>false,isDirectory:()=>true})),realpath:vi.fn(async(path:string)=>path),writeFile:vi.fn(async()=>{})},run:vi.fn(async()=>({stdout:'',stderr:''}))};
}
describe('three independent explicit authorizations',()=>{
  it('has a side-effect-free help path and refuses every missing authorization',async()=>{
    expect(await main(['--help'])).toHaveProperty('help');
    for(let omit=0;omit<3;omit++)expect(()=>parseArgs(flags.filter((_,index)=>index!==omit))).toThrow(NativeUatFailure);
    expect(()=>parseArgs([])).toThrow(NativeUatFailure);
    expect(parseArgs(flags)).toMatchObject(authorizedExceptTiming());
  });
  function authorizedExceptTiming(){return{allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true};}
  it('rechecks flags in the programmatic API before imports, connections, filesystem or model access',async()=>{
    const dependencies={loadPlaywright:vi.fn(),connect:vi.fn(),prepareFixture:vi.fn(),hostCall:vi.fn()};
    for(const key of['allowOwnerTest','allowFixtureData','allowModelRequests'])await expect(runVerification({...authorized(),[key]:false},dependencies)).rejects.toBeInstanceOf(NativeUatFailure);
    for(const spy of Object.values(dependencies))expect(spy).not.toHaveBeenCalled();
  });
  it.each(['--endpoint','--path','--profile','--token','--unknown'])('rejects unsupported %s instead of accepting alternate targets or credentials',flag=>{
    expect(()=>parseArgs([...flags,flag,'secret-value'])).toThrow(NativeUatFailure);
  });
  it.each(['0','999','120001','-1','Infinity','not-a-number'])('rejects unsafe timeout %s without echoing raw input',value=>{
    expect(()=>parseArgs([...flags,'--timeout-ms',value])).toThrow('Native G2 verification failed at stage: arguments');
  });
  it('rejects duplicates and any active debug/trace environment before loading Playwright',async()=>{
    expect(()=>parseArgs([...flags,flags[0]!])).toThrow(NativeUatFailure);
    for(const key of['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'])expect(()=>assertQuietEnvironment({[key]:'synthetic-secret-debug-destination'})).toThrow(NativeUatFailure);
    const load=vi.fn();await expect(runVerification(authorized(),{env:{DEBUG:'1'},loadPlaywright:load})).rejects.toBeInstanceOf(NativeUatFailure);expect(load).not.toHaveBeenCalled();
  });
});
describe('retained, isolated fixture repository guards',()=>{
  it('rechecks all permissions in the exported filesystem mutator before touching any path',async()=>{
    const f=ioFixture();
    await expect(prepareFixture({...authorized(),allowFixtureData:false},'/workspace','abcdef123456',f.io,f.run)).rejects.toBeInstanceOf(NativeUatFailure);
    expect(f.io.mkdir).not.toHaveBeenCalled();expect(f.io.realpath).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();
  });
  it('pins all fixture paths to the unique workspace G2 subtree',()=>{
    const paths=fixturePaths('/workspace','abcdef123456');
    expect(paths).toEqual({base:'/workspace/.verification/native-fixtures/g2',run:'/workspace/.verification/native-fixtures/g2/run-abcdef123456',repo:'/workspace/.verification/native-fixtures/g2/run-abcdef123456/project',evidence:'/workspace/.verification/native-fixtures/g2/run-abcdef123456/evidence',report:'/workspace/.verification/native-fixtures/g2/run-abcdef123456/evidence/g2.json'});
    for(const value of['../escape','existing','abcdef123456/else','ABCDEF123456',''])expect(()=>fixturePaths('/workspace',value)).toThrow(NativeUatFailure);
  });
  it('prepares only exclusive new directories, uses exact git argv, disables ambient config/hooks and never deletes',async()=>{
    const f=ioFixture();const paths=await prepareFixture(authorized(),'/workspace','abcdef123456',f.io,f.run);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.run.mock.calls[0]?.slice(0,2)).toEqual(['git',['init','--initial-branch=main','--template=']]);
    const commit=f.run.mock.calls[1] as unknown as [string,string[],{cwd:string;env:Record<string,string>;timeout:number;maxBuffer:number}];
    expect(commit[1]).toContain('core.hooksPath='+paths.repo+'/.disabled-hooks');expect(commit[1]).toContain('core.fsmonitor=false');expect(commit[1]).toContain('--allow-empty');
    expect(commit[2].cwd).toBe(paths.repo);expect(commit[2].timeout).toBe(10000);expect(commit[2].maxBuffer).toBe(65536);
    expect(commit[2].env.GIT_CONFIG_NOSYSTEM).toBe('1');expect(commit[2].env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(Object.keys(commit[2].env)).not.toContain('OPENAI_API_KEY');expect(Object.keys(commit[2].env)).not.toContain('DEEPSEEK_API_KEY');
    expect(f.io.mkdir.mock.calls.find(([path])=>path===paths.run)).toEqual([paths.run]);
    expect(f.io.writeFile).not.toHaveBeenCalled();
  });
  it('rejects symlinked parents and aliased canonical directories before git runs',async()=>{
    const f=ioFixture();f.io.lstat.mockResolvedValue({isSymbolicLink:()=>true,isDirectory:()=>true});
    await expect(prepareFixture(authorized(),'/workspace','abcdef123456',f.io,f.run)).rejects.toBeInstanceOf(NativeUatFailure);expect(f.run).not.toHaveBeenCalled();
    const alias=ioFixture();alias.io.realpath.mockImplementation(async(path:string)=>path.endsWith('.verification')?'/elsewhere':path);
    await expect(prepareFixture(authorized(),'/workspace','abcdef123456',alias.io,alias.run)).rejects.toBeInstanceOf(NativeUatFailure);expect(alias.run).not.toHaveBeenCalled();
  });
  it('never overwrites an old run and propagates git failure instead of claiming fixture success',async()=>{
    const f=ioFixture();f.io.mkdir.mockImplementation(async(path:string)=>{if(path.endsWith('run-abcdef123456'))throw Object.assign(new Error('Exists'),{code:'EEXIST'});});
    await expect(prepareFixture(authorized(),'/workspace','abcdef123456',f.io,f.run)).rejects.toThrow('Exists');expect(f.run).not.toHaveBeenCalled();
    const git=ioFixture();git.run.mockRejectedValue(new Error('git failed'));
    await expect(prepareFixture(authorized(),'/workspace','abcdef123456',git.io,git.run)).rejects.toThrow('git failed');expect(git.run).toHaveBeenCalledTimes(1);
  });
  it('refuses every identity outside the owned fixture set',()=>{
    const owned=new Set(['fixture-a','fixture-b']);
    expect(()=>assertOwnedIds(['fixture-a','fixture-b'],owned)).not.toThrow();
    for(const ids of[[],['unrelated'],['fixture-a','unrelated'],[undefined]])expect(()=>assertOwnedIds(ids,owned)).toThrow(NativeUatFailure);
  });
});
describe('verified native project dropdown and safe checkpoints',()=>{
  it('uses the exact accessible combobox name instead of the known-broken wrapped label selector',async()=>{
    let selected='';const control={count:vi.fn(async()=>1),selectOption:vi.fn(async(id:string)=>{selected=id;}),inputValue:vi.fn(async()=>selected)};
    const dialog={getByRole:vi.fn(()=>control),getByLabel:vi.fn(()=>{throw new Error('Legacy label selector must not be used for selection');})};
    await selectFixtureProject(dialog,'owned-project');
    expect(dialog.getByRole).toHaveBeenCalledWith('combobox',{name:'Project',exact:true});expect(control.selectOption).toHaveBeenCalledWith('owned-project');expect(dialog.getByLabel).not.toHaveBeenCalled();
    control.count.mockResolvedValue(0);await expect(selectFixtureProject(dialog,'owned-project')).rejects.toThrow();expect(control.selectOption).toHaveBeenCalledTimes(1);
    control.count.mockResolvedValue(1);control.inputValue.mockResolvedValue('different-project');await expect(selectFixtureProject(dialog,'owned-project')).rejects.toThrow();
  });
  it('records only safe counts, enabled flags, own-option presence and whitelisted error codes before actions',async()=>{
    const open={count:async()=>1,isEnabled:async()=>true,click:vi.fn()};const submit={count:async()=>1,isEnabled:async()=>false,click:vi.fn()};
    const control={count:async()=>1,locator:()=>({evaluateAll:async(_fn:unknown,id:string)=>id==='owned-project'}),selectOption:vi.fn()};
    const dialog={count:async()=>1,getByRole:(_role:string,options:{name:string})=>options.name==='Project'?control:submit,getByLabel:(name:string)=>({count:async()=>name==='Title'?1:0})};
    const page={url:()=> 'http://127.0.0.1:51781/',getByRole:()=>dialog,locator:()=>({count:async()=>1})};
    const board={getByRole:(_role:string,options?:{name:string})=>options?.name==='New task'?open:{count:async()=>0},locator:()=>({allTextContents:async()=>['CLIENT_ERROR','http://invalid/?token=SYNTHETIC_SECRET']})};
    const result=await taskUiCheckpoint(page,board,'owned-project');
    expect(result).toMatchObject({newTaskCount:1,newTaskEnabled:true,dialogCount:1,titleCount:1,projectRoleCount:1,legacyExactProjectLabelCount:0,fixtureOptionPresent:true,createCount:1,createEnabled:false,feedErrorVisible:true,pluginErrorCodes:['CLIENT_ERROR','UNCLASSIFIED_PLUGIN_ERROR']});
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');expect(open.click).not.toHaveBeenCalled();expect(submit.click).not.toHaveBeenCalled();expect(control.selectOption).not.toHaveBeenCalled();
  });
  it('refuses checkpoint DOM inspection before a clean authenticated redirect',async()=>{
    const inspect=vi.fn();await expect(taskUiCheckpoint({url:()=> 'http://127.0.0.1:51781/?token=SYNTHETIC_SECRET',getByRole:inspect},{},'owned-project')).rejects.toThrow();expect(inspect).not.toHaveBeenCalled();
    expect(safePluginCode('CLIENT_ERROR')).toBe('CLIENT_ERROR');expect(safePluginCode('secret navigation message')).toBe('UNCLASSIFIED_PLUGIN_ERROR');
  });
});
describe('bounded no-tool model budget and sanitized evidence',()=>{
  it('caps short requests at three and long requests at one; reserve happens before uncertain delivery',()=>{
    const budget=modelBudget();budget.reserve('short');budget.reserve('short');budget.reserve('short');budget.reserve('long');
    expect(budget.snapshot()).toEqual({short:3,long:1});expect(()=>budget.reserve('short')).toThrow(NativeUatFailure);expect(()=>budget.reserve('long')).toThrow(NativeUatFailure);expect(()=>budget.reserve('unknown')).toThrow(NativeUatFailure);
  });
  it('uses the verified native composer marker rather than a fake input or native message append',()=>{
    expect(EDITOR).toBe('[data-composer-input][role="textbox"][contenteditable="true"]');
  });
  it('never emits secret navigation exception text or a fabricated approval pass',async()=>{
    const secret='http://127.0.0.1:51781/?token=SYNTHETIC_SECRET_NEVER_REPORT';
    const before={interrupt:process.listenerCount('SIGINT'),terminate:process.listenerCount('SIGTERM')};
    const result=await runVerification(authorized(),{env:{},loadPlaywright:vi.fn(async()=>{throw new Error(secret);}),nonce:()=> 'abcdef123456'});
    expect(result.ok).toBe(false);expect(result.stage).toBe('dependency');expect(result.approval.status).toBe('not-tested');expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
    expect(process.listenerCount('SIGINT')).toBe(before.interrupt);expect(process.listenerCount('SIGTERM')).toBe(before.terminate);
    const safe=safeReport({ok:false,stage:secret,rawError:secret,authenticatedUrl:secret,cookies:secret,storageState:secret});
    expect(safe.stage).toBe('arguments');expect(JSON.stringify(safe)).not.toContain('SYNTHETIC_SECRET');expect(safe.approval.status).toBe('not-tested');
  });
});
