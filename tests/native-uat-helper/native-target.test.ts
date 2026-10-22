import {afterEach,describe,expect,it,vi} from 'vitest';
// @ts-expect-error Standalone Node-native acceptance helper intentionally has no TypeScript build step.
import {EDITOR,NativeUatFailure,nativeTargetCheckpoint,submitNativeMessage} from '../../scripts/verify-native-conversations.mjs';
const authorized={allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true,timeoutMs:1000,modelTimeoutMs:1000};
afterEach(()=>vi.useRealTimers());
// No browser, native RPC, model, authentication or filesystem calls: synthetic DOM locator contracts only.
function fixture(){
  const state={actual:'fixture-A',phase:'active',editable:true,visible:true,contents:1};
  const fill=vi.fn(),send=vi.fn(),reserve=vi.fn(),selectors:string[]=[];let afterFill:(()=>void)|undefined;
  const frame={count:async()=>1,locator:vi.fn((selector:string)=>{
    selectors.push(selector);
    if(selector==='[data-conversation-content]')return{count:async()=>state.contents,getAttribute:async(name:string)=>name==='data-conversation-session'?state.actual:state.phase};
    const raw=selector.match(/^\[data-conversation-content\]\[data-conversation-session=(.+)\]$/)?.[1];if(!raw)throw new Error('Unexpected locator');const expected=JSON.parse(raw) as string;
    return{locator:(editor:string)=>{if(editor!==EDITOR)throw new Error('Not the real native editor');return{count:async()=>state.actual===expected&&state.editable?1:0,isVisible:async()=>state.visible,isEditable:async()=>state.editable,fill:async(text:string)=>{if(state.actual!==expected||!state.editable)throw new Error('Wrong Session fill refused');fill(text);afterFill?.();}};},getByRole:(role:string,options:{name:string;exact:boolean})=>{if(role!=='button'||options.name!=='Send message'||!options.exact)throw new Error('Not native Send');return{click:async()=>{if(state.actual!==expected)throw new Error('Wrong Session Send refused');send(expected);}};}};
  })};
  return{state,frame,fill,send,reserve,selectors,onFill:(callback:()=>void)=>{afterFill=callback;}};
}
describe('published native Session DOM identity gates every model submission',()=>{
  it('requires the matching published session marker and one editable visible native editor',async()=>{
    const f=fixture();const checkpoint=await nativeTargetCheckpoint(f.frame,'fixture-A');expect(checkpoint).toMatchObject({sessionMatch:true,phase:'active',phaseActive:true,editorCount:1,editorVisible:true,editable:true,ready:true});
    await submitNativeMessage(authorized,f.frame,'fixture-A','Owned nonce prompt',1000,f.reserve);
    expect(f.fill).toHaveBeenCalledWith('Owned nonce prompt');expect(f.reserve).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledWith('fixture-A');
    expect(f.selectors.filter(selector=>selector.includes('data-conversation-session='))).toEqual(expect.arrayContaining(['[data-conversation-content][data-conversation-session="fixture-A"]']));
  });
  it.each(['fixture-C','stale-fixture-B',''])('refuses stale/mismatched native marker %s before Fill or Send',async actual=>{
    vi.useFakeTimers();const f=fixture();f.state.actual=actual;
    const rejected=expect(submitNativeMessage(authorized,f.frame,'fixture-A','Never send',1000,f.reserve)).rejects.toBeInstanceOf(NativeUatFailure);
    await vi.advanceTimersByTimeAsync(1200);await rejected;expect(f.fill).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
  });
  it('refuses a matching but workspace-disabled/read-only composer',async()=>{
    vi.useFakeTimers();const f=fixture();f.state.editable=false;f.state.phase='hero';expect(await nativeTargetCheckpoint(f.frame,'fixture-A')).toMatchObject({sessionMatch:true,phase:'hero',phaseActive:false,editable:false,ready:false});
    const rejected=expect(submitNativeMessage(authorized,f.frame,'fixture-A','Never send',1000,f.reserve)).rejects.toBeInstanceOf(NativeUatFailure);await vi.advanceTimersByTimeAsync(1200);await rejected;expect(f.fill).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  });
  it('rechecks the marker after Fill and refuses Send if the native subtree retargeted to C',async()=>{
    vi.useFakeTimers();const f=fixture();f.onFill(()=>{f.state.actual='fixture-C';});
    const rejected=expect(submitNativeMessage(authorized,f.frame,'fixture-A','Unsent A draft',1000,f.reserve)).rejects.toBeInstanceOf(NativeUatFailure);await vi.advanceTimersByTimeAsync(1200);await rejected;
    expect(f.fill).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
  });
  it('keeps the actual Send locator session-addressed even if DOM retargets after the last check',async()=>{
    const f=fixture();await expect(submitNativeMessage(authorized,f.frame,'fixture-A','Unsent A draft',1000,()=>{f.state.actual='fixture-C';})).rejects.toThrow('Wrong Session Send refused');expect(f.fill).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
  });
  it('reports only safe phase/match booleans, never an unexpected Session ID or arbitrary attribute text',async()=>{
    const f=fixture();f.state.actual='UNRELATED_PRIVATE_SESSION';f.state.phase='http://invalid/?token=SYNTHETIC_SECRET';const checkpoint=await nativeTargetCheckpoint(f.frame,'fixture-A');
    expect(checkpoint.sessionMatch).toBe(false);expect(checkpoint.phase).toBe('unknown');expect(JSON.stringify(checkpoint)).not.toContain('PRIVATE_SESSION');expect(JSON.stringify(checkpoint)).not.toContain('SYNTHETIC_SECRET');
    f.state.contents=2;expect((await nativeTargetCheckpoint(f.frame,'fixture-A')).ready).toBe(false);
  });
  it('rechecks all explicit permissions before touching the supplied native DOM',async()=>{
    const f=fixture();await expect(submitNativeMessage({...authorized,allowModelRequests:false},f.frame,'fixture-A','Never send',1000,f.reserve)).rejects.toBeInstanceOf(NativeUatFailure);expect(f.frame.locator).not.toHaveBeenCalled();expect(f.fill).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  });
});
