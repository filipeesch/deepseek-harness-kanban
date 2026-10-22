import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error Standalone Node-native verification script intentionally has no TypeScript build step.
import {GUI_URL, BOARD_SELECTOR, NATIVE_DIALOG_SELECTOR} from '../../scripts/live-verify.mjs';
// @ts-expect-error Standalone Node-native verification script intentionally has no TypeScript build step.
import {NATIVE_PANELS, main, parseArgs, runLifecycle, verifyCurrentArtifact} from '../../scripts/live-lifecycle.mjs';

afterEach(() => {vi.useRealTimers();vi.restoreAllMocks();});
const syntheticLogin=GUI_URL+'?token='+'synthetic_lifecycle_login_fixture_123456789012';
const options=()=>({allowOwnerTest:true,timeoutMs:1000});
function fixture() {
  const events:string[]=[];
  const flags={selected:true,active:true,advertised:true,panelSelected:false,preview:false,autoSelect:false,
    keepEntry:false,loseNativeWhenOff:false,offRestart:false,failFirstEnable:false,hangDisable:false,
    failRestore:false,failStateReadNumber:0};
  let currentUrl='about:blank',stateReads=0,enables=0;
  const manager={
    listBundles:vi.fn(async()=>{stateReads++;events.push('state:'+flags.selected);if(stateReads===flags.failStateReadNumber)throw new Error(syntheticLogin);return [{name:'dsh-kanban',enabled:flags.selected,version:'0.1.0'}];}),
    listPlugins:vi.fn(async()=>flags.active?[{moduleName:'dsh-kanban',enabled:true,fiberPhase:'active'}]:[]),
    setBundleEnabled:vi.fn(async(name:string,enabled:boolean):Promise<any>=>{
      if(name!=='dsh-kanban')throw new Error('Unexpected target');events.push('change:'+enabled);
      if(!enabled&&flags.hangDisable)return new Promise(()=>{});
      if(enabled){enables++;if(flags.failRestore||(flags.failFirstEnable&&enables===1))return {application:'failed',changed:false,error:{code:'operation-error',diagnostic:syntheticLogin},warnings:[]};}
      flags.selected=enabled;
      if(!enabled&&flags.offRestart)return {application:'restart-required',restartReason:'host-module',changed:true,warnings:[syntheticLogin]};
      flags.active=enabled;flags.advertised=enabled;
      return {application:'applied',changed:true,warnings:[syntheticLogin]};
    }),
  };
  const modules={graph:()=>({entries:flags.advertised?[{id:'dsh-kanban',rev:'123456789abc'}]:[]}),artifactBaseline:()=>flags.advertised?{path:'/fixture/lib/client.js',size:10,mtimeMs:1,ctimeMs:2}:undefined};
  const owner={get:(key:string)=>key==='pluginManager'?manager:key==='clientModules'?modules:key==='connection'?{authenticatedUrl:(base:string)=>{expect(base).toBe(GUI_URL);events.push('official-owner-login');return syntheticLogin;}}:undefined};
  const client={call:vi.fn(async()=>({})),close:vi.fn(async()=>{events.push('inspector-close');})};
  const hostCall=vi.fn(async(_client:unknown,declaration:string,args:unknown[]=[])=>{
    const fn=new Function('return ('+declaration+')')();return fn.apply(owner,args);
  });
  const proceed={count:vi.fn(async()=>1),click:vi.fn(async()=>{flags.preview=false;events.push('preview-continue');})};
  const notice={count:vi.fn(async()=>flags.preview?1:0),getByRole:vi.fn(()=>proceed),waitFor:vi.fn(async({state}:{state:string})=>{
    if(state==='visible'&&!flags.preview)throw Object.assign(new Error('Optional known preview absent'),{name:'TimeoutError'});
    if(state==='hidden'&&flags.preview)throw new Error();
  })};
  const dialogs={filter:vi.fn(()=>notice)},nativeDialogs={count:vi.fn(async()=>flags.preview?1:0)};
  const heading={waitFor:vi.fn(async()=>{})};
  const column={waitFor:vi.fn(async()=>{}),count:vi.fn(async()=>1)};
  const columns={filter:vi.fn(()=>column),count:vi.fn(async()=>5)};
  const board={
    isVisible:vi.fn(async()=>flags.autoSelect||(flags.advertised&&flags.panelSelected)),count:vi.fn(async()=>1),
    waitFor:vi.fn(async({state}:{state:string})=>{events.push('board:'+state);if((state==='visible')!==Boolean(flags.advertised&&flags.panelSelected))throw new Error();}),
    getByRole:vi.fn((role:string)=>role==='alert'?{count:async()=>0}:heading),locator:vi.fn(()=>columns),
    screenshot:vi.fn(async()=>{events.push('screenshot');if(flags.preview||!flags.active||currentUrl!==GUI_URL)throw new Error();}),
  };
  const kanban={count:vi.fn(async()=>flags.advertised||flags.keepEntry?1:0),
    waitFor:vi.fn(async({state}:{state:string})=>{events.push('kanban:'+state);if((state==='visible')!==Boolean(flags.advertised||flags.keepEntry))throw new Error();}),
    click:vi.fn(async()=>{if(!flags.advertised||flags.preview)throw new Error();flags.panelSelected=true;events.push('kanban-click');}),
  };
  const nativeButtons=new Map<string,{count:ReturnType<typeof vi.fn>;waitFor:ReturnType<typeof vi.fn>}>(NATIVE_PANELS.map((label:string)=>[label,{count:vi.fn(async()=>1),waitFor:vi.fn(async()=>{events.push('native:'+label+':'+flags.selected);if(flags.loseNativeWhenOff&&!flags.selected)throw new Error();})}]));
  const page={
    goto:vi.fn(async()=>{currentUrl=GUI_URL;events.push('login-navigation');}),waitForURL:vi.fn(async(fn:(url:URL)=>boolean)=>{if(!fn(new URL(currentUrl)))throw new Error();}),url:vi.fn(()=>currentUrl),
    getByRole:vi.fn((role:string,options:any={})=>role==='dialog'?dialogs:role==='button'?(typeof options.name==='string'?nativeButtons.get(options.name):kanban):heading),
    locator:vi.fn((selector:string)=>selector===BOARD_SELECTOR?board:selector===NATIVE_DIALOG_SELECTOR?nativeDialogs:undefined),
    close:vi.fn(async()=>{events.push('page-close');}),
  };
  const context={setDefaultTimeout:vi.fn(),setDefaultNavigationTimeout:vi.fn(),route:vi.fn(async(_pattern:string,_handler:any)=>{}),newPage:vi.fn(async()=>page),close:vi.fn(async()=>{events.push('context-close');})};
  const browser={newContext:vi.fn(async()=>context),close:vi.fn(async()=>{events.push('browser-close');})};
  const chromium={launch:vi.fn(async()=>browser)};
  const dependencies={env:{},loadPlaywright:vi.fn(async()=>({chromium})),connect:vi.fn(async()=>client),hostCall,
    verifyArtifact:vi.fn(async()=>({clientSha256:'1'.repeat(64),clientRevision:'123456789abc'})),
    prepareScreenshot:vi.fn(async()=>({absolute:'/memory/.verification/lifecycle.png',relative:'.verification/lifecycle.png'})),
  };
  return {events,flags,manager,modules,owner,client,hostCall,proceed,notice,board,kanban,nativeButtons,page,context,browser,chromium,dependencies};
}

