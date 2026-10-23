import { describe,it,expect,afterEach } from 'vitest';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { CommandSchema } from '../../src/remote.js';
import { fixture } from './helpers.js';
let active:Array<Awaited<ReturnType<typeof fixture>>>=[];
afterEach(async()=>{for(const f of active.splice(0))await f.close();});
async function setup(){const f=await fixture();active.push(f);return f;}
async function task(f:Awaited<ReturnType<typeof setup>>){return f.app.createTask({projectId:f.project.id,title:'Implement feature',description:'Original approved description'});}
async function configuredInstruction(f:Awaited<ReturnType<typeof setup>>,instruction:string|undefined){const w=f.store.snapshot().workflow;if(instruction===undefined)delete w.columns[1]!.onEnterPrompt;else w.columns[1]!.onEnterPrompt=instruction;const { stringify }=await import('yaml');await f.store.setWorkflow(stringify({name:w.name,initial_column:w.initialColumnId,columns:w.columns.map(c=>({id:c.id,label:c.name,...(c.onEnterPrompt!==undefined?{on_enter_prompt:c.onEnterPrompt}:{})}))}));return f.store.snapshot().workflow.columns[1]!.id;}
async function instructed(f:Awaited<ReturnType<typeof setup>>){return configuredInstruction(f,'Plan this task.');}
describe('host command orchestration',()=>{
 it('returns the exact created entity receipt rather than snapshot set differences',async()=>{const f=await setup();const other=await f.app.createTask({projectId:f.project.id,title:'Concurrent tool task',description:''});const result=await f.app.command({type:'task.create',projectId:f.project.id,title:'UI task',description:''});expect(result.commandReceipt?.kind).toBe('task');expect(result.commandReceipt?.id).not.toBe(other.id);expect(result.state.tasks.find(t=>t.id===result.commandReceipt?.id)?.title).toBe('UI task');expect((await f.app.snapshot()).commandReceipt).toBeUndefined();});
 it('stamps metadata before asynchronous attention reads, not after intervening commits',async()=>{const f=await setup();const t=await task(f);let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});f.sessions.attention=async()=>{entered();await gate;return {running:false,unread:false,awaitingReply:false,failed:false};};const before=f.store.snapshot();const pending=f.app.snapshot();await started;await f.store.editTask(t.id,{title:'Changed while reading attention'});release();const stale=await pending;const fresh=await f.app.snapshot();expect(stale.state.revision).toBe(before.revision);expect(stale.state.tasks[0]?.title).toBe(t.title);expect(fresh.state.tasks[0]?.title).toBe('Changed while reading attention');expect(stale.sequence).toBeLessThan(fresh.sequence);});
 it('creates one fresh native conversation without a prompt',async()=>{const f=await setup();const t=await task(f);expect(t.sessionIds).toHaveLength(1);expect(await f.sessions.directory(t.sessionIds[0]!)).toBe(f.projectPath);expect(f.sessions.sent).toEqual([]);});
 it('edits any stage without sending a hidden instruction',async()=>{const f=await setup();const t=await task(f);await f.store.transact(d=>{d.tasks[0]!.columnId=d.workflow.columns[2]!.id;});await f.app.command({type:'task.edit',taskId:t.id,title:'Changed',description:'New text'});expect(f.store.requireTask(t.id).title).toBe('Changed');expect(f.sessions.sent).toEqual([]);});
 it('creates distinct tabs inheriting the effective monorepo directory',async()=>{const f=await setup();const t=await task(f);const id=await f.app.createConversation(t.id);expect(id).not.toBe(t.sessionIds[0]);expect(f.store.requireTask(t.id).sessionIds).toHaveLength(2);expect(await f.sessions.directory(id)).toBe(f.projectPath);});
 it('moves only without triggering configured instructions',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'move'});expect(f.store.requireTask(t.id).columnId).toBe(columnId);expect(f.sessions.sent).toEqual([]);});
 it('sends confirmed instructions only to the selected native conversation',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);const second=await f.app.createConversation(t.id);await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',expectedInstruction:'Plan this task.',sessionId:second});expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(second);expect(f.sessions.sent[0]!.text).toBe('Plan this task.');expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();});
 it('does not execute in base before the requested worktree is ready',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);const root=path.join(f.root,'feature-tree');await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',expectedInstruction:'Plan this task.',sessionId:t.sessionIds[0]!,worktree:{mode:'new',path:root,branchName:'task/feature',sourceBranch:'main'}});expect(f.sessions.sent).toHaveLength(1);expect(f.git.created).toBe(1);expect(await f.sessions.directory(t.sessionIds[0]!)).toBe(path.join(root,'apps','web'));});
 it('waits for all chats before preparing an optional worktree and executing',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);f.sessions.busy.add(t.sessionIds[0]!);await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',expectedInstruction:'Plan this task.',sessionId:t.sessionIds[0]!,worktree:{mode:'new',path:path.join(f.root,'queued-tree'),branchName:'task/queued',sourceBranch:'main'}});expect(f.sessions.sent).toEqual([]);expect(f.store.requireTask(t.id).operation?.phase).toBe('waiting');f.sessions.busy.clear();await f.app.worktrees.resumePending();await f.app.command({type:'task.edit',taskId:t.id,title:'After wait'});expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.text).toBe('Plan this task.');});
 it('retains exact request identity and text across an explicit failed-send retry',async()=>{const f=await setup();const columnId=await instructed(f);const t=await task(f);f.sessions.failSend=true;await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',expectedInstruction:'Plan this task.',sessionId:t.sessionIds[0]!});const pending=f.store.requireTask(t.id).pendingTransition!;expect(pending.status).toBe('failed');f.sessions.failSend=false;await f.app.command({type:'task.edit',taskId:t.id,description:'Changed after approval'});await f.app.command({type:'operation.retry',taskId:t.id});expect(f.sessions.sent[0]!.requestId).toBe(pending.id);expect(f.sessions.sent[0]!.text).toBe('Plan this task.');expect(f.sessions.sent[0]!.text).not.toContain('Changed after approval');});
 it('runs a card instruction in the first open conversation without moving the task',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'move'});
  const before=f.store.requireTask(t.id);
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]).toMatchObject({id:t.sessionIds[0],text:'Plan this task.'});
  const after=f.store.requireTask(t.id);expect(after.columnId).toBe(columnId);expect(after.position).toBe(before.position);expect(after.pendingTransition).toBeUndefined();
 });
 it('targets the first open conversation in conversation order',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'move'});
  const second=await f.app.createConversation(t.id);
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(t.sessionIds[0]);expect(f.sessions.sent[0]!.id).not.toBe(second);
 });
 it('creates a conversation for a card instruction when every tab is closed',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.store.transact(d=>{const value=d.tasks[0]!;value.columnId=columnId;value.closedSessionIds=[...value.sessionIds];});
  await f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'});
  const after=f.store.requireTask(t.id);expect(after.sessionIds).toHaveLength(2);
  const created=after.sessionIds.find(id=>!t.sessionIds.includes(id))!;
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]).toMatchObject({id:created,text:'Plan this task.'});expect(after.columnId).toBe(columnId);
 });
 it('rejects a card instruction for a busy, moved, or changed stage before sending',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.store.transact(d=>{const value=d.tasks[0]!;value.columnId=columnId;value.pendingTransition={id:'pending',fromColumnId:columnId,columnId,mode:'move',status:'waiting'};});
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'TASK_BUSY'});
  await f.store.transact(d=>{const value=d.tasks[0]!;delete value.pendingTransition;value.columnId='backlog';});
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'TASK_MOVED'});
  await f.store.transact(d=>{d.tasks[0]!.columnId=columnId;});
  await configuredInstruction(f,'Replacement instruction.');
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  expect(f.sessions.sent).toEqual([]);
 });
 it('blocks a card instruction outside the task execution directory',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'move'});f.sessions.dirs.set(t.sessionIds[0]!,f.gitRoot);
  await expect(f.app.command({type:'task.runInstruction',taskId:t.id,columnId,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'CONTEXT_MISMATCH'});
  expect(f.sessions.sent).toEqual([]);
 });
 it('accepts the card instruction wire command and rejects unknown fields',()=>{
  const request={type:'task.runInstruction' as const,taskId:'task-1',columnId:'plan',expectedInstruction:'Plan this task.'};
  expect(CommandSchema.parse(request)).toEqual(request);
  expect(()=>CommandSchema.parse({...request,extra:true})).toThrow();
 });
 it('requires explicit deletion consent and returns retained chats before tree cleanup',async()=>{const f=await setup();const t=await task(f);await expect(f.app.command({type:'task.delete',taskId:t.id,confirmed:false,expectedWorktreePath:null})).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});await f.app.command({type:'task.delete',taskId:t.id,confirmed:true,expectedWorktreePath:null});expect(f.store.snapshot().tasks).toHaveLength(0);expect(f.sessions.archived).toEqual(t.sessionIds);expect(f.git.removed).toEqual([]);expect(await f.sessions.directory(t.sessionIds[0]!)).toBe(f.projectPath);});
 it.each(['changed','removed','missing'] as const)('rejects an unreviewed instruction (%s) before movement, conversations, Git, or journals',async scenario=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);const expected='Plan this task.';
  if(scenario==='changed')await configuredInstruction(f,'UNAPPROVED replacement instruction.');
  if(scenario==='removed')await configuredInstruction(f,undefined);
  const before=f.store.snapshot();const sessions=[...f.sessions.dirs];
  await expect(f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',newConversation:true,worktree:{mode:'new',path:path.join(f.root,'never-create'),branchName:'task/unapproved',sourceBranch:'main'},...(scenario==='missing'?{}:{expectedInstruction:expected})})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  expect(f.store.snapshot()).toEqual(before);expect([...f.sessions.dirs]).toEqual(sessions);expect(f.sessions.sent).toEqual([]);expect(f.sessions.archived).toEqual([]);expect(f.git.created).toBe(0);expect(f.git.removed).toEqual([]);
 });
 it('rejects a reviewed run when its destination column was removed',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);await f.store.setWorkflow('columns: [{id: backlog, label: Backlog}, {id: done, label: Done}]');const before=f.store.snapshot();
  await expect(f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:'Plan this task.'})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  expect(f.store.snapshot()).toEqual(before);expect(f.sessions.sent).toEqual([]);
 });
 it('accepts and preserves exact Markdown instruction bytes rather than trimmed text',async()=>{
  const f=await setup();const approved='    Keep Markdown indentation.\n\nPlan exactly.\n';const columnId=await configuredInstruction(f,approved);const t=await task(f);
  await expect(f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:approved.trim()})).rejects.toMatchObject({code:'INSTRUCTION_CHANGED'});
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:approved});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.text).toBe(approved);
 });
 it('keeps the already approved instruction frozen through a later workflow edit while awaiting isolation',async()=>{
  const f=await setup();const approved='    Approved original.\n\nKeep this trailing newline.\n';const columnId=await configuredInstruction(f,approved);const t=await task(f);f.sessions.busy.add(t.sessionIds[0]!);
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:approved,worktree:{mode:'new',path:path.join(f.root,'frozen-tree'),branchName:'task/frozen',sourceBranch:'main'}});
  const pending=f.store.requireTask(t.id).pendingTransition!;expect(pending.text).toBe(approved);expect(f.sessions.sent).toEqual([]);
  await configuredInstruction(f,'UNAPPROVED later workflow text.');f.sessions.busy.clear();await f.app.worktrees.resumePending();await f.app.command({type:'task.edit',taskId:t.id,title:'After waiting'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.requestId).toBe(pending.id);expect(f.sessions.sent[0]!.text).toBe(approved);expect(f.sessions.sent[0]!.text).not.toContain('UNAPPROVED later');
 });
 it('retries a frozen approved run without demanding approval of a later replacement instruction',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);f.sessions.failSend=true;
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:'Plan this task.'});const pending=f.store.requireTask(t.id).pendingTransition!;
  await configuredInstruction(f,'Do not run this later replacement.');f.sessions.failSend=false;await f.app.command({type:'operation.retry',taskId:t.id});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.requestId).toBe(pending.id);expect(f.sessions.sent[0]!.text).toBe('Plan this task.');expect(f.sessions.sent[0]!.text).not.toContain('later replacement');
 });
 it('does not require or execute instruction approval for move-only commands',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'move',expectedInstruction:'Stale and irrelevant to organization.'});
  expect(f.store.requireTask(t.id).columnId).toBe(columnId);expect(f.sessions.sent).toEqual([]);
 });
 it('keeps exact instruction text in the wire command without normalizing whitespace',()=>{
  const text='    Reviewed Markdown.\n';const request={type:'task.move' as const,taskId:'task-1',columnId:'plan',mode:'run' as const,sessionId:'session-1',expectedInstruction:text};
  expect(CommandSchema.parse(request)).toEqual(request);expect(CommandSchema.parse({...request,mode:'move',expectedInstruction:undefined}).type).toBe('task.move');
 });
 it.each(['missing-tree','missing-subdirectory','missing-base','native-drift','recorded-drift'] as const)('blocks execution in an unavailable or incorrect task context (%s)',async scenario=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);const id=t.sessionIds[0]!;
  if(scenario==='missing-tree'||scenario==='missing-subdirectory'){
   const root=path.join(f.root,scenario);if(scenario==='missing-subdirectory')await mkdir(root);
   await f.store.transact(d=>{const value=f.store.requireTask(t.id,d);value.worktree={path:root,branch:'task/context',owned:true,status:'ready'};value.effectiveCwd=path.join(root,'apps','web');});f.sessions.dirs.set(id,path.join(root,'apps','web'));
  }else if(scenario==='missing-base'){
   if(path.resolve(f.projectPath)!==path.join(f.root,'repo','apps','web'))throw new Error('Unsafe test project removal');await rm(f.projectPath,{recursive:true,force:true});
  }else if(scenario==='native-drift'){f.sessions.dirs.set(id,f.gitRoot);}else{await f.store.transact(d=>{f.store.requireTask(t.id,d).effectiveCwd=f.gitRoot;});f.sessions.dirs.set(id,f.gitRoot);}
  const before=f.store.requireTask(t.id).effectiveCwd;await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:id,expectedInstruction:'Plan this task.'});
  const failed=f.store.requireTask(t.id);expect(f.sessions.sent).toEqual([]);expect(failed.pendingTransition?.status).toBe('failed');expect(failed.pendingTransition?.error?.message).toBeTruthy();expect(failed.pendingTransition?.text?.endsWith('Plan this task.')).toBe(true);expect(failed.effectiveCwd).toBe(before);expect(await f.sessions.directory(id)).toBe(scenario==='native-drift'?f.gitRoot:before);
 });
 it('leaves unassociated ordinary sessions outside the task-context guard',async()=>{
  const f=await setup();Object.assign(f.sessions,{async validateDirectory(){throw new Error('Should not validate an unrelated native session.');}});await expect(f.app.assertExecutionContext('ordinary-chat')).resolves.toBeUndefined();
 });

 it.each([false,true])('executes at base after returning while retaining an inactive ready worktree (missing=%s)',async missing=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);const root=path.join(f.root,'retained-inactive-tree');
  await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:root,branchName:'task/inactive',sourceBranch:'main'});
  await f.app.command({type:'operation.return',taskId:t.id});
  const returned=f.store.requireTask(t.id);expect(returned.worktree).toMatchObject({path:root,status:'ready'});expect(returned.effectiveCwd).toBe(f.projectPath);
  if(missing){if(path.dirname(root)!==f.root||path.basename(root)!=='retained-inactive-tree')throw new Error('Unsafe inactive test worktree removal');await rm(root,{recursive:true,force:true});}
  await expect(f.app.assertExecutionContext(t.sessionIds[0]!)).resolves.toBeUndefined();
  const second=await f.app.createConversation(t.id);expect(await f.sessions.directory(second)).toBe(f.projectPath);await expect(f.app.assertExecutionContext(second)).resolves.toBeUndefined();
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:second,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(second);expect(f.store.requireTask(t.id).effectiveCwd).toBe(f.projectPath);expect(await f.sessions.directory(second)).toBe(f.projectPath);
 });
 it('permits base execution after a cancelled failed run returns from a retained ready tree',async()=>{
  const f=await setup();const columnId=await instructed(f);const t=await task(f);const root=path.join(f.root,'cancelled-run-tree');
  await f.app.command({type:'worktree.create',taskId:t.id,mode:'new',path:root,branchName:'task/cancelled',sourceBranch:'main'});f.sessions.failSend=true;
  await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:t.sessionIds[0]!,expectedInstruction:'Plan this task.'});expect(f.store.requireTask(t.id).pendingTransition?.status).toBe('failed');
  await f.app.command({type:'operation.return',taskId:t.id});const returned=f.store.requireTask(t.id);expect(returned.pendingTransition).toBeUndefined();expect(returned.worktree).toMatchObject({path:root,status:'ready'});expect(returned.effectiveCwd).toBe(f.projectPath);
  f.sessions.failSend=false;const second=await f.app.createConversation(t.id);await expect(f.app.assertExecutionContext(second)).resolves.toBeUndefined();
  await f.app.command({type:'task.move',taskId:t.id,columnId:'backlog',mode:'move'});await f.app.command({type:'task.move',taskId:t.id,columnId,mode:'run',sessionId:second,expectedInstruction:'Plan this task.'});
  expect(f.sessions.sent).toHaveLength(1);expect(f.sessions.sent[0]!.id).toBe(second);expect(await f.sessions.directory(second)).toBe(f.projectPath);expect(f.store.requireTask(t.id).pendingTransition).toBeUndefined();
 });

});
