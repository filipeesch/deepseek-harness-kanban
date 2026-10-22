import {describe,expect,it,vi} from 'vitest';
import type {ToolGuard} from '@deepseek-ai/dsh-tools';
// @ts-expect-error Standalone Node-native acceptance helper intentionally has no TypeScript build step.
import {assertApprovalAuthorizations,installFixtureApprovalGuard,parseArgs,rejectKnownNativeApproval,safeReport} from '../../scripts/verify-native-conversations.mjs';
const base=['--allow-owner-test','--allow-fixture-data','--allow-model-requests'];
const auth={allowOwnerTest:true,allowFixtureData:true,allowModelRequests:true,verifyApproval:true,allowFixturePolicyChanges:true};
const roles={A:'own-A',B:'own-B',C:'own-C'},cwd='/isolated/fixture/project',nonce='abcdef123456';
type Event={type:string;seq:number;data:Record<string,unknown>};
function fixture(){
  const events=new Map<string,Event[]>(Object.values(roles).map(id=>[id,[]]));const callbacks=new Map<string,ToolGuard>();const removers:ReturnType<typeof vi.fn>[]=[];
  const requests=new Map<string,(payload:{agent:{id:string}},next:()=>Promise<unknown>)=>Promise<unknown>>();
  const policy=new Map<string,string>(Object.values(roles).map(id=>[id,'danger-full-access']));
  const capability={directBash:true,askPreset:true};
  const members=new Map(Object.values(roles).map(id=>[id,{id,status:'idle',inbox:{nextTurn:[] as unknown[]},session:{id,requestHeader:()=>({tools:capability.directBash?[{name:'bash',parameters:{properties:{sandbox_permissions:{enum:['danger-full-access']}}}}]:[{name:'run_code'}]})},ctx:{get:()=>({guard:(check:ToolGuard)=>{callbacks.set(id,check);const dispose=vi.fn(()=>{callbacks.delete(id);});removers.push(dispose);return dispose;}}),on:(name:string,listener:(payload:{agent:{id:string}},next:()=>Promise<unknown>)=>Promise<unknown>)=>{if(name!=='agent/request')throw new Error('Unknown public hook');requests.set(id,listener);const dispose=vi.fn(()=>{requests.delete(id);});removers.push(dispose);return dispose;}}}]));
  const presets={defaultPreset:'danger-full-access',resolve:()=>({sandbox:'workspace-write',approval:capability.askPreset?'ask':'never'}),current:(session:{id:string})=>policy.get(session.id),set:vi.fn((session:{id:string},name:string)=>{policy.set(session.id,name);})};
  const sandbox={defaultMode:'danger-full-access',resolve:({session}:{session:{id:string}})=>({mode:policy.get(session.id)})};
  const services={agents:{get:(id:string)=>members.get(id)},sessionController:{inspect:vi.fn(async(id:string)=>({meta:{cwd},events:events.get(id)}))},permissionPresets:presets,sandboxPolicy:sandbox,approval:{effectivePolicy:(session:{id:string})=>policy.get(session.id)==='workspace-write'?'ask':'never'}};
  const activity=vi.fn(async()=>[] as unknown[]);const host={get:(name:string)=>services[name as keyof typeof services],waterfall:activity};
  const add=(id:string,type:string,data:Record<string,unknown>)=>{const rows=events.get(id)!;rows.push({type,data,seq:rows.length});};
  return{host,capability,members,callbacks,requests,removers,policy,presets,sandbox,events,activity,add};
}
const input=(id:string,name:string,args:Record<string,unknown>,callId='own-call')=>({agent:{id},name,arguments:args,callId} as unknown as Parameters<ToolGuard>[0]);
const exactArgs=(guard:{prompt:()=>string})=>JSON.parse(guard.prompt().split('JSON object: ')[1]!.split('. Do not use')[0]!) as Record<string,unknown>;
// Entire suite uses in-memory synthetic data only; it NEVER asks or answers a live approval or runs a model/command.
describe('optional fixture-only native approval preparation',()=>{
  it('requires both extra flags before any native service or policy change, while core default stays not-tested',async()=>{
    expect(parseArgs(base)).toMatchObject({verifyApproval:false,allowFixturePolicyChanges:false});expect(safeReport({stage:'artifact',ok:true}).approval.status).toBe('not-tested');
    for(const extra of[['--verify-approval'],['--allow-fixture-policy-changes']])expect(()=>parseArgs([...base,...extra])).toThrow();
    expect(parseArgs([...base,'--verify-approval','--allow-fixture-policy-changes'])).toMatchObject(auth);
    for(const key of Object.keys(auth)){const f=fixture();const options={...auth,[key]:false};expect(()=>assertApprovalAuthorizations(options)).toThrow();await expect(installFixtureApprovalGuard.call(f.host,options,roles,cwd,nonce)).rejects.toThrow('authorizations');expect(f.callbacks.size).toBe(0);expect(f.presets.set).not.toHaveBeenCalled();}
  });
  it('fails unsupported PTC-only or non-ask preset preconditions before guards, policy changes or model requests',async()=>{
    const f=fixture();f.capability.directBash=false;const unsupported=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);expect(unsupported.snapshot()).toEqual({activated:false,unsupported:'DIRECT_NATIVE_BASH_HEADER_REQUIRED'});await unsupported.dispose();expect(f.callbacks.size).toBe(0);expect(f.presets.set).not.toHaveBeenCalled();
    const bad=fixture();bad.capability.askPreset=false;await expect(installFixtureApprovalGuard.call(bad.host,auth,roles,cwd,nonce)).rejects.toThrow('preset');expect(bad.presets.set).not.toHaveBeenCalled();
  });
  it('sets only the exact owned A session, never a global/default or B/C policy, and permits only one fixed safe Bash call',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);const args=exactArgs(guard);
    expect(f.presets.set).not.toHaveBeenCalled();await guard.preparePreset();expect(f.presets.set).toHaveBeenCalledWith(f.members.get(roles.A)!.session,'workspace-write');expect(f.presets.defaultPreset).toBe('danger-full-access');expect(f.sandbox.defaultMode).toBe('danger-full-access');expect(f.policy.get(roles.B)).toBe('danger-full-access');expect(f.policy.get(roles.C)).toBe('danger-full-access');
    expect(args.command).toBe('printf QA_APPROVAL_'+nonce);expect(args.sandbox_permissions).toBe('danger-full-access');expect(args.workdir).toBe(cwd);
    expect(f.callbacks.get(roles.A)!(input('unrelated','bash',args))).toBeUndefined();expect(f.callbacks.get(roles.B)!(input(roles.B,'bash',args))).toBeTypeOf('string');expect(f.callbacks.get(roles.A)!(input(roles.A,'run_code',args))).toBeTypeOf('string');
    expect(f.callbacks.get(roles.A)!(input(roles.A,'bash',{...args,command:String(args.command)+'; touch /not-allowed'}))).toBeTypeOf('string');
    expect(f.callbacks.get(roles.A)!(input(roles.A,'bash',args))).toBeUndefined();expect(guard.snapshot().allowedCount).toBe(1);expect(f.callbacks.get(roles.A)!(input(roles.A,'bash',args,'second-call'))).toBeTypeOf('string');await guard.dispose();
  });
  it('allows at most initial-plus-resume request admissions and never retries indefinitely',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);const hook=f.requests.get(roles.A)!;const next=vi.fn(async()=>({model:'test'}));
    await hook({agent:{id:roles.A}},next);await hook({agent:{id:roles.A}},next);await expect(hook({agent:{id:roles.A}},next)).rejects.toThrow('budget');expect(next).toHaveBeenCalledTimes(2);expect(guard.snapshot().modelRequestBudgetExceeded).toBe(true);await guard.dispose();
  });
  it('rejects an unknown canonical approval identity and refuses any UI answer before DOM access',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);await guard.preparePreset();const args=exactArgs(guard);f.callbacks.get(roles.A)!(input(roles.A,'bash',args));
    f.add(roles.A,'user/message',{source:{kind:'user'},content:[{type:'text',text:guard.prompt()}]});f.add(roles.A,'tool/call',{name:'bash',callId:'own-call',arguments:JSON.stringify(args)});f.add(roles.A,'approval/asked',{id:'unknown-approval',toolName:'bash',callId:'other-call',reason:'unknown'});
    const state=await guard.state();expect(state.unexpected).toBe(true);const frame={locator:vi.fn()};await expect(rejectKnownNativeApproval(auth,frame,roles.A,{...state,clientSessionMatch:true,clientCallMatch:true,clientIsBashApproval:true},1000)).rejects.toThrow();expect(frame.locator).not.toHaveBeenCalled();await guard.dispose();
  });
  it('correlates the exact synthetic canonical prompt, asked/decided pair, denied tool and resumed A response only',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);await guard.preparePreset();const args=exactArgs(guard);f.callbacks.get(roles.A)!(input(roles.A,'bash',args));
    f.add(roles.A,'user/message',{source:{kind:'user'},content:[{type:'text',text:guard.prompt()}]});f.add(roles.A,'tool/call',{name:'bash',callId:'own-call',arguments:JSON.stringify(args)});f.add(roles.A,'approval/asked',{id:'request',toolName:'bash',callId:'own-call',reason:'escalate sandbox to danger-full-access: '+args.justification});
    expect(await guard.state()).toMatchObject({knownAsked:true,pending:true,humanPromptMatch:true,unexpected:false,BUnchanged:true,CUnchanged:true});
    f.add(roles.A,'approval/decided',{id:'request',outcome:'rejected'});f.add(roles.A,'tool/result',{message:{toolCallId:'own-call',isError:true}});f.add(roles.A,'assistant/message',{message:{content:[{type:'text',text:'QA_APPROVAL_RESUMED_'+nonce}]}});
    expect(await guard.state()).toMatchObject({rejected:true,resumed:true,toolRejected:true,unexpected:false});f.add(roles.C,'turn/start',{turn:1});expect((await guard.state()).unexpected).toBe(true);await guard.dispose();
  });
  it('uses only the exact own native approval subtree Reject button after canonical and client identity match',async()=>{
    const click=vi.fn();const panel={count:async()=>1,getByRole:(role:string,options:{name:string;exact:boolean})=>{expect(role).toBe('button');expect(options).toEqual({name:'Reject',exact:true});return{count:async()=>1,isEnabled:async()=>true,click};}};
    const target={locator:(selector:string)=>selector==='[data-approval-key]'?panel:{count:async()=>0}};
    const frame={count:async()=>1,locator:(selector:string)=>selector==='[data-conversation-content]'?{count:async()=>1,getAttribute:async(name:string)=>name==='data-conversation-session'?roles.A:'active'}:target};
    await rejectKnownNativeApproval(auth,frame,roles.A,{knownAsked:true,pending:true,unexpected:false,granted:false,clientSessionMatch:true,clientCallMatch:true,clientIsBashApproval:true},1000);expect(click).toHaveBeenCalledOnce();
  });
  it('disposes safely after native cleanup already removed archived owned Agents',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);f.members.clear();await guard.dispose();expect(guard.snapshot().activated).toBe(false);expect(f.callbacks.size).toBe(0);
  });
  it('retains scoped denials until every owned model/activity is idle, then disposes every public registration',async()=>{
    const f=fixture();const guard=await installFixtureApprovalGuard.call(f.host,auth,roles,cwd,nonce);f.members.get(roles.A)!.status='running';await expect(guard.dispose()).rejects.toThrow('idle');expect(f.callbacks.size).toBe(3);
    f.members.get(roles.A)!.status='idle';f.activity.mockResolvedValueOnce([{kind:'job'}]);await expect(guard.dispose()).rejects.toThrow('idle');expect(f.callbacks.size).toBe(3);
    await guard.dispose();expect(guard.snapshot().activated).toBe(false);expect(f.callbacks.size).toBe(0);expect(f.requests.size).toBe(0);for(const release of f.removers)expect(release).toHaveBeenCalledOnce();
  });
});