describe('explicit guard and current source preflight',()=>{
  it('allows help without connecting or mutating',async()=>{expect(await main(['--help'])).toHaveProperty('help');});
  it('requires explicit owner authorization before any dependency/network/browser access',async()=>{
    const f=fixture();const result=await runLifecycle({timeoutMs:1000},f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'owner-authorization',disableRequested:false});
    expect(f.dependencies.loadPlaywright).not.toHaveBeenCalled();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it.each([['--allow-owner-test','--bundle','other'],['--allow-owner-test','--url',syntheticLogin],['--allow-owner-test','--endpoint','http://127.0.0.1:9999'],['--allow-owner-test','--timeout-ms','0']])('rejects target/origin/timeout overrides %j',(...args)=>{expect(()=>parseArgs(args)).toThrow();});
  it.each(['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'])('rejects %s before importing Playwright',async key=>{
    const f=fixture();f.dependencies.env={[key]:'enabled'};
    expect(await runLifecycle(options(),f.dependencies)).toMatchObject({ok:false,failedStage:'debug-guard'});expect(f.dependencies.loadPlaywright).not.toHaveBeenCalled();
  });
  it('refuses an initially disabled/inactive own bundle without logging in or changing it',async()=>{
    const f=fixture();f.flags.selected=false;f.flags.active=false;f.flags.advertised=false;
    expect(await runLifecycle(options(),f.dependencies)).toMatchObject({ok:false,failedStage:'initial-state',disableRequested:false});
    expect(f.chromium.launch).not.toHaveBeenCalled();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('refuses a stale linked artifact before browser/auth or profile changes',async()=>{
    const f=fixture();f.dependencies.verifyArtifact.mockRejectedValue(new Error(syntheticLogin));
    const result=await runLifecycle(options(),f.dependencies);expect(result.failedStage).toBe('current-artifact');
    expect(f.chromium.launch).not.toHaveBeenCalled();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('compares the public host baseline to local linked artifact metadata and emits only a digest',async()=>{
    const io={realpath:vi.fn(async(path:string)=>path.endsWith('lib/client.js')?'/fixture/lib/client.js':'/fixture'),stat:vi.fn(async()=>({size:10,mtimeMs:1,ctimeMs:2})),readFile:vi.fn(async()=>Buffer.from('client-code'))};
    const state={clientArtifact:{path:'/fixture/lib/client.js',size:10,mtimeMs:1,ctimeMs:2},clientRevision:'123456789abc'};
    const digest=await verifyCurrentArtifact(state,io);expect(digest.clientSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(digest.clientRevision).toBe('123456789abc');expect(JSON.stringify(digest)).not.toContain('client-code');
    await expect(verifyCurrentArtifact({...state,clientArtifact:{...state.clientArtifact,size:999}},io)).rejects.toThrow();
  });
});

describe('supported own-plugin lifecycle and native coexistence (in-memory doubles only)',()=>{
  it('performs exact public ownbundle false→true, proves UI withdrawal/return, and leaves initial enabled state',async()=>{
    const f=fixture();f.flags.preview=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:true,startupUnchanged:true,previewAcknowledged:true,nativeBefore:true,nativeWhileDisabled:true,nativeAfter:true,entryWithdrawn:true,regionWithdrawn:true,entryReturned:true,
      off:{application:'applied',enabled:false},on:{application:'applied',enabled:true},restoration:{required:true,attempted:false,verified:true}});
    expect(f.manager.setBundleEnabled.mock.calls).toEqual([['dsh-kanban',false],['dsh-kanban',true]]);
    expect(f.flags).toMatchObject({selected:true,active:true,advertised:true});expect(f.kanban.click).toHaveBeenCalledTimes(2);
    expect(f.events).toContain('kanban:hidden');expect(f.events).toContain('board:hidden');
    for(const label of NATIVE_PANELS){expect(f.events).toContain('native:'+label+':false');expect(f.nativeButtons.get(label)?.waitFor).toHaveBeenCalledTimes(3);}
    expect(f.proceed.click).toHaveBeenCalledOnce();expect(f.board.screenshot).toHaveBeenCalledOnce();
    expect(result.screenshot).toBe('.verification/lifecycle.png');expect(result.scope).toContain('NOT existing Desktop renderer');
    expect(JSON.stringify(result)).not.toContain('synthetic_lifecycle');expect(JSON.stringify(result)).not.toContain('token=');
    expect(result.off.warningCount).toBe(1);expect(result.off.warnings).toEqual(['Profile reconciliation reported warnings; inspect native Plugins for details.']);
    expect(f.events.slice(-4)).toEqual(['page-close','context-close','browser-close','inspector-close']);
  });
  it('checks startup unchanged before any Kanban click or bundle change',async()=>{
    const f=fixture();f.flags.autoSelect=true;
    const result=await runLifecycle(options(),f.dependencies);expect(result.failedStage).toBe('startup-selection');
    expect(f.kanban.click).not.toHaveBeenCalled();expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('does not touch the bundle when native fixed panels are missing before the test',async()=>{
    const f=fixture();f.nativeButtons.get('Plugins')?.waitFor.mockRejectedValue(new Error());
    expect(await runLifecycle(options(),f.dependencies)).toMatchObject({ok:false,failedStage:'native-before',disableRequested:false});
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();
  });
  it('restores ownbundle true when native coexistence fails while disabled',async()=>{
    const f=fixture();f.flags.loseNativeWhenOff=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'native-disabled',restoration:{required:true,attempted:true,verified:true}});
    expect(f.manager.setBundleEnabled.mock.calls).toEqual([['dsh-kanban',false],['dsh-kanban',true]]);
    expect(f.board.screenshot).not.toHaveBeenCalled();expect(f.flags.selected).toBe(true);
  });
  it('restores ownbundle true when UI entry fails to withdraw',async()=>{
    const f=fixture();f.flags.keepEntry=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'ui-withdrawal',restoration:{attempted:true,verified:true}});
    expect(f.manager.setBundleEnabled.mock.calls.at(-1)).toEqual(['dsh-kanban',true]);
  });
  it('honors restart-required, reports only safe metadata, restores desired true, never restarts',async()=>{
    const f=fixture();f.flags.offRestart=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'disable-application',off:{application:'restart-required',restartReason:'host-module'},restoration:{attempted:true,verified:true}});
    expect(f.board.screenshot).not.toHaveBeenCalled();expect(f.flags.selected).toBe(true);
    expect(f.manager.setBundleEnabled.mock.calls.every(([name])=>name==='dsh-kanban')).toBe(true);
  });
  it('tries restoration after a failed main enable, not falsely reporting lifecycle success',async()=>{
    const f=fixture();f.flags.failFirstEnable=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'enable-application',on:{application:'failed',errorCode:'operation-error'},restoration:{attempted:true,verified:true}});
    expect(f.manager.setBundleEnabled.mock.calls).toEqual([['dsh-kanban',false],['dsh-kanban',true],['dsh-kanban',true]]);
    expect(JSON.stringify(result)).not.toContain('synthetic_lifecycle');
  });
  it('reports unrestored state concretely without retries/restarts if public true restoration fails',async()=>{
    const f=fixture();f.flags.loseNativeWhenOff=true;f.flags.failRestore=true;
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,restoration:{required:true,attempted:true,verified:false,after:{selected:false,active:false}}});
    expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);expect(f.flags.selected).toBe(false);
  });
});

