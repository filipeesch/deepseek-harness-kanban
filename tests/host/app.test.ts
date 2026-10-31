import { describe,it,expect,afterEach,vi } from 'vitest';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { CommandSchema } from '../../src/remote.js';
import { fixture, taskWithConversation } from './helpers.js';
import { call, result } from '../questions/fixtures.js';
let active:Array<Awaited<ReturnType<typeof fixture>>>=[];
afterEach(async()=>{for(const f of active.splice(0))await f.close();});
async function setup(){const f=await fixture();active.push(f);return f;}
async function task(f:Awaited<ReturnType<typeof setup>>){return taskWithConversation(f.app,{projectId:f.project.id,title:'Implement feature',description:'Original approved description'});}
async function configuredInstruction(f:Awaited<ReturnType<typeof setup>>,instruction:string|undefined){const w=f.store.snapshot().workflow;if(instruction===undefined)delete w.columns[1]!.onEnterPrompt;else w.columns[1]!.onEnterPrompt=instruction;const { stringify }=await import('yaml');await f.store.setWorkflow(stringify({name:w.name,initial_column:w.initialColumnId,columns:w.columns.map(c=>({id:c.id,label:c.name,...(c.onEnterPrompt!==undefined?{on_enter_prompt:c.onEnterPrompt}:{})}))}));return f.store.snapshot().workflow.columns[1]!.id;}
async function instructed(f:Awaited<ReturnType<typeof setup>>){return configuredInstruction(f,'Plan this task.');}
describe('host command orchestration',()=>{
 it('returns the exact created entity receipt rather than snapshot set differences',async()=>{const f=await setup();const other=await f.app.createTask({projectId:f.project.id,title:'Concurrent tool task',description:''});const result=await f.app.command({type:'task.create',projectId:f.project.id,title:'UI task',description:''});expect(result.commandReceipt?.kind).toBe('task');expect(result.commandReceipt?.id).not.toBe(other.id);expect(result.state.hubs[0]!.tasks.find(t=>t.id===result.commandReceipt?.id)?.title).toBe('UI task');expect((await f.app.snapshot()).commandReceipt).toBeUndefined();});
 it('stamps metadata before asynchronous attention reads, not after intervening commits',async()=>{const f=await setup();const t=await task(f);let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});f.sessions.facts=async()=>{entered();await gate;return {running:false,background:[],awaitingReply:false,settledTurn:null};};const before=f.store.snapshot();const pending=f.app.snapshot();await started;await f.store.editTask(t.id,{title:'Changed while reading attention'});release();const stale=await pending;const fresh=await f.app.snapshot();expect(stale.state.hubs[0]!.revision).toBe(before.revision);expect(stale.state.hubs[0]!.tasks[0]?.title).toBe(t.title);expect(fresh.state.hubs[0]!.tasks[0]?.title).toBe('Changed while reading attention');expect(stale.sequence).toBeLessThan(fresh.sequence);});
 it('updates ordinary-chat question state without publishing the board',async()=>{const f=await setup();const notify=vi.fn();f.app.subscribe(notify);expect(f.app.locator.hasSession('ordinary-chat')).toBe(false);f.app.observe('ordinary-chat',call(1,1,'c'));f.app.observe('ordinary-chat',result(2,1,'c'));expect(f.app.questions.getRounds('ordinary-chat')).toHaveLength(1);await new Promise(resolve=>setTimeout(resolve,20));expect(notify).not.toHaveBeenCalled();});
 it('reuses the cached board state until the repository changes',async()=>{const f=await setup();const t=await task(f);const first=await f.app.snapshot();const second=await f.app.snapshot();expect(second.state).toBe(first.state);await f.store.editTask(t.id,{title:'Changed state cache'});const third=await f.app.snapshot();expect(third.state).not.toBe(first.state);expect(third.state.hubs[0]!.tasks[0]?.title).toBe('Changed state cache');});
 it('starts a task without a native conversation until an explicit start',async()=>{const f=await setup();const t=await f.app.createTask({projectId:f.project.id,title:'Lazy task',description:'No conversation yet'});expect(t.sessionIds).toEqual([]);expect(f.store.requireTask(t.id).sessionIds).toEqual([]);expect(f.sessions.dirs.size).toBe(0);await expect(f.app.createConversation(t.id)).rejects.toMatchObject({code:'WORKTREE_DECISION_REQUIRED'});await expect(f.app.command({type:'conversation.create',taskId:t.id})).rejects.toMatchObject({code:'WORKTREE_DECISION_REQUIRED'});expect(f.sessions.dirs.size).toBe(0);await f.app.command({type:'worktree.dismiss',taskId:t.id});const dismissedAt=f.store.requireTask(t.id).updatedAt;const dismissedRevision=f.store.snapshot().revision;await f.app.command({type:'worktree.dismiss',taskId:t.id});expect(f.store.requireTask(t.id).worktreeDismissed).toBe(true);expect(f.store.requireTask(t.id).updatedAt).toBe(dismissedAt);expect(f.store.snapshot().revision).toBe(dismissedRevision);const id=await f.app.createConversation(t.id);expect(f.store.requireTask(t.id).sessionIds).toEqual([id]);expect(await f.sessions.directory(id)).toBe(f.projectPath);expect(f.sessions.sent).toEqual([]);});
 it('creates the first conversation in a ready worktree before the task starts',async()=>{const f=await setup();const t=await f.app.createTask({projectId:f.project.id,title:'Worktree first',description:''});const root=path.join(f.root,'first-tree');await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:root,branchName:'task/first',sourceBranch:'main'});const id=await f.app.createConversation(t.id);expect(f.store.requireTask(t.id).sessionIds).toEqual([id]);expect(await f.sessions.directory(id)).toBe(path.join(root,'apps','web'));expect(f.sessions.workspaceIds.get(id)).toBe(f.workspaces.byPath.get(path.join(root,'apps','web'))?.id);});
 it('lets a stage instruction create the first conversation before the worktree choice',async()=>{const f=await setup();const columnId=await instructed(f);const t=await f.app.createTask({projectId:f.project.id,title:'Instruction first',description:''});await f.app.command({type:'task.move',taskId:t.id,columnId});const marker=f.store.requireTask(t.id).instructionPending!;await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});const after=f.store.requireTask(t.id);expect(after.sessionIds).toHaveLength(1);expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(after.sessionIds[0]);expect(await f.sessions.directory(after.sessionIds[0]!)).toBe(f.projectPath);expect(after.instructionPending).toBeUndefined();});
 it('forces a fresh conversation-fact projection when the client asks for one',async()=>{const f=await setup();const t=await task(f);let running=false;f.sessions.facts=async()=>({running,background:[],awaitingReply:false,settledTurn:null});const idle=await f.app.snapshot();expect(idle.conversations[t.sessionIds[0]!]?.running).toBe(false);running=true;const cached=await f.app.snapshot();expect(cached.conversations[t.sessionIds[0]!]?.running).toBe(false);const fresh=await f.app.snapshot(true);expect(fresh.conversations[t.sessionIds[0]!]?.running).toBe(true);expect(fresh.sequence).toBeGreaterThan(cached.sequence);expect((await f.app.snapshot()).conversations[t.sessionIds[0]!]?.running).toBe(true);});
 it('edits any stage without sending a hidden instruction',async()=>{const f=await setup();const t=await task(f);await f.store.transact(d=>{d.tasks[0]!.columnId=d.boards[0]!.workflow.columns[2]!.id;});await f.app.command({type:'task.edit',taskId:t.id,title:'Changed',description:'New text'});expect(f.store.requireTask(t.id).title).toBe('Changed');expect(f.sessions.sent).toEqual([]);});
 it('creates distinct tabs inheriting the effective monorepo directory',async()=>{const f=await setup();const t=await task(f);const id=await f.app.createConversation(t.id);expect(id).not.toBe(t.sessionIds[0]);expect(f.store.requireTask(t.id).sessionIds).toHaveLength(2);expect(await f.sessions.directory(id)).toBe(f.projectPath);});
 it('moves only into an instructed stage and records the entry',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});const moved=f.store.requireTask(t.id);expect(moved.columnId).toBe(columnId);expect(moved.instructionPending).toMatchObject({columnId});expect(f.sessions.sent).toEqual([]);expect(f.git.created).toBe(0);});
 it('keeps the entry marker on a same-stage reorder',async()=>{const f=await setup();const columnId=await instructed(f);const first=await task(f);const second=await task(f);await f.app.command({type:'task.move',taskId:first.id,columnId});await f.app.command({type:'task.move',taskId:second.id,columnId});const before=f.store.requireTask(first.id).instructionPending!;await f.app.command({type:'task.move',taskId:first.id,columnId,beforeTaskId:second.id});expect(f.store.requireTask(first.id).instructionPending).toEqual(before);expect(f.store.requireTask(first.id).position).toBe(0);expect(f.sessions.sent).toEqual([]);});
 it('runs a card instruction in the first open conversation without moving the task',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;const before=f.store.requireTask(t.id);
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]).toMatchObject({id:t.sessionIds[0],text:'Plan this task.'});
  const after=f.store.requireTask(t.id);expect(after.columnId).toBe(columnId);expect(after.position).toBe(before.position);expect(after.pendingTransition).toBeUndefined();expect(after.instructionPending).toBeUndefined();
 });
 it('targets the first open conversation in conversation order',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;const second=await f.app.createConversation(t.id);
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(t.sessionIds[0]);expect(f.sessions.sent[0]!.id).not.toBe(second);
 });
 it('creates a conversation for a card instruction when every tab is closed',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId});const marker=f.store.requireTask(t.id).instructionPending!;
  for(const sessionId of t.sessionIds)await f.app.command({type:'conversation.close',taskId:t.id,sessionId});
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});
  const after=f.store.requireTask(t.id);expect(after.sessionIds).toHaveLength(2);
  const created=after.sessionIds.find(id=>!t.sessionIds.includes(id))!;
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]).toMatchObject({id:created,text:'Plan this task.'});expect(after.columnId).toBe(columnId);expect(after.instructionPending).toBeUndefined();
 });
 it('rejects a stale or missing entry before resolving a target',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;
  for(const sessionId of t.sessionIds)await f.app.command({type:'conversation.close',taskId:t.id,sessionId});
  const sessions=[...f.store.requireTask(t.id).sessionIds];
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt+1,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_ALREADY_RESOLVED'});
  expect(f.store.requireTask(t.id).sessionIds).toEqual(sessions);
  await f.store.transact(d=>{delete d.tasks[0]!.instructionPending;});
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_ALREADY_RESOLVED'});
  expect(f.sessions.sent).toEqual([]);expect(f.store.requireTask(t.id).sessionIds).toEqual(sessions);
 });
 it('runs again after a successful first admission and a later re-entry',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId});const first=f.store.requireTask(t.id).instructionPending!;
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:first.enteredAt,expectedInstruction:'Plan this task.'});
  await f.app.command({type:'task.move',taskId:t.id,columnId:'backlog'});
  await f.app.command({type:'task.move',taskId:t.id,columnId});const second=f.store.requireTask(t.id).instructionPending!;
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:second.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(2);expect(f.sessions.sent.every(item=>item.text==='Plan this task.')).toBe(true);
 });
 it('clears an unresolved entry when the host observes a real user prompt',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;
  f.app.observe(t.sessionIds[0]!,{type:'user/message',seq:1,time:marker.enteredAt+1,data:{source:{kind:'user'}}});
  await expect.poll(()=>f.store.requireTask(t.id).instructionPending).toBeUndefined();
  expect(f.sessions.sent).toEqual([]);
 });
 it('rejects a replaced entry after leaving and re-entering the stage',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId});const first=f.store.requireTask(t.id).instructionPending!;
  await f.app.command({type:'task.move',taskId:t.id,columnId:'backlog'});
  await f.app.command({type:'task.move',taskId:t.id,columnId});const second=f.store.requireTask(t.id).instructionPending!;
  expect(second.enteredAt).toBeGreaterThan(first.enteredAt);
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:first.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_ALREADY_RESOLVED'});
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:second.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);
 });
 it('rejects a card instruction for a busy, moved, or changed stage before sending',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;
  await f.store.transact(d=>{const value=d.tasks[0]!;value.pendingTransition={id:'pending',fromColumnId:columnId,columnId,mode:'move',status:'waiting'};});
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'TASK_BUSY'});
  await f.store.transact(d=>{const value=d.tasks[0]!;delete value.pendingTransition;value.columnId='backlog';});
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'TASK_MOVED'});
  await f.store.transact(d=>{d.tasks[0]!.columnId=columnId;});
  await configuredInstruction(f,'Replacement instruction.');
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  expect(f.sessions.sent).toEqual([]);expect(f.store.requireTask(t.id).instructionPending).toBeDefined();
 });
 it('keeps the entry marker after a failed admission and retries with the same identity',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;f.sessions.failSend=true;
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'SEND_FAILED'});
  expect(f.sessions.sent).toEqual([]);expect(f.store.requireTask(t.id).instructionPending).toEqual(marker);
  f.sessions.failSend=false;
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.store.requireTask(t.id).instructionPending).toBeUndefined();
 });
 it('blocks a card instruction outside the task execution directory',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;f.sessions.dirs.set(t.sessionIds[0]!,f.gitRoot);
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
  expect(f.sessions.sent).toEqual([]);expect(f.store.requireTask(t.id).instructionPending).toEqual(marker);
 });
 it('accepts and preserves exact Markdown instruction bytes rather than trimmed text',async()=>{
  const f=await setup();const approved='    Keep Markdown indentation.\n\nPlan exactly.\n';const columnId=await configuredInstruction(f,approved);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId});
  const marker=f.store.requireTask(t.id).instructionPending!;
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:approved.trim()})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:approved});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.text).toBe(approved);
 });
 it('executes at base after returning while retaining an inactive ready worktree',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);const root=path.join(f.root,'retained-inactive-tree');
  await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:root,branchName:'task/inactive',sourceBranch:'main'});
  await f.app.command({type:'operation.return',taskId:t.id});
  const returned=f.store.requireTask(t.id);expect(returned.worktree).toMatchObject({path:root,status:'ready'});expect(returned.effectiveCwd).toBe(f.projectPath);
  await f.app.command({type:'task.move',taskId:t.id,columnId});const marker=f.store.requireTask(t.id).instructionPending!;
  const second=await f.app.createConversation(t.id);expect(await f.sessions.directory(second)).toBe(f.projectPath);await expect(f.app.assertExecutionContext(second)).resolves.toBeUndefined();
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedEnteredAt:marker.enteredAt,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(t.sessionIds[0]);expect(f.store.requireTask(t.id).effectiveCwd).toBe(f.projectPath);expect(await f.sessions.directory(second)).toBe(f.projectPath);
 });
 it('removes a ready worktree with no conversations',async()=>{const f=await setup();const t=await f.app.createTask({projectId:f.project.id,title:'Empty worktree',description:''});const tree=path.join(f.root,'empty-tree');await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:tree,branchName:'task/empty',sourceBranch:'main'});await f.app.command({type:'worktree.remove',taskId:t.id,confirmed:true,expectedWorktreePath:tree});await f.app.worktrees.settle();const after=f.store.requireTask(t.id);expect(after.worktree).toBeNull();expect(after.effectiveCwd).toBe(f.projectPath);expect(f.sessions.archived).toEqual([]);expect(f.git.removed).toContain(tree);});
 it('deletes a ready worktree task with no conversations',async()=>{const f=await setup();const t=await f.app.createTask({projectId:f.project.id,title:'Delete empty worktree',description:''});const tree=path.join(f.root,'delete-empty-tree');await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:tree,branchName:'task/delete-empty',sourceBranch:'main'});await f.app.command({type:'task.delete',taskId:t.id,confirmed:true,expectedWorktreePath:tree});await f.app.worktrees.settle();expect(f.store.snapshot().tasks).toEqual([]);expect(f.sessions.archived).toEqual([]);expect(f.git.removed).toContain(tree);});
 it('deletes a task without a native conversation',async()=>{const f=await setup();const t=await f.app.createTask({projectId:f.project.id,title:'No conversation',description:''});await f.app.command({type:'task.delete',taskId:t.id,confirmed:true,expectedWorktreePath:null});await f.app.worktrees.settle();expect(f.store.snapshot().tasks).toEqual([]);expect(f.sessions.archived).toEqual([]);});
 it('leaves unassociated ordinary sessions outside the task-context guard',async()=>{
  const f=await setup();Object.assign(f.sessions,{async validateDirectory(){throw new Error('Should not validate an unrelated native session.');}});await expect(f.app.assertExecutionContext('ordinary-chat')).resolves.toBeUndefined();
 });
 it('accepts the new move and run wire commands and rejects legacy fields',()=>{
  const move={type:'task.move' as const,taskId:'task-1',columnId:'plan'};
  expect(CommandSchema.parse(move)).toEqual(move);
  const override={...move,overrideTransition:true};expect(CommandSchema.parse(override)).toEqual(override);
  expect(()=>CommandSchema.parse({...override,override:true})).toThrow();
  expect(()=>CommandSchema.parse({...move,mode:'run'})).toThrow();
  expect(()=>CommandSchema.parse({...move,worktree:{mode:'new',path:'/t',branchName:'b'}})).toThrow();
  const dismiss={type:'worktree.dismiss' as const,taskId:'task-1'};
  expect(CommandSchema.parse(dismiss)).toEqual(dismiss);
  expect(()=>CommandSchema.parse({...dismiss,extra:true})).toThrow();
  const run={type:'task.runInstruction' as const,taskId:'task-1',columnId:'plan',expectedEnteredAt:42,expectedInstruction:'Plan exactly.'};
  expect(CommandSchema.parse(run)).toEqual(run);
  expect(()=>CommandSchema.parse({type:'task.runInstruction',taskId:'task-1',columnId:'plan',expectedInstruction:'Plan exactly.'})).toThrow();
  expect(()=>CommandSchema.parse({...run,extra:true})).toThrow();
  const forcedDelete={type:'task.delete' as const,taskId:'task-1',confirmed:true,expectedWorktreePath:null,force:true};
  expect(CommandSchema.parse(forcedDelete)).toEqual(forcedDelete);
  expect(()=>CommandSchema.parse({...forcedDelete,force:'yes'})).toThrow();
  const forcedRemove={type:'worktree.remove' as const,taskId:'task-1',confirmed:true,expectedWorktreePath:null,force:true};
  expect(CommandSchema.parse(forcedRemove)).toEqual(forcedRemove);
  expect(()=>CommandSchema.parse({...forcedRemove,force:1})).toThrow();
 });
});
describe('task deletion lineage and workspace cleanup', () => {
  async function worktreeTask(f: Awaited<ReturnType<typeof setup>>) {
    const t = await task(f);
    const root = path.join(f.root, 'lineage-tree');
    await f.app.command({ type: 'worktree.create', taskId: t.id, mode: 'new', path: root, branchName: 'task/lineage', sourceBranch: 'main' });
    const conversation = await f.app.createConversation(t.id);
    const current = f.store.requireTask(t.id);
    return { task: current, root, conversation, workspaceId: current.worktreeWorkspaceId! };
  }

  it('deletes an owned worktree workspace that contains a task-owned subagent child', async () => {
    const f = await setup(); const { task: current, root, conversation, workspaceId } = await worktreeTask(f);
    const workspace = f.workspaces.get(workspaceId)!;
    const child = f.sessions.seedSubagent(current.sessionIds[0]!, 'child', path.join(root, 'apps', 'web'));
    workspace.sessionIds.push(child);
    await f.app.command({ type: 'task.delete', taskId: current.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks).toEqual([]);
    expect(f.workspaces.deleted).toContain(workspaceId);
    expect(f.sessions.archived).toEqual(current.sessionIds);
    expect(f.sessions.archived).not.toContain(child);
    expect(f.git.removed).toEqual([root]);
  });

  it('retains a worktree workspace used by a foreign session', async () => {
    const f = await setup(); const { task: current, root, workspaceId } = await worktreeTask(f);
    f.workspaces.get(workspaceId)!.sessionIds.push('foreign-session');
    await f.app.command({ type: 'task.delete', taskId: current.id, confirmed: true, expectedWorktreePath: root });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks).toEqual([]);
    expect(f.workspaces.deleted).not.toContain(workspaceId);
  });

  it('retries the reported failed preflight deletion after an owned child is recognized', async () => {
    const f = await setup(); const { task: current, root } = await worktreeTask(f);
    const child = f.sessions.seedSubagent(current.sessionIds[0]!, 'child', path.join(root, 'apps', 'web'));
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === current.id)!;
      value.operation = {
        id: 'reported-failed-preflight', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: root },
        phase: 'failed', targetPath: root, previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false,
        error: { code: 'SHARED_WORKTREE', message: 'Another native session is using this checkout.', details: { sessionId: child, path: root, failedPhase: 'preflight', gitAttempted: false } },
        createdAt: '2026-10-23T00:00:00.000Z',
      };
    });
    await f.app.command({ type: 'operation.retry', taskId: current.id });
    await f.app.worktrees.settle();
    expect(f.store.snapshot().tasks).toEqual([]);
    expect(f.sessions.archived).toEqual(current.sessionIds);
    expect(f.sessions.archived).not.toContain(child);
    expect(f.git.removed).toEqual([root]);
  });
});
