import {describe,expect,it,vi} from 'vitest';
import {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {SessionId} from '@deepseek-ai/dsh-session';
import {registerTaskExecutionGuards} from '../../src/index.js';
import {KanbanError} from '../../src/shared/errors.js';

type StreamOptions=Parameters<Context['llm']['stream']>[0];

function fixture(){
  const ctx=new Context();
  const task={sessionIds:['bound'],operation:undefined as {phase:string}|undefined};
  const store={bySession:(id:string)=>id==='bound'?{task}:undefined} as never;
  const directory={expected:'/ready-tree/packages/api',actual:'/ready-tree/packages/api',exists:true};
  const assertExecutionContext=vi.fn(async(id:string)=>{if(!directory.exists)throw new KanbanError('SESSION_CONTEXT_UNAVAILABLE','Expected tree disappeared.');if(id==='bound'&&directory.actual!==directory.expected)throw new KanbanError('CONTEXT_MISMATCH','Native recovery changed the directory.');});
  const dispose=registerTaskExecutionGuards(ctx,store,{assertExecutionContext});
  const signal=new AbortController();const agent={id:SessionId('bound')} as Agent;
  const payload={agent,turn:1,step:1,signal:signal.signal};
  const model=vi.fn();
  const prepare=vi.fn(async function*(){model();yield {type:'text',text:'ok'} as never;});
  const options=(sessionId:string,purpose?:StreamOptions['purpose']):StreamOptions=>({provider:'test-provider',model:'test-model',messages:[],sessionId:SessionId(sessionId),signal:signal.signal,...(purpose===undefined?{}:{purpose})});
  const request=async(sessionId='bound',purpose?:StreamOptions['purpose'])=>{const stream=await ctx.waterfall('llm/stream',options(sessionId,purpose),prepare);for await(const _chunk of stream){/* consume */}};
  const step=()=>ctx.waterfall('agent/pre-step',{...payload,messages:[]},async()=>({kind:'enter' as const,messages:[]}));
  return{ctx,task,directory,assertExecutionContext,dispose,signal,payload,options,prepare,model,request,step};
}

describe('public task-bound native execution admission hooks',()=>{
  it('validates both post-assembly step admission and model-stream admission without replacing the stream',async()=>{
    const f=fixture();expect((await f.step()).kind).toBe('enter');await f.request();
    expect(f.assertExecutionContext.mock.calls).toEqual([['bound'],['bound']]);expect(f.model).toHaveBeenCalledOnce();f.dispose();
  });
  it('rejects native original-base recovery after assembly before any model invocation',async()=>{
    const f=fixture();
    f.directory.exists=false;f.directory.actual='/original-base';
    await expect(f.step()).rejects.toMatchObject({code:'SESSION_CONTEXT_UNAVAILABLE'});
    expect(f.model).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();f.dispose();
  });
  it('checks after request-configuration middleware, not only before a queued request reaches it',async()=>{
    const f=fixture();expect((await f.step()).kind).toBe('enter');
    f.ctx.on('llm/stream',async function*(_options,next){f.directory.actual='/original-base';yield* next();},{prepend:true});
    await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
    expect(f.prepare).not.toHaveBeenCalled();expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('validates every model-stream attempt, including a retry after the first valid attempt',async()=>{
    const f=fixture();await f.request();expect(f.model).toHaveBeenCalledOnce();
    f.directory.actual='/drifted-tree';await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
    expect(f.assertExecutionContext).toHaveBeenCalledTimes(2);expect(f.model).toHaveBeenCalledOnce();f.dispose();
  });
  it('does not inspect or restrict an unrelated native conversation',async()=>{
    const f=fixture();
    await f.request('unrelated');
    expect(f.assertExecutionContext).not.toHaveBeenCalled();expect(f.model).toHaveBeenCalledOnce();f.dispose();
  });
  it('passes purpose-bearing auxiliary streams through unchanged',async()=>{
    const f=fixture();await f.request('bound','title' as never);
    expect(f.assertExecutionContext).not.toHaveBeenCalled();expect(f.model).toHaveBeenCalledOnce();f.dispose();
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
  it('rechecks a directory operation that started while the stream validator awaited I/O',async()=>{
    const f=fixture();f.assertExecutionContext.mockImplementation(async()=>{f.task.operation={phase:'switching'};});
    await expect(f.request()).rejects.toMatchObject({code:'CONTEXT_OPERATION_PENDING'});expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('honors cancellation before releasing a validated task to the provider',async()=>{
    const f=fixture();f.assertExecutionContext.mockImplementation(async()=>{f.signal.abort(new Error('Cancelled'));});
    await expect(f.request()).rejects.toThrow('Cancelled');expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('rejects an already-aborted stream before validation',async()=>{
    const f=fixture();f.signal.abort(new Error('Cancelled'));
    await expect(f.request()).rejects.toThrow('Cancelled');expect(f.assertExecutionContext).not.toHaveBeenCalled();expect(f.model).not.toHaveBeenCalled();f.dispose();
  });
  it('disposes both public listeners with plugin ownership',async()=>{
    const f=fixture();f.dispose();f.directory.exists=false;
    expect((await f.step()).kind).toBe('enter');await f.request();
    expect(f.assertExecutionContext).not.toHaveBeenCalled();expect(f.model).toHaveBeenCalledOnce();
  });
});