describe('artifact race and restoration-domain outcomes',()=>{
  it('rejects a build that changes while reading the client fingerprint',async()=>{
    const io={realpath:vi.fn(async(path:string)=>path.endsWith('lib/client.js')?'/fixture/lib/client.js':'/fixture'),
      stat:vi.fn().mockResolvedValueOnce({size:10,mtimeMs:1,ctimeMs:2}).mockResolvedValueOnce({size:11,mtimeMs:3,ctimeMs:4}),readFile:vi.fn(async()=>Buffer.from('changed-client'))};
    await expect(verifyCurrentArtifact({clientArtifact:{path:'/fixture/lib/client.js',size:10,mtimeMs:1,ctimeMs:2},clientRevision:'123456789abc'},io)).rejects.toThrow();
  });
  it('reports a restoration restart requirement even if desired state reads true afterward',async()=>{
    const f=fixture(),implementation=f.manager.setBundleEnabled.getMockImplementation()!;
    f.manager.setBundleEnabled.mockImplementation(async(name:string,enabled:boolean)=>{
      const result=await implementation(name,enabled);
      return enabled&&f.manager.setBundleEnabled.mock.calls.length===3?{...result,application:'restart-required',restartReason:'host-module'}:result;
    });
    f.dependencies.prepareScreenshot.mockImplementation(async()=>{f.flags.selected=false;return {absolute:'/memory/.verification/lifecycle.png',relative:'.verification/lifecycle.png'};});
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'restore',restoration:{attempted:true,verified:true,change:{application:'restart-required',restartReason:'host-module'}}});
    expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(3);
  });
});

