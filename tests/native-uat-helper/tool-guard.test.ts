import {describe,expect,it,vi} from 'vitest';
import {Context} from '@deepseek-ai/cordis';
import {ToolRuntime,type ToolGuard,type ToolExecutionInput} from '@deepseek-ai/dsh-tools';
import type {Agent} from '@deepseek-ai/dsh-agent';
// @ts-expect-error Standalone Node-native acceptance helper intentionally has no TypeScript build step.
import {installFixtureToolGuard} from '../../scripts/verify-native-conversations.mjs';
const ids=['fixture-a','fixture-b','fixture-c'];
const cwd='/isolated/g2/project';
const authorization={allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true};
function fixture(realTools?:ToolRuntime){
  const callbacks=new Map<string,ToolGuard>();const removers=new Map<string,ReturnType<typeof vi.fn>>();
  const members=new Map(ids.map(id=>[id,{id,status:'idle',ctx:{get:vi.fn((name:string)=>{
    if(name!=='tools')return undefined;
    if(realTools)return realTools;
    return{guard:vi.fn((callback:ToolGuard)=>{callbacks.set(id,callback);const dispose=vi.fn(()=>{callbacks.delete(id);});removers.set(id,dispose);return dispose;})};
  })}}]));
  const inspect=vi.fn(async(id:string)=>({meta:{id,cwd}}));
  const agents={get:(id:string)=>members.get(id)};
  const waterfall=vi.fn(async()=>[] as unknown[]);
  const host={get:vi.fn((name:string)=>name==='agents'?agents:name==='sessionController'?{inspect}:undefined),waterfall};
  return{host,members,callbacks,removers,inspect,waterfall};
}
function execution(id?:string){return{agent:id?{id}:undefined} as unknown as Parameters<ToolGuard>[0];}
describe('authorized fixture-only public tool execution guard',()=>{
  it('requires all three permissions before looking up or changing any public native service',async()=>{
    const f=fixture();for(const key of Object.keys(authorization))await expect(installFixtureToolGuard.call(f.host,{...authorization,[key]:false},ids,cwd)).rejects.toThrow('authorization');
    expect(f.host.get).not.toHaveBeenCalled();expect(f.callbacks.size).toBe(0);
  });
  it('registers only through each verified fixture Agent.ctx and leaves all unrelated identities unchanged',async()=>{
    const f=fixture();const guard=await installFixtureToolGuard.call(f.host,authorization,ids,cwd);
    expect(guard.snapshot()).toEqual({activated:true,blockedCounts:{'fixture-a':0,'fixture-b':0,'fixture-c':0}});
    expect(f.host.get.mock.calls.some(([name])=>name==='tools')).toBe(false);
    for(const [id,agent] of f.members){expect(agent.ctx.get).toHaveBeenCalledWith('tools');const check=f.callbacks.get(id)!;expect(check(execution('unrelated-user'))).toBeUndefined();expect(check(execution())).toBeUndefined();expect(check(execution(ids.find(other=>other!==id)))).toBeUndefined();expect(check(execution(id))).toBe('Model tool execution is disabled for this isolated native G2 fixture.');}
    expect(guard.snapshot().blockedCounts).toEqual({'fixture-a':1,'fixture-b':1,'fixture-c':1});
    await guard.dispose();expect(guard.snapshot().activated).toBe(false);for(const release of f.removers.values())expect(release).toHaveBeenCalledOnce();
    await guard.dispose();for(const release of f.removers.values())expect(release).toHaveBeenCalledOnce();
  });
  it('fails the public scope/ownership precondition instead of installing a broad fallback',async()=>{
    const f=fixture();f.inspect.mockImplementation(async id=>({meta:{id,cwd:id===ids[1]?'/other-user-project':cwd}}));
    await expect(installFixtureToolGuard.call(f.host,authorization,ids,cwd)).rejects.toThrow('scope');expect(f.callbacks.size).toBe(0);
    const missing=fixture();missing.members.get(ids[1]!)!.ctx.get.mockReturnValue(undefined);
    await expect(installFixtureToolGuard.call(missing.host,authorization,ids,cwd)).rejects.toThrow('guard');expect(missing.callbacks.size).toBe(0);
    for(const input of[[],[ids[0],ids[0],ids[2]],[...ids,'unrelated-user']])await expect(installFixtureToolGuard.call(f.host,authorization,input,cwd)).rejects.toThrow('ownership');
  });
  it('retains every denial until all owned native models and activity are idle',async()=>{
    const f=fixture();const guard=await installFixtureToolGuard.call(f.host,authorization,ids,cwd);
    f.members.get('fixture-a')!.status='running';await expect(guard.dispose()).rejects.toThrow('model is active');expect(f.callbacks.size).toBe(3);
    f.members.get('fixture-a')!.status='idle';f.waterfall.mockResolvedValueOnce([{kind:'job'}]);await expect(guard.dispose()).rejects.toThrow('work is active');expect(f.callbacks.size).toBe(3);
    await guard.dispose();expect(f.callbacks.size).toBe(0);expect(guard.snapshot().activated).toBe(false);
    for(const args of f.waterfall.mock.calls as unknown as Array<[string,{sessionId:string},unknown]>)expect(ids).toContain(args[1].sessionId);
  });
  it('rolls back earlier scoped registrations if a later public guard registration fails',async()=>{
    const f=fixture();f.members.get('fixture-b')!.ctx.get.mockReturnValue({guard:vi.fn(()=>{throw new Error('guard unavailable');})});
    await expect(installFixtureToolGuard.call(f.host,authorization,ids,cwd)).rejects.toThrow('guard unavailable');
    expect(f.callbacks.size).toBe(0);expect(f.removers.get('fixture-a')).toHaveBeenCalledOnce();
  });
  it('actually denies the published ToolRuntime body before dispatch, but passes through other user IDs',async()=>{
    const root=new Context();root.provide('systemPrompt',{tools:()=>()=>{}});const tools=new ToolRuntime(root);let bodies=0;
    const unregister=tools.register({name:'g2_guard_probe',description:'In-memory test only',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},render:()=>[{type:'text',text:'ok'}]},execute:async()=>{bodies++;return{ok:true};}});
    const f=fixture(tools);const guard=await installFixtureToolGuard.call(f.host,authorization,ids,cwd);
    const call=(id:string):ToolExecutionInput=>({callId:('call-'+id) as ToolExecutionInput['callId'],name:'g2_guard_probe',arguments:{},signal:new AbortController().signal,agent:{id,ctx:root} as unknown as Agent});
    try{
      const denied=await tools.execute(call('fixture-a'));expect(denied.isError).toBe(true);expect(bodies).toBe(0);expect(guard.snapshot().blockedCounts['fixture-a']).toBe(1);
      const allowed=await tools.execute(call('unrelated-user'));expect(allowed.isError).not.toBe(true);expect(bodies).toBe(1);
      await guard.dispose();await tools.execute(call('fixture-a'));expect(bodies).toBe(2);
    }finally{await guard.dispose();unregister();}
  });
});
