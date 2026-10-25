import {describe,expect,it,vi} from 'vitest';
import {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {SessionId} from '@deepseek-ai/dsh-session';
import {registerTaskExecutionGuards} from '../../src/index.js';
import {KanbanError} from '../../src/shared/errors.js';
type Config=Parameters<Context['llm']['prepareCall']>[0];
function fixture(){
  const ctx=new Context();
  const task={sessionIds:['bound'],operation:undefined as {phase:string}|undefined};
  const store={bySession:(id:string)=>id==='bound'?{task}:undefined} as never;
  const directory={expected:'/ready-tree/packages/api',actual:'/ready-tree/packages/api',exists:true};
  const assertExecutionContext=vi.fn(async(id:string)=>{if(!directory.exists)throw new KanbanError('SESSION_CONTEXT_UNAVAILABLE','Expected tree disappeared.');if(id==='bound'&&directory.actual!==directory.expected)throw new KanbanError('CONTEXT_MISMATCH','Native recovery changed the directory.');});
  const dispose=registerTaskExecutionGuards(ctx,store,{assertExecutionContext});
  const signal=new AbortController();const agent={id:SessionId('bound')} as Agent;
  const payload={agent,turn:1,step:1,signal:signal.signal};
  const config={provider:'test-provider',model:'test-model'} as Config;
  const prepare=vi.fn(async()=>config),model=vi.fn();
  const request=async()=>{const result=await ctx.waterfall('agent/request',payload,prepare);model(result);return result;};
  const step=()=>ctx.waterfall('agent/pre-step',{...payload,messages:[]},async()=>({kind:'enter' as const,messages:[]}));
  return{ctx,task,directory,assertExecutionContext,dispose,signal,payload,config,prepare,model,request,step};
}
describe('public task-bound native execution admission hooks',()=>{
  it('validates both post-assembly step admission and request config admission without replacing config',async()=>{
    const f=fixture();expect((await f.step()).kind).toBe('enter');expect(await f.request()).toBe(f.config);
    expect(f.assertExecutionContext.mock.calls).toEqual([['bound'],['bound']]);expect(f.model).toHaveBeenCalledWith(f.config);f.dispose();
  });
  it('rejects native original-base recovery after assembly before any model invocation',async()=>{
    const f=fixture();
    // Pinned native WorkingDirectory.ensure runs in system-prompt/assemble BEFORE agent/pre-step.
    f.directory.exists=false;f.directory.actual='/original-base';
    await expect(f.step()).rejects.toMatchObject({code:'SESSION_CONTEXT_UNAVAILABLE'});
    expect(f.model).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();f.dispose();
  });
  it('checks after downstream request middleware, not only before a queued request reaches it',async()=>{
    const f=fixture();expect((await f.step()).kind).toBe('enter');
    f.ctx.on('agent/request',async(_payload,next)=>{const config=await next();f.directory.actual='/original-base';return config;});
    await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
    expect(f.prepare).toHaveBeenCalledOnce();expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('validates every model-request attempt, including a retry after the first valid attempt',async()=>{
    const f=fixture();await f.request();expect(f.model).toHaveBeenCalledOnce();
    f.directory.actual='/drifted-tree';await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
    expect(f.assertExecutionContext).toHaveBeenCalledTimes(2);expect(f.model).toHaveBeenCalledOnce();f.dispose();
  });
  it('does not inspect or restrict an unrelated native conversation',async()=>{
    const f=fixture();f.payload.agent={id:SessionId('unrelated')} as Agent;f.directory.exists=false;
    expect((await f.step()).kind).toBe('enter');expect(await f.request()).toBe(f.config);expect(f.assertExecutionContext).not.toHaveBeenCalled();f.dispose();
  });
  it.each(['prepared','switching','committing'])('preserves the existing %s context-operation phase guard at both boundaries',async phase=>{
    const f=fixture();f.task.operation={phase};expect((await f.step()).kind).toBe('reject');
    await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_OPERATION_PENDING'});expect(f.model).not.toHaveBeenCalled();expect(f.assertExecutionContext).not.toHaveBeenCalled();f.dispose();
  });
  it.each(['waiting','failed'])('preserves the existing %s phase behavior while still requiring the correct directory',async phase=>{
    const f=fixture();f.task.operation={phase};expect((await f.step()).kind).toBe('enter');await f.request();expect(f.assertExecutionContext).toHaveBeenCalledTimes(2);f.dispose();
  });
  it('rechecks a directory operation that started while the step validator awaited I/O',async()=>{
    const f=fixture();f.assertExecutionContext.mockImplementation(async()=>{f.task.operation={phase:'switching'};});
    expect((await f.step()).kind).toBe('reject');expect(f.prepare).not.toHaveBeenCalled();expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('rechecks a directory operation that started while the request validator awaited I/O',async()=>{
    const f=fixture();f.assertExecutionContext.mockImplementation(async()=>{f.task.operation={phase:'switching'};});
    await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_OPERATION_PENDING'});expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('honors cancellation before releasing validated task config to the loop',async()=>{
    const f=fixture();f.assertExecutionContext.mockImplementation(async()=>{f.signal.abort(new Error('Cancelled'));});
    await expect(f.request()).rejects.toThrow('Cancelled');expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('disposes both public listeners with plugin ownership',async()=>{
    const f=fixture();f.dispose();f.directory.exists=false;
    expect((await f.step()).kind).toBe('enter');await f.request();expect(f.assertExecutionContext).not.toHaveBeenCalled();
  });
});