describe('timeout ambiguity, quiet auth and resource cleanup',()=>{
  it('inspects status BEFORE compensating a timed-out disable even if status still looks initially active',async()=>{
    vi.useFakeTimers();const f=fixture();f.flags.hangDisable=true;
    const pending=runLifecycle(options(),f.dependencies);await vi.advanceTimersByTimeAsync(1000);const result=await pending;
    expect(result).toMatchObject({ok:false,failedStage:'disable',restoration:{uncertainRequest:true,attempted:true,verified:true}});
    const compensation=f.events.indexOf('change:true');expect(compensation).toBeGreaterThan(f.events.indexOf('change:false'));
    expect(f.events[compensation-1]).toBe('state:true');expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('can reconnect once for restoration metadata, without busy polling or additional toggles',async()=>{
    const f=fixture();f.flags.failStateReadNumber=4;
    const second={call:vi.fn(async()=>({})),close:vi.fn(async()=>{})};
    f.dependencies.connect.mockResolvedValueOnce(f.client).mockResolvedValueOnce(second);
    const result=await runLifecycle(options(),f.dependencies);
    expect(result.ok).toBe(true);expect(result.restoration.verified).toBe(true);
    expect(f.dependencies.connect).toHaveBeenCalledTimes(2);expect(second.close).toHaveBeenCalledOnce();expect(f.client.close).toHaveBeenCalledOnce();
    expect(f.manager.setBundleEnabled).toHaveBeenCalledTimes(2);
  });
  it('uses private official owner login on pinned origin and ephemeral context only',async()=>{
    const f=fixture();const result=await runLifecycle(options(),f.dependencies);
    expect(result.ok).toBe(true);expect(f.events).toContain('official-owner-login');
    expect(f.page.goto).toHaveBeenCalledWith(syntheticLogin,{waitUntil:'domcontentloaded',timeout:1000});
    expect(f.browser.newContext).toHaveBeenCalledWith({viewport:{width:1920,height:1000},acceptDownloads:false,serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light',locale:'en-US'});
    expect(f.dependencies.connect).toHaveBeenCalledWith({endpoint:'http://127.0.0.1:9230',timeoutMs:1000});
    expect(JSON.stringify(result)).not.toContain('token=');
  });
  it('sanitizes navigation failures and never toggles or captures evidence before clean login',async()=>{
    const f=fixture();f.page.goto.mockRejectedValue(new Error(syntheticLogin));
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'owner-login',disableRequested:false});
    expect(f.manager.setBundleEnabled).not.toHaveBeenCalled();expect(f.board.screenshot).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('synthetic_lifecycle');expect(f.client.close).toHaveBeenCalledOnce();
  });
  it('cleans every resource even if one browser close fails, preserving restored bundle state',async()=>{
    const f=fixture();f.page.close.mockRejectedValue(new Error(syntheticLogin));
    const result=await runLifecycle(options(),f.dependencies);
    expect(result).toMatchObject({ok:false,failedStage:'cleanup',restoration:{verified:true}});
    expect(f.context.close).toHaveBeenCalledOnce();expect(f.browser.close).toHaveBeenCalledOnce();expect(f.client.close).toHaveBeenCalledOnce();
  });
});
