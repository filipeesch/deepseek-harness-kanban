import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { KanbanApp } from '../../src/host/app.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { TURN_ADVANCE_SETTLE_MS } from '../../src/host/turn-advance.js';
import type { DeterministicCapture } from '../../src/shared/deterministic.js';
import type { CaptureRequest, DeterministicRuntime, DeterministicScope, ExecuteRequest, ExecutionOutcome } from '../../src/host/deterministic/ports.js';
import { SnapshotSchema } from '../../src/remote.js';
import { fixture } from './helpers.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
interface NativeAttempt { request: ExecuteRequest; resolve(value: ExecutionOutcome): void; ignoreAbort: boolean }
/** Native-shaped fake: no provider, process, model, network, or personal profile is used. */
class FakeNativeRuntime implements DeterministicRuntime {
  trusted = true;
  readonly runs: NativeAttempt[] = [];
  readonly files = new Map<string, string>();
  readonly sources = new Map<string, string>();
  readonly approvals = new Set<string>();
  readonly values = new Map<string, string>();
  private sequence = 0;
  private scope(scope: DeterministicScope): string { return [scope.hubId, scope.boardId, scope.projectId, scope.stageIdentity].join('/'); }
  capture = vi.fn(async (request: CaptureRequest): Promise<DeterministicCapture> => {
    const code = request.definition.code ?? this.files.get(request.definition.file!);
    if (code === undefined) throw new Error('The synthetic primary file is missing.');
    const executionDirectory = request.definition.directory === 'project' ? request.projectDirectory : request.taskDirectory ?? request.projectDirectory;
    const sourceRef = 'private-source-' + (++this.sequence);
    this.sources.set(sourceRef, code);
    return { sourceRef, fingerprint: createHash('sha256').update(JSON.stringify({ code, definition: request.definition, executionDirectory, exits: request.exits })).digest('hex'), language: request.definition.language, directory: request.definition.directory, executionDirectory,
      source: request.definition.file === undefined ? { kind: 'inline' } : { kind: 'file', path: request.definition.file }, env: [...(request.definition.env ?? [])], exits: structuredClone(request.exits) };
  });
  loadCapture = vi.fn(async (capture: DeterministicCapture) => { const source = this.sources.get(capture.sourceRef); if (source === undefined) throw new Error('Missing immutable source.'); return source; });
  collectSources = vi.fn(async (_references: readonly string[]) => {});
  verify = vi.fn(async (_capture: DeterministicCapture, _signal?: AbortSignal) => {});
  reclaim = vi.fn(async (_executionId: string) => {});
  execute = vi.fn(async (request: ExecuteRequest): Promise<ExecutionOutcome> => {
    const gate = deferred<ExecutionOutcome>();
    const attempt: NativeAttempt = { request, resolve: gate.resolve, ignoreAbort: false };
    this.runs.push(attempt);
    request.signal.addEventListener('abort', () => { if (!attempt.ignoreAbort) gate.resolve({ kind: 'aborted' }); }, { once: true });
    if (request.signal.aborted) gate.resolve({ kind: 'aborted' });
    return gate.promise;
  });
  trust = {
    isApproved: vi.fn(async (scope: DeterministicScope, fingerprint: string) => this.trusted || this.approvals.has(this.scope(scope) + '/' + fingerprint)),
    approve: vi.fn(async (scope: DeterministicScope, fingerprint: string) => { this.approvals.add(this.scope(scope) + '/' + fingerprint); }),
    reject: vi.fn(async (scope: DeterministicScope, fingerprint: string) => { this.approvals.delete(this.scope(scope) + '/' + fingerprint); }),
  };
  variables = {
    status: vi.fn(async (scope: DeterministicScope, names: readonly string[]) => names.map(name => ({ name, configured: this.values.has(this.scope(scope) + '/' + name) }))),
    set: vi.fn(async (scope: DeterministicScope, name: string, value: string) => { this.values.set(this.scope(scope) + '/' + name, value); }),
    remove: vi.fn(async (scope: DeterministicScope, name: string) => { this.values.delete(this.scope(scope) + '/' + name); }),
    resolve: vi.fn(async (scope: DeterministicScope, names: readonly string[]) => Object.fromEntries(names.map(name => [name, this.values.get(this.scope(scope) + '/' + name) ?? '']))),
  };
}
const POLL = { timeout: 2500, interval: 5 };
const SOURCE = 'return { exit: "manual", message: "Synthetic CI passed" };';
function flow(options: { source?: string; file?: string; env?: string[]; mode?: 'script' | 'agent' | 'manual'; target?: string } = {}): string {
  const definition = { language: 'typescript', ...(options.file === undefined ? { code: options.source ?? SOURCE } : { file: options.file }), directory: 'task', ...(options.env === undefined ? {} : { env: options.env }), exits: options.target === undefined ? { manual: 'manual', script: 'next_script', agent: 'agent', error: 'repair' } : { manual: options.target, error: 'repair' } };
  const behavior = options.mode === 'agent' ? '    on_enter_prompt: A newly saved agent instruction.\n' : options.mode === 'manual' ? '' : '    deterministic: ' + JSON.stringify(definition) + '\n';
  return 'name: Deterministic fixture\ninitial_column: wait\ncolumns:\n  - id: wait\n    label: Wait for synthetic CI\n' + behavior
    + '  - {id: manual, label: Manual review}\n  - {id: next_script, label: Next script, deterministic: {language: bash, code: "echo second", exits: {done: done}}}\n  - {id: agent, label: Agent review, on_enter_prompt: Analyze the incoming result.}\n  - {id: repair, label: Repair}\n  - {id: done, label: Done}\n  - {id: forbidden, label: Outside declared routes}\n';
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const fixtures: Fixture[] = [];
const extraApps: KanbanApp[] = [];
const runtimes: FakeNativeRuntime[] = [];
afterEach(async () => { vi.useRealTimers(); for (const runtime of runtimes.splice(0)) for (const run of runtime.runs) run.resolve({ kind: 'aborted' }); for (const app of extraApps.splice(0)) await app.close(); for (const f of fixtures.splice(0)) await f.close(); });
async function setup(options: { yaml?: string; initialize?: boolean; trusted?: boolean } = {}) {
  const f = await fixture(); fixtures.push(f);
  const runtime = new FakeNativeRuntime(); runtimes.push(runtime); runtime.trusted = options.trusted ?? true;
  await f.store.setWorkflow(options.yaml ?? flow());
  f.app.attachDeterministicRuntime(runtime);
  if (options.initialize !== false) await f.app.initialize();
  return { ...f, runtime };
}
async function create(f: Awaited<ReturnType<typeof setup>>) { return f.app.createTask({ projectId: f.project.id, title: 'Synthetic wait', description: 'No external services', autoMode: false }); }
async function attempt(runtime: FakeNativeRuntime, index = 0) { await expect.poll(() => runtime.runs.length, POLL).toBeGreaterThan(index); return runtime.runs[index]!; }
function complete(run: NativeAttempt, exit = 'manual', message = 'Synthetic CI passed'): void { run.resolve({ kind: 'completed', completion: { exit, message }, diagnostics: [] }); }
async function reopen(f: Awaited<ReturnType<typeof setup>>) {
  const hubs = await HubRepository.open(f.storage);
  const app = new KanbanApp(hubs, f.sessions, f.git, {}, f.workspaces); extraApps.push(app);
  app.attachDeterministicRuntime(f.runtime); await app.initialize();
  return { hubs, app };
}

describe('deterministic execution through the real app and durable repository', () => {
  it('activates a genuine no-auto entry without creating a conversation and requires local trust', async () => {
    const f = await setup({ trusted: false }); const task = await create(f);
    await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('awaiting-trust');
    expect(f.runtime.runs).toEqual([]); expect(f.sessions.dirs.size).toBe(0); expect(f.sessions.sent).toEqual([]);
    const review = await f.app.deterministicReview(task.id);
    expect(review.code).toBe(SOURCE); expect(review.executionId).toBe(f.store.requireTask(task.id).deterministic!.executionId);
    await f.app.command({ type: 'task.deterministicApprove', taskId: task.id, executionId: review.executionId, fingerprint: review.fingerprint });
    await attempt(f.runtime);
    expect(f.runtime.trust.approve).toHaveBeenCalledOnce(); expect(f.store.requireTask(task.id).autoMode?.enabled).not.toBe(true);
    expect(f.store.requireTask(task.id).sessionIds).toEqual([]);
  });

  it('keeps primary file bytes, captures, and variables private while publishing safe activity and redacted results', async () => {
    const f = await setup({ trusted: false, yaml: flow({ file: 'synthetic-ci.ts', env: ['CI_TOKEN'] }) });
    const privateCode = 'PRIVATE_PRIMARY_BYTES: return input;'; const secret = 'synthetic-secret-not-for-snapshots'; f.runtime.files.set('synthetic-ci.ts', privateCode);
    const task = await create(f); await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('awaiting-trust');
    const active = f.store.requireTask(task.id);
    await f.app.command({ type: 'task.deterministicVariable', taskId: task.id, projectId: active.projectId, stageIdentity: active.stageEntry!.stageIdentity, name: 'CI_TOKEN', value: secret });
    const review = await f.app.deterministicReview(task.id); expect(review.code).toBe(privateCode); expect(review.variables).toEqual([{ name: 'CI_TOKEN', configured: true }]); expect(JSON.stringify(review)).not.toContain(secret);
    await f.app.command({ type: 'task.deterministicApprove', taskId: task.id, executionId: review.executionId, fingerprint: review.fingerprint }); const run = await attempt(f.runtime);
    const snapshot = await f.app.snapshot(); expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id)?.deterministic).toBeUndefined(); expect(snapshot.deterministic?.[task.id]).toMatchObject({ phase: 'active', executionId: review.executionId, fingerprint: review.fingerprint });
    const serialized = JSON.stringify(snapshot); for (const privateValue of [privateCode, secret, run.request.capture.sourceRef]) expect(serialized).not.toContain(privateValue);
    expect(JSON.stringify(run.request.input)).not.toContain(secret);
    complete(run, 'manual', 'CI said ' + secret);
    await expect.poll(() => f.store.requireTask(task.id).columnId, POLL).toBe('manual');
    expect(f.store.requireTask(task.id).deterministicHandoff?.message).toBe('CI said [REDACTED]'); expect(JSON.stringify(await f.app.snapshot())).not.toContain(secret);
  });

  it('Stop and Play keep the entry but replace logical execution identity and capture the latest source', async () => {
    const f = await setup(); const task = await create(f); const first = await attempt(f.runtime); const before = f.store.requireTask(task.id); const original = before.deterministic!;
    await f.app.command({ type: 'task.deterministicStop', taskId: task.id, executionId: original.executionId });
    expect(first.request.signal.aborted).toBe(true); expect(f.store.requireTask(task.id).deterministic?.phase).toBe('stopped');
    const updated = SOURCE + '\n// Corrected source'; await f.store.setWorkflow(flow({ source: updated }));
    await f.app.command({ type: 'task.deterministicPlay', taskId: task.id }); const second = await attempt(f.runtime, 1); const after = f.store.requireTask(task.id);
    expect(after.stageEntry).toEqual(before.stageEntry); expect(after.deterministic?.executionId).not.toBe(original.executionId); expect(after.deterministic?.startedAt).not.toBe(original.startedAt);
    expect(f.runtime.sources.get(second.request.capture.sourceRef)).toBe(updated); expect(after.columnId).toBe('wait'); expect(after.history?.filter(value => value.kind === 'created' || value.kind === 'stage')).toHaveLength(1);
    await expect(f.app.command({ type: 'task.deterministicStop', taskId: task.id, executionId: original.executionId })).rejects.toMatchObject({ code: 'STALE_EXECUTION' }); expect(second.request.signal.aborted).toBe(false);
  });

  it.each(['agent', 'manual'] as const)('a saved %s mode cannot steal owned execution or enable incidental turn movement', async mode => {
    const f = await setup(); const task = await create(f); const first = await attempt(f.runtime); const executionId = f.store.requireTask(task.id).deterministic!.executionId;
    await f.store.setWorkflow(flow({ mode }));
    const snapshot = await f.app.snapshot(); expect(snapshot.deterministic?.[task.id]).toMatchObject({ executionId, phase: 'active', savedVersionChanged: true }); expect(f.store.requireTask(task.id).instructionPending).toBeUndefined();
    await f.app.command({ type: 'task.autoMode', taskId: task.id, enabled: true });
    await f.app.command({ type: 'worktree.dismiss', taskId: task.id }); const sessionId = await f.app.createConversation(task.id);
    vi.useFakeTimers();
    try { f.app.observe(sessionId, { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } }); await vi.advanceTimersByTimeAsync(TURN_ADVANCE_SETTLE_MS + 25); } finally { vi.useRealTimers(); }
    await f.app.command({ type: 'task.edit', taskId: task.id, title: 'Still owned' }); expect(f.store.requireTask(task.id).columnId).toBe('wait');
    await f.app.command({ type: 'task.deterministicStop', taskId: task.id, executionId }); expect(first.request.signal.aborted).toBe(true);
    await expect(f.app.command({ type: 'task.deterministicPlay', taskId: task.id })).rejects.toMatchObject({ code: 'DETERMINISTIC_CONFIGURATION_REQUIRED' }); expect(f.sessions.sent).toEqual([]);
  });

  it('refuses undeclared movement without canceling, then invalidates a late result after an accepted move-away-and-back', async () => {
    const f = await setup(); const task = await create(f); const first = await attempt(f.runtime); first.ignoreAbort = true; const entryId = f.store.requireTask(task.id).stageEntry!.id;
    await expect(f.app.command({ type: 'task.move', taskId: task.id, columnId: 'forbidden' })).rejects.toMatchObject({ code: 'TRANSITION_NOT_ALLOWED' }); expect(first.request.signal.aborted).toBe(false);
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'manual' }); expect(first.request.signal.aborted).toBe(true);
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'wait' }); expect(f.store.requireTask(task.id).stageEntry!.id).not.toBe(entryId);
    complete(first, 'agent', 'Stale completion must not enter agent review'); const second = await attempt(f.runtime, 1);
    expect(second.request.executionId).not.toBe(first.request.executionId); expect(f.store.requireTask(task.id).columnId).toBe('wait'); expect(f.sessions.sent).toEqual([]); expect(f.store.requireTask(task.id).deterministicHandoff).toBeUndefined();
  });

  it('recovers a capture-pending entry after close/reopen without manufacturing a new stage entry', async () => {
    const f = await setup({ initialize: false }); const task = await create(f); const pending = f.store.requireTask(task.id).deterministic!; const entry = f.store.requireTask(task.id).stageEntry;
    expect(pending.phase).toBe('capture-pending'); expect(f.runtime.capture).not.toHaveBeenCalled(); await f.store.setWorkflow(flow({ source: 'CHANGED_AFTER_DURABLE_ENTRY' })); await f.app.close();
    const restarted = await reopen(f); await attempt(f.runtime);
    expect(restarted.hubs.requireTask(task.id).task.stageEntry).toEqual(entry); expect(restarted.hubs.requireTask(task.id).task.deterministic).toMatchObject({ executionId: pending.executionId, startedAt: pending.startedAt, phase: 'active' });
    expect(f.runtime.capture.mock.calls[0]?.[0].definition.code).toBe(SOURCE);
  });

  it('does not retroactively activate a legacy occupied card, but explicit Play starts it without a new placement fact', async () => {
    const f = await setup({ initialize: false }); const task = await create(f);
    await f.store.transact(draft => { const current = draft.tasks.find(value => value.id === task.id)!; delete current.stageEntry; delete current.deterministic; });
    await f.store.setWorkflow(flow({ source: 'EXPLICIT_PLAY_ONLY' })); await f.app.initialize(); await f.app.whenSettled();
    expect(f.runtime.capture).not.toHaveBeenCalled(); expect(f.runtime.runs).toHaveLength(0);
    await f.app.command({ type: 'task.deterministicPlay', taskId: task.id }); const run = await attempt(f.runtime);
    expect(f.runtime.sources.get(run.request.capture.sourceRef)).toBe('EXPLICIT_PLAY_ONLY'); expect(f.store.requireTask(task.id).history?.filter(value => value.kind === 'created' || value.kind === 'stage')).toHaveLength(1); expect(f.sessions.sent).toEqual([]);
  });

  it('restarts only active captured source with the same logical start and does not restart stopped state', async () => {
    const f = await setup({ yaml: flow({ file: 'recovery.ts' }) }); f.runtime.files.set('recovery.ts', 'ORIGINAL_PRIVATE_SOURCE'); const task = await create(f); const first = await attempt(f.runtime); const active = f.store.requireTask(task.id).deterministic!;
    f.runtime.files.set('recovery.ts', 'CHANGED_UNREVIEWED_SOURCE'); await f.store.setWorkflow(flow({ file: 'different.ts' })); await f.app.close(); expect(first.request.signal.aborted).toBe(true);
    const restarted = await reopen(f); const second = await attempt(f.runtime, 1); const recovered = restarted.hubs.requireTask(task.id).task.deterministic!;
    expect(recovered).toMatchObject({ executionId: active.executionId, entryId: active.entryId, startedAt: active.startedAt, attempt: 2, restartCount: 1 }); expect(recovered.attemptId).not.toBe(active.attemptId); expect(f.runtime.capture).toHaveBeenCalledOnce(); expect(f.runtime.sources.get(second.request.capture.sourceRef)).toBe('ORIGINAL_PRIVATE_SOURCE');
    await restarted.app.command({ type: 'task.deterministicStop', taskId: task.id, executionId: recovered.executionId }); await restarted.app.close();
    const again = await reopen(f); await again.app.whenSettled(); expect(again.hubs.requireTask(task.id).task.deterministic?.phase).toBe('stopped'); expect(f.runtime.runs).toHaveLength(2);
  });

  it.each(['manual', 'script', 'agent'] as const)('routes a named %s result exactly and carries the same execution provenance', async exit => {
    const f = await setup(); const task = await create(f); const first = await attempt(f.runtime); complete(first, exit, 'Named result for ' + exit);
    const destination = exit === 'script' ? 'next_script' : exit; await expect.poll(() => f.store.requireTask(task.id).columnId, POLL).toBe(destination); const current = f.store.requireTask(task.id);
    expect(current.deterministicHandoff).toMatchObject({ executionId: first.request.executionId, fromColumnId: 'wait', columnId: destination, exit, message: 'Named result for ' + exit, entryId: current.stageEntry!.id });
    if (exit === 'script') { const second = await attempt(f.runtime, 1); expect((second.request.input as { handoff?: { message?: string } }).handoff?.message).toBe('Named result for script'); expect(f.sessions.dirs.size).toBe(0); }
    else if (exit === 'agent') { await expect.poll(() => f.sessions.sent.length, POLL).toBe(1); expect(f.sessions.sent[0]).toMatchObject({ kind: 'stage-instruction', requestId: current.deterministicHandoff!.id }); expect(f.sessions.sent[0]!.text).toContain('Named result for agent'); }
    else { expect(f.runtime.runs).toHaveLength(1); expect(f.sessions.sent).toEqual([]); expect(f.sessions.dirs.size).toBe(0); }
  });

  it('retains a failed native handoff across restart and retries with its existing delivery identity', async () => {
    const f = await setup(); f.sessions.failSend = true; const task = await create(f); const run = await attempt(f.runtime); complete(run, 'agent', 'Review this synthetic result');
    await expect.poll(() => f.store.requireTask(task.id).deterministicHandoff?.error?.code, POLL).toBe('SEND_FAILED'); const failed = f.store.requireTask(task.id); const handoff = failed.deterministicHandoff!;
    await f.app.close(); const restarted = await reopen(f); expect(f.sessions.sent).toEqual([]); expect(f.runtime.runs).toHaveLength(1);
    f.sessions.failSend = false; const marker = restarted.hubs.requireTask(task.id).task.instructionPending!;
    await restarted.app.command({ type: 'task.runInstruction', taskId: task.id, columnId: 'agent', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Analyze the incoming result.' });
    expect(f.sessions.sent).toHaveLength(1); expect(f.sessions.sent[0]!.requestId).toBe(handoff.id); expect(restarted.hubs.requireTask(task.id).task.deterministicHandoff?.acceptedAt).toBeDefined(); expect(f.runtime.runs).toHaveLength(1);
    expect(restarted.hubs.requireTask(task.id).task.history?.filter(value => value.kind === 'deterministic-handoff').map(value => value.outcome)).toEqual(['failed', 'accepted']);
  });

  it('delivers the trusted captured destination even after the saved mapping points somewhere else', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime);
    await f.store.setWorkflow(flow({ target: 'forbidden' })); complete(run, 'manual', 'Keep the captured manual destination');
    await expect.poll(() => f.store.requireTask(task.id).columnId, POLL).toBe('manual');
    expect(f.store.requireTask(task.id).deterministicHandoff?.message).toBe('Keep the captured manual destination'); expect(f.runtime.runs).toHaveLength(1);
  });

  it('refuses target identifier reuse instead of redirecting an approved captured result', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); const identity = run.request.capture.exits.manual!.stageIdentity;
    await f.store.setWorkflow(flow({ target: 'forbidden' }).replace('  - {id: manual, label: Manual review}\n', ''));
    await f.store.setWorkflow(flow());
    complete(run, 'manual', 'An old identity may not select a replacement stage');
    await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('failed');
    const current = f.store.requireTask(task.id); expect(current.columnId).toBe('wait'); expect(current.deterministic?.result?.error?.code).toBe('DETERMINISTIC_TARGET_REMOVED');
    expect(f.hubs.requireTask(task.id).board.localStageIdentities?.manual).not.toBe(identity); expect(f.sessions.sent).toEqual([]); expect(f.runtime.runs).toHaveLength(1);
  });

  it.each(['task.delete', 'worktree.remove'] as const)('a mismatched %s confirmation does not revoke or abort its current execution', async type => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); const current = f.store.requireTask(task.id).deterministic!;
    await expect(f.app.command({ type, taskId: task.id, confirmed: true, expectedWorktreePath: path.join(f.root, 'not-the-confirmed-checkout') })).rejects.toMatchObject({ code: 'WORKTREE_CHANGED' });
    expect(run.request.signal.aborted).toBe(false); expect(f.store.requireTask(task.id).deterministic).toMatchObject({ executionId: current.executionId, phase: 'active' }); expect(f.git.removed).toEqual([]);
  });

  it('drains native cancellation before removing a checkout while unrelated task commands continue', async () => {
    const f = await setup({ initialize: false }); const task = await create(f); const tree = path.join(f.root, 'script-owned-tree');
    await f.app.command({ type: 'worktree.create', taskId: task.id, mode: 'new', path: tree, branchName: 'task/script-owned', sourceBranch: 'main' });
    await f.app.initialize(); await f.app.command({ type: 'task.deterministicPlay', taskId: task.id }); const run = await attempt(f.runtime); run.ignoreAbort = true;
    const unrelated = await create(f); await attempt(f.runtime, 1);
    let drained = false; const originalRemove = f.git.remove.bind(f.git); const remove = vi.fn(async (...args: Parameters<typeof originalRemove>) => { expect(drained).toBe(true); expect(run.request.signal.aborted).toBe(true); return originalRemove(...args); }); f.git.remove = remove;
    let changed = false; const removing = f.app.command({ type: 'worktree.remove', taskId: task.id, confirmed: true, expectedWorktreePath: tree });
    const editing = f.app.command({ type: 'task.edit', taskId: unrelated.id, title: 'Independent command completed' }).then(() => { changed = true; });
    try {
      await expect.poll(() => run.request.signal.aborted, POLL).toBe(true); await expect.poll(() => changed, POLL).toBe(true);
      expect(remove).not.toHaveBeenCalled(); expect(f.store.requireTask(task.id).effectiveCwd).toBe(path.join(tree, 'apps', 'web')); expect(f.store.requireTask(task.id).operation).toBeNull();
    } finally { drained = true; run.resolve({ kind: 'aborted' }); await removing; await editing; }
    await f.app.worktrees.settle(); expect(remove).toHaveBeenCalledOnce(); expect(f.store.requireTask(task.id).worktree).toBeNull(); expect(f.store.requireTask(task.id).effectiveCwd).toBe(f.projectPath); expect(f.store.requireTask(unrelated.id).title).toBe('Independent command completed');
  });

  it('does not change project or task directories until the old native execution has drained', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); run.ignoreAbort = true;
    const movedRoot = path.join(f.root, 'new-project-location'); const projectPath = path.join(movedRoot, 'apps', 'web'); await mkdir(projectPath, { recursive: true });
    f.probe.locations.set(projectPath, { kind: 'git', projectPath, gitRootPath: movedRoot, defaultBranch: 'main' }); f.probe.locations.set(movedRoot, { kind: 'git', projectPath: movedRoot, gitRootPath: movedRoot, defaultBranch: 'main' });
    const relocating = f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath, gitRootPath: movedRoot, defaultBranch: 'main' }, confirmed: true });
    try {
      await expect.poll(() => run.request.signal.aborted, POLL).toBe(true);
      expect(f.store.requireProject(f.project.id).projectPath).toBe(f.projectPath); expect(f.store.requireProject(f.project.id).operation).toBeUndefined(); expect(f.store.requireTask(task.id).effectiveCwd).toBe(f.projectPath);
    } finally { run.resolve({ kind: 'aborted' }); await relocating; }
    await f.app.relocations.settle(); expect(f.store.requireProject(f.project.id).operation).toBeUndefined(); expect(f.store.requireProject(f.project.id).projectPath).toBe(projectPath); expect(f.store.requireTask(task.id).effectiveCwd).toBe(projectPath); expect(f.store.requireTask(task.id).deterministic?.phase).toBe('stopped'); expect(f.runtime.runs).toHaveLength(1);
  });

  it('refuses Play during an awaited project relocation admission', async () => {
    const f = await setup(); const task = await create(f); await attempt(f.runtime);
    const movedRoot = path.join(f.root, 'blocked-project-location'); const projectPath = path.join(movedRoot, 'apps', 'web'); await mkdir(projectPath, { recursive: true });
    f.probe.locations.set(projectPath, { kind: 'git', projectPath, gitRootPath: movedRoot, defaultBranch: 'main' });
    f.probe.locations.set(movedRoot, { kind: 'git', projectPath: movedRoot, gitRootPath: movedRoot, defaultBranch: 'main' });
    const gate = deferred<void>(); const called = deferred<void>(); const inspect = f.probe.inspect.bind(f.probe);
    vi.spyOn(f.probe, 'inspect').mockImplementation(async value => { called.resolve(); await gate.promise; return inspect(value); });
    const relocating = f.app.command({ type: 'project.relocate', project: { id: f.project.id, name: f.project.name, projectPath, gitRootPath: movedRoot, defaultBranch: 'main' }, confirmed: true });
    try {
      await called.promise;
      await expect(f.app.command({ type: 'task.deterministicPlay', taskId: task.id })).rejects.toMatchObject({ code: 'CONTEXT_ADMISSION_PENDING' });
      expect(f.runtime.runs).toHaveLength(1);
    } finally { gate.resolve(); await relocating; }
    await f.app.relocations.settle(); expect(f.store.requireProject(f.project.id).projectPath).toBe(projectPath);
  });

  it('collects private sources only after task deletion commits and the native owner drains', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); run.ignoreAbort = true;
    f.runtime.collectSources.mockClear();
    f.runtime.collectSources.mockImplementation(async references => { expect(f.hubs.findTask(task.id)).toBeUndefined(); expect(run.request.signal.aborted).toBe(true); expect(references).not.toContain(run.request.capture.sourceRef); });
    const deleting = f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    try { await expect.poll(() => run.request.signal.aborted, POLL).toBe(true); expect(f.hubs.findTask(task.id)).toBeDefined(); expect(f.runtime.collectSources).not.toHaveBeenCalled(); }
    finally { run.resolve({ kind: 'aborted' }); await deleting; }
    await f.app.worktrees.settle(); expect(f.hubs.findTask(task.id)).toBeUndefined(); expect(f.runtime.collectSources).toHaveBeenCalledOnce();
  });

  it('waits for an old script owner before deleting a card moved to a manual stage', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); run.ignoreAbort = true;
    const executionId = f.store.requireTask(task.id).deterministic!.executionId;
    await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'manual' });
    expect(f.store.requireTask(task.id).deterministic).toBeUndefined();
    expect(f.store.requireTask(task.id).history?.filter(row => row.kind === 'deterministic-execution' && row.executionId === executionId)).toMatchObject([{ outcome: 'stopped' }]);
    const deletion = f.app.command({ type: 'task.delete', taskId: task.id, confirmed: true, expectedWorktreePath: null });
    try {
      await expect.poll(() => run.request.signal.aborted, POLL).toBe(true);
      expect(f.hubs.findTask(task.id)).toBeDefined();
    } finally { run.resolve({ kind: 'aborted' }); await deletion; }
    await f.app.worktrees.settle(); expect(f.hubs.findTask(task.id)).toBeUndefined();
  });

  it('resumes a saved result after restart without recapturing or rerunning the external check', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); await f.app.command({ type: 'worktree.dismiss', taskId: task.id }); const sessionId = await f.app.createConversation(task.id); f.sessions.queued.add(sessionId);
    complete(run, 'manual', 'Durable completed check'); await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('result-ready'); const resultId = f.store.requireTask(task.id).deterministic!.result!.id;
    await f.app.close(); const restarted = await reopen(f); expect(restarted.hubs.requireTask(task.id).task.deterministic?.result?.id).toBe(resultId); expect(f.runtime.runs).toHaveLength(1);
    f.sessions.queued.delete(sessionId); restarted.app.sessionActivity(sessionId);
    await expect.poll(() => restarted.hubs.requireTask(task.id).task.columnId, POLL).toBe('manual'); expect(f.runtime.capture).toHaveBeenCalledOnce(); expect(f.runtime.runs).toHaveLength(1);
    expect(restarted.hubs.requireTask(task.id).task.history?.filter(value => value.kind === 'deterministic-execution')).toHaveLength(1);
  });

  it('reconciles an interrupted native handoff after plugin close without letting the old instance send', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime);
    const entered = deferred<void>(); const release = deferred<void>();
    const original = f.sessions.deliverStageInstruction.bind(f.sessions);
    f.sessions.deliverStageInstruction = async (sessionId, delivery) => { entered.resolve(); await release.promise; delivery.assertCurrent?.(); return original(sessionId, delivery); };
    complete(run, 'agent', 'Recovered without duplicate context'); await entered.promise;
    await f.app.close(); const reopening = reopen(f);
    release.resolve(); const restarted = await reopening;
    await expect.poll(() => restarted.hubs.requireTask(task.id).task.deterministicHandoff?.acceptedAt, POLL).toBeTruthy();
    expect(f.sessions.sent.filter(value => value.kind === 'stage-instruction')).toHaveLength(1);
    expect(restarted.hubs.requireTask(task.id).task.deterministicHandoff?.error).toBeUndefined();
    expect(f.runtime.runs).toHaveLength(1);
  });

  it('drops obsolete agent context after a destination move-away-and-back during awaited native admission', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime);
    const entered = deferred<void>(); const release = deferred<void>();
    const original = f.sessions.deliverStageInstruction.bind(f.sessions);
    f.sessions.deliverStageInstruction = async (sessionId, delivery) => { entered.resolve(); await release.promise; delivery.assertCurrent?.(); return original(sessionId, delivery); };
    complete(run, 'agent', 'This old context must not be admitted'); await entered.promise;
    try {
      const oldEntry = f.store.requireTask(task.id).stageEntry!.id;
      await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'manual' });
      await f.app.command({ type: 'task.move', taskId: task.id, columnId: 'agent' });
      expect(f.store.requireTask(task.id).stageEntry!.id).not.toBe(oldEntry);
    } finally { release.resolve(); }
    await f.app.command({ type: 'task.edit', taskId: task.id, title: 'Current destination entry' });
    expect(f.sessions.sent).toEqual([]); expect(f.store.requireTask(task.id).deterministicHandoff).toBeUndefined();
  });

  it('releases a saved deterministic result when an explicit task hold is resumed', async () => {
    const f = await setup(); const task = await f.app.createTask({projectId:f.project.id,title:'Held check',description:'',autoMode:true}); const run = await attempt(f.runtime);
    await f.app.command({type:'task.pause',taskId:task.id,reason:'Waiting for reviewer'});
    complete(run, 'manual', 'Saved result');
    await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('result-ready');
    await f.app.command({type:'task.resume',taskId:task.id});
    await expect.poll(() => f.store.requireTask(task.id).columnId, POLL).toBe('manual');
    expect(f.runtime.runs).toHaveLength(1);
  });

  it('rejects a variable write reviewed for another stage and writes only the reviewed scope', async () => {
    const f = await setup({ yaml: flow({ env: ['CI_TOKEN'] }) }); const task = await create(f);
    const before = f.store.requireTask(task.id); const projectId = before.projectId; const stageIdentity = before.stageEntry!.stageIdentity;
    await f.app.command({ type: 'task.deterministicVariable', taskId: task.id, projectId, stageIdentity, name: 'CI_TOKEN', value: 'reviewed-value' });
    expect(f.runtime.variables.set).toHaveBeenCalledTimes(1);
    // A move away and back replaces the entry, so the dialog's identity is stale.
    await f.store.transact(draft => { const value = draft.tasks.find(item => item.id === task.id)!; value.stageEntry = { id: 'replacement-entry', columnId: value.columnId, stageIdentity: 'replacement-stage', enteredAt: value.stageEntry!.enteredAt }; });
    await expect(f.app.command({ type: 'task.deterministicVariable', taskId: task.id, projectId, stageIdentity, name: 'CI_TOKEN', value: 'leaked-value' })).rejects.toMatchObject({ code: 'STALE_STAGE' });
    expect(f.runtime.variables.set).toHaveBeenCalledTimes(1);
    const call = (f.runtime.variables.set as unknown as { mock: { calls: Array<[{ stageIdentity: string }, string, string]> } }).mock.calls[0]!;
    expect(call[0].stageIdentity).toBe(stageIdentity); expect(call[1]).toBe('CI_TOKEN'); expect(call[2]).toBe('reviewed-value');
  });

  it('retries a failed saved delivery through the public command without running the script again', async () => {
    const f = await setup(); const task = await create(f);
    const entry = f.store.requireTask(task.id).stageEntry!; const manualIdentity = f.hubs.requireTask(task.id).board.localStageIdentities?.manual;
    if (manualIdentity === undefined) throw new Error('The fixture did not bind a stable destination identity.');
    await f.store.transact(draft => {
      const value = draft.tasks.find(item => item.id === task.id)!;
      value.deterministic = { entryId: entry.id, executionId: 'failed-execution', stageIdentity: entry.stageIdentity, definition: { language: 'typescript', code: SOURCE, directory: 'task', exits: { manual: 'manual' } }, phase: 'failed', startedAt: new Date().toISOString(), attempt: 1, restartCount: 0,
        result: { id: 'saved-result', exit: 'manual', message: 'Saved once', at: new Date().toISOString(), target: { columnId: 'manual', stageIdentity: manualIdentity }, deliveryStatus: 'failed', error: { code: 'TARGET_REMOVED', message: 'Captured stable target was removed.' } },
        error: { code: 'TARGET_REMOVED', message: 'Captured stable target was removed.' } };
    });
    await expect(f.app.command({ type: 'task.deterministicRetryDelivery', taskId: task.id, entryId: entry.id, executionId: 'another-execution' })).rejects.toMatchObject({ code: 'STALE_EXECUTION' });
    await f.app.command({ type: 'task.deterministicRetryDelivery', taskId: task.id, entryId: entry.id, executionId: 'failed-execution' });
    const after = f.store.requireTask(task.id);
    // Delivery-only retry never executes the source program again, whether the
    // result is still held locally or has already reached its destination.
    expect(f.runtime.runs).toHaveLength(0);
    if (after.deterministic) { expect(after.deterministic.result?.id).toBe('saved-result'); expect(after.deterministic.phase).not.toBe('failed'); }
    else { expect(after.columnId).toBe('manual'); expect(after.deterministicHandoff?.message).toBe('Saved once'); }
  });

  it('holds an already saved result for pending user work without rerunning the external check', async () => {
    const f = await setup(); const task = await create(f); const run = await attempt(f.runtime); await f.app.command({ type: 'worktree.dismiss', taskId: task.id }); const sessionId = await f.app.createConversation(task.id); f.sessions.awaiting.add(sessionId);
    complete(run); await expect.poll(() => f.store.requireTask(task.id).deterministic?.phase, POLL).toBe('result-ready'); expect(f.store.requireTask(task.id).columnId).toBe('wait'); expect(f.runtime.runs).toHaveLength(1);
    f.sessions.awaiting.delete(sessionId); f.app.sessionActivity(sessionId);
    await expect.poll(() => f.store.requireTask(task.id).columnId, POLL).toBe('manual'); expect(f.runtime.runs).toHaveLength(1); expect(f.sessions.sent).toEqual([]);
  });
});
