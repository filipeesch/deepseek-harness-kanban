import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { Session, SessionId, SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { SandboxExecutionPolicy, ConfinedArgv } from '@deepseek-ai/dsh-sandbox';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import { createNativePorts } from '../../src/host/native.js';
import type { Project, BoardState } from '../../src/shared/types.js';
import { registerTaskExecutionGuards } from '../../src/index.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
type Inspection = Awaited<ReturnType<Context['sessionController']['inspect']>>;
type Projection = Awaited<ReturnType<Context['sessionController']['projections']>>;
const fixturesRoot = resolve('tests/native');
let root: string;
let project: Project;

class Child extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = undefined;
  kill = vi.fn(() => { queueMicrotask(() => this.emit('close', null, 'SIGTERM')); return true; });
}
function output(options: { code?: number | null; stdout?: string; stderr?: string; signal?: string } = {}) {
  spawnMock.mockImplementation(() => {
    const child = new Child();
    queueMicrotask(() => {
      if (options.stdout) child.stdout.emit('data', Buffer.from(options.stdout));
      if (options.stderr) child.stderr.emit('data', Buffer.from(options.stderr));
      child.emit('close', options.code ?? 0, options.signal ?? null);
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
}
function envelope(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, data, seq: SessionSeq(seq), time: 1 } as SessionEvent;
}
function fixture() {
  const id = SessionId('a');
  const meta: Inspection['meta'] = { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: root };
  const session = Session.create(id, [], meta);
  let cwd = root;
  const agent = { id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } } as unknown as Agent;
  const live = new Map([[id as string, session]]);
  const inspections = new Map<string, Inspection>([['a', { meta, events: [], inheritedEventCount: SessionLogOffset(0) }]]);
  const projection = vi.fn<Context['sessionController']['projections']>().mockResolvedValue({ kind: 'sequenced', asOfSeq: -1, values: {} });
  const create = vi.fn<Context['sessionController']['create']>().mockResolvedValue({ sessionId: SessionId('new') });
  const inspect = vi.fn<Context['sessionController']['inspect']>().mockImplementation(async (key) => {
    const value = inspections.get(key);
    if (!value) throw new Error('session missing');
    return value;
  });
  const resolveAgent = vi.fn<Context['sessionController']['resolveAgent']>().mockResolvedValue({ agent });
  const prompt = vi.fn<Context['sessionController']['prompt']>().mockResolvedValue({ accepted: true });
  const list = vi.fn<Context['sessionController']['list']>().mockResolvedValue({ items: [] });
  const waterfall = vi.fn().mockResolvedValue([]);
  const set = vi.fn<Context['workingDirectory']['set']>().mockImplementation(async (_agent, path) => { cwd = path; return path; });
  const getDirectory = vi.fn<Context['workingDirectory']['get']>().mockImplementation(() => cwd);
  const ensure = vi.fn<Context['workingDirectory']['ensure']>().mockImplementation(async () => cwd);
  const archiveSession = vi.fn<Context['workspaceRegistry']['archiveSession']>().mockResolvedValue(undefined);
  const policies = new Map<string, SandboxExecutionPolicy>([['a', { mode: 'workspace-write', workspaceRoot: root, sessionId: id }]]);
  const fallback: SandboxExecutionPolicy = { mode: 'read-only', workspaceRoot: root };
  const resolvePolicy = vi.fn<Context['sandboxPolicy']['resolve']>().mockImplementation((request) =>
    request?.session ? policies.get(request.session.id) ?? fallback : fallback);
  const wrapped: ConfinedArgv = { argv: ['native-runner', '--', 'git', 'status'], enforcement: 'full', denialSignatures: ['operation not permitted'], runnerFailureRules: [{ fatalSignatures: ['runner setup failed'] }] };
  const confine = vi.fn<Context['sandbox']['confine']>().mockResolvedValue(wrapped);
  const services: Record<string, unknown> = { sandboxPolicy: { resolve: resolvePolicy }, sandbox: { confine } };
  const ctx = {
    sessionController: { create, inspect, projections: projection, resolveAgent, prompt, list },
    sessions: { get: (key: string) => live.get(key), list: () => [...live.values()] },
    agents: { get: (key: string) => key === 'a' ? agent : undefined },
    workingDirectory: { get: getDirectory, set, ensure }, workspaceRegistry: { archiveSession },
    waterfall, get: (key: string) => services[key],
  } as unknown as Context;
  return { ...createNativePorts(ctx), ctx, agent, session, live, inspections, projection, create, inspect,
    resolveAgent, prompt, list, waterfall, set, getDirectory, ensure, archiveSession, resolvePolicy, policies, fallback, wrapped, confine, services };
}

beforeEach(async () => {
  root = await mkdtemp(join(fixturesRoot, '.fixture-'));
  project = { id: 'p', name: 'Project', projectPath: root, gitRootPath: root };
  spawnMock.mockReset();
  output();
});
afterEach(async () => {
  // Verify the resolved deletion target is our own test fixture, never a project/Git root.
  if (!root.startsWith(fixturesRoot + '/.fixture-')) throw new Error('Unsafe test cleanup target');
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('native conversations', () => {
  it('creates fresh sessions in the exact project directory without prompting or reusing an id', async () => {
    const f = fixture();
    const sub = join(root, 'packages', 'api'); await mkdir(sub, { recursive: true });
    expect(await f.sessions.create(sub)).toBe('new');
    expect(f.create).toHaveBeenCalledWith({ cwd: sub });
    expect(f.prompt).not.toHaveBeenCalled();
    await expect(f.sessions.create(join(root, 'missing'))).rejects.toThrow();
  });
  it('keeps identity when changing the native effective directory', async () => {
    const f = fixture(); const destination = join(root, 'tree'); await mkdir(destination);
    await f.sessions.setDirectory('a', destination);
    expect(f.resolveAgent).toHaveBeenCalledWith('a');
    expect(f.set).toHaveBeenCalledWith(f.agent, destination, undefined);
    expect(await f.sessions.directory('a')).toBe(destination);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.session.header.cwd).toBe(root);
  });
  it('admits an existing canonical base directory without recovering, activating, prompting, or granting access', async () => {
    const f = fixture(); await f.sessions.validateDirectory('a', root);
    expect(f.ensure).not.toHaveBeenCalled(); expect(f.resolveAgent).not.toHaveBeenCalled();
    expect(f.prompt).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled(); expect(f.resolvePolicy).not.toHaveBeenCalled();
  });
  it('admits the exact ready worktree project subdirectory instead of its immutable original header cwd', async () => {
    const f = fixture(); const expected = join(root, 'ready-tree', 'packages', 'api'); await mkdir(expected, { recursive: true });
    await f.sessions.setDirectory('a', expected); await f.sessions.validateDirectory('a', expected);
    expect(f.session.header.cwd).toBe(root); expect(f.ensure).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('leaves a raw missing worktree visible for recovery but refuses execution rather than falling back to the original base', async () => {
    const f = fixture(); const missing = join(root, 'missing-tree'); f.getDirectory.mockReturnValue(missing);
    expect(await f.sessions.directory('a')).toBe(missing);
    await expect(f.sessions.validateDirectory('a', missing)).rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
    expect(await f.sessions.directory('a')).toBe(missing); expect(f.ensure).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('rejects a native-origin recovery to the original base even when the task metadata still names an existing ready tree', async () => {
    const f = fixture(); const expected = join(root, 'ready-tree'); await mkdir(expected); await f.sessions.setDirectory('a', expected);
    await f.ctx.workingDirectory.set(f.agent, root);
    await expect(f.sessions.validateDirectory('a', expected)).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
    expect(await f.sessions.directory('a')).toBe(root); expect(f.ensure).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('refuses a missing native effective directory even when the expected base and immutable header are valid', async () => {
    const f = fixture(); f.getDirectory.mockReturnValue(join(root, 'missing-current'));
    await expect(f.sessions.validateDirectory('a', root)).rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
    expect(f.ensure).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('refuses a missing base directory rather than treating a recorded matching string as sufficient', async () => {
    const f = fixture(); const missing = join(root, 'missing-base'); f.getDirectory.mockReturnValue(missing);
    await expect(f.sessions.validateDirectory('a', missing)).rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
    expect(f.ensure).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('requires a canonical expected path but compares the actual native directory canonically', async () => {
    const f = fixture(); const alias = join(root, 'alias'); await symlink(root, alias);
    await expect(f.sessions.validateDirectory('a', alias)).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
    f.getDirectory.mockReturnValue(alias); await f.sessions.validateDirectory('a', root);
    expect(f.ensure).not.toHaveBeenCalled(); expect(f.resolvePolicy).not.toHaveBeenCalled();
  });
  it('validates a cold exact projected directory without resuming its Agent or trusting the original header', async () => {
    const f = fixture(); const expected = join(root, 'cold-tree', 'api'); await mkdir(expected, { recursive: true }); f.live.clear();
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 1, values: { workingDirectory: expected } });
    await f.sessions.validateDirectory('a', expected); expect(f.resolveAgent).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled(); expect(f.ensure).not.toHaveBeenCalled();
  });
  it('rejects a native directory commit occurring while canonical validation awaited filesystem I/O', async () => {
    const f = fixture(); const expected = join(root, 'ready-tree'); await mkdir(expected);
    f.getDirectory.mockReturnValueOnce(expected).mockReturnValueOnce(root);
    await expect(f.sessions.validateDirectory('a', expected)).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
    expect(f.prompt).not.toHaveBeenCalled(); expect(f.ensure).not.toHaveBeenCalled();
  });

  it('blocks the real native adapter at post-assembly admission after native recovery from a missing tree', async () => {
    const f = fixture(); const expected = join(root, 'missing-tree'); f.getDirectory.mockReturnValue(expected);
    f.ensure.mockImplementation(async () => { f.getDirectory.mockReturnValue(root); return root; });
    await f.ctx.workingDirectory.ensure(f.agent); // Simulate the published assembly hook's native recovery before pre-step.
    const events = new Context(); const model = vi.fn();
    const dispose = registerTaskExecutionGuards(events, { snapshot: () => ({ tasks: [{ sessionIds: ['a'] }] } as unknown as BoardState) }, { assertExecutionContext: id => f.sessions.validateDirectory(id, expected) });
    try {
      await expect(events.waterfall('agent/pre-step', { agent: f.agent, turn: 1, step: 1, signal: new AbortController().signal, messages: [] }, async () => { model(); return { kind: 'enter' as const, messages: [] }; })).rejects.toMatchObject({ code: 'SESSION_CONTEXT_UNAVAILABLE' });
      expect(model).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled(); expect(await f.sessions.directory('a')).toBe(root);
    } finally { dispose(); }
  });
  it('blocks the real native adapter after downstream request middleware commits native directory drift', async () => {
    const f = fixture(); const expected = join(root, 'ready-tree', 'api'); await mkdir(expected, { recursive: true }); await f.sessions.setDirectory('a', expected);
    const events = new Context(); const model = vi.fn();
    const dispose = registerTaskExecutionGuards(events, { snapshot: () => ({ tasks: [{ sessionIds: ['a'] }] } as unknown as BoardState) }, { assertExecutionContext: id => f.sessions.validateDirectory(id, expected) });
    events.on('agent/request', async (_payload, next) => { const config = await next(); await f.ctx.workingDirectory.set(f.agent, root); return config; });
    const config = { provider: 'test', model: 'test' } as Parameters<Context['llm']['prepareCall']>[0];
    try {
      await expect(events.waterfall('agent/request', { agent: f.agent, turn: 1, step: 1, signal: new AbortController().signal }, async () => config).then(value => model(value))).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
      expect(model).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled(); expect(f.ensure).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it.each(['turn', 'job', 'subagent', 'schedule'])('waits for native %s activity, never cancelling it', async (kind) => {
    const f = fixture(); f.waterfall.mockResolvedValue([{ kind, items: [{ id: 'busy' }] }]);
    expect(await f.sessions.isIdle('a')).toBe(false);
    await expect(f.sessions.setDirectory('a', root)).rejects.toMatchObject({ code: 'SESSION_ACTIVE' });
    await expect(f.sessions.archive('a')).rejects.toMatchObject({ code: 'SESSION_ACTIVE' });
    expect(f.set).not.toHaveBeenCalled(); expect(f.archiveSession).not.toHaveBeenCalled();
    expect(f.waterfall).toHaveBeenCalledWith('workspace/session-activity', { sessionId: 'a' }, expect.any(Function));
  });
  it('rechecks native activity after resolving a cold Agent', async () => {
    const f = fixture(); f.waterfall.mockResolvedValueOnce([]).mockResolvedValueOnce([{ kind: 'turn' }]);
    await expect(f.sessions.setDirectory('a', root)).rejects.toMatchObject({ code: 'SESSION_ACTIVE' });
    expect(f.resolveAgent).toHaveBeenCalledOnce(); expect(f.set).not.toHaveBeenCalled();
  });
  it('fails closed on missing exact activity projections', async () => {
    const f = fixture(); f.projection.mockResolvedValue({ kind: 'migration-required', values: {} });
    await expect(f.sessions.isIdle('a')).rejects.toMatchObject({ code: 'SESSION_STATE_UNAVAILABLE' });
  });
  it('recognizes open boundaries, queued inbox input, pending approvals, and continued questions', async () => {
    const f = fixture();
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 1, values: { turnBoundary: { openTurnStartSeq: 0 } } } as unknown as Projection);
    expect(await f.sessions.isIdle('a')).toBe(false);
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 1, values: { userQuestions: { active: [{ callId: 'q', state: 'continued' }] } } } as unknown as Projection);
    expect(await f.sessions.isIdle('a')).toBe(false);
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 1, values: {} });
    const previous = f.inspections.get('a')!;
    f.inspections.set('a', { ...previous, events: [envelope('approval/asked', { id: 'approval' })] });
    expect(await f.sessions.isIdle('a')).toBe(false);
    f.inspections.set('a', { ...previous, events: [envelope('approval/asked', { id: 'approval' }), envelope('approval/decided', { id: 'approval' }, 1)] });
    expect(await f.sessions.isIdle('a')).toBe(true);
  });
  it('does not mistake a non-waking cwd notice for activity, but blocks queued turns', async () => {
    const f = fixture();
    Object.assign(f.agent.inbox, { nextStep: [{ source: { kind: 'working-directory' } }] });
    expect(await f.sessions.isIdle('a')).toBe(true);
    Object.assign(f.agent.inbox, { nextTurn: [{ source: { kind: 'user' } }] });
    expect(await f.sessions.isIdle('a')).toBe(false);
  });
  it('does not declare a cold open turn or queued turn idle when boundary hints are absent', async () => {
    const f = fixture(); f.live.clear();
    const original = f.inspections.get('a')!;
    f.inspections.set('a', { ...original, events: [envelope('turn/start', { turn: 1 })] });
    expect(await f.sessions.isIdle('a')).toBe(false);
    f.inspections.set('a', original);
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 1, values: { inbox: { 'next-turn': [{}], 'next-step': [] } } } as unknown as Projection);
    expect(await f.sessions.isIdle('a')).toBe(false);
  });
  it('submits one ordinary native prompt to the selected session', async () => {
    const f = fixture(); await f.sessions.send('a', 'Implement the approved plan.');
    expect(f.prompt).toHaveBeenCalledWith({ sessionId: 'a', requestId: expect.any(String), mode: 'queue', content: [{ type: 'text', text: 'Implement the approved plan.' }] }, expect.any(AbortSignal));
    await expect(f.sessions.send('a', ' ')).rejects.toMatchObject({ code: 'EMPTY_PROMPT' });
    expect(f.prompt).toHaveBeenCalledOnce();
  });
  it('passes a stable workflow request identity through retries instead of minting another prompt', async () => {
    const f = fixture();
    f.prompt.mockRejectedValueOnce(new Error('uncertain admission')).mockResolvedValue({ accepted: true });
    await expect(f.sessions.send('a', 'Approved instruction', 'workflow-operation-42')).rejects.toThrow('uncertain admission');
    await f.sessions.send('a', 'Approved instruction', 'workflow-operation-42');
    expect(f.prompt.mock.calls.map(([request]) => request.requestId)).toEqual(['workflow-operation-42', 'workflow-operation-42']);
    await expect(f.sessions.send('a', 'Approved instruction', '')).rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' });
  });
  it('joins concurrent same-ID admission and rejects conflicting text for an in-flight identity', async () => {
    const f = fixture(); let admit!: (value: { accepted: true }) => void;
    f.prompt.mockImplementation(() => new Promise((resolveAdmission) => { admit = resolveAdmission; }));
    const first = f.sessions.send('a', 'Approved instruction', 'stable');
    const retry = f.sessions.send('a', 'Approved instruction', 'stable');
    expect(f.prompt).toHaveBeenCalledOnce();
    await expect(f.sessions.send('a', 'Different instruction', 'stable')).rejects.toMatchObject({ code: 'PROMPT_ID_CONFLICT' });
    admit({ accepted: true });
    await Promise.all([first, retry]);
  });
  it('archives without force-stopping activity or erasing native histories', async () => {
    const f = fixture(); await f.sessions.archive('a');
    expect(f.archiveSession).toHaveBeenCalledWith('a');
    expect(f.create).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled();
  });
  it('keeps running, awaiting reply, and the latest failed outcome independent; unread stays client-owned', async () => {
    const f = fixture();
    f.waterfall.mockResolvedValue([{ kind: 'job' }]);
    f.projection.mockResolvedValue({ kind: 'sequenced', asOfSeq: 3, values: { userQuestions: { active: [{ callId: 'q' }] } } } as unknown as Projection);
    const snapshot = f.inspections.get('a')!;
    f.inspections.set('a', { ...snapshot, events: [envelope('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'Failed', code: 'UNKNOWN' } } })] });
    expect(await f.sessions.attention('a')).toEqual({ running: true, unread: false, awaitingReply: true, failed: true });
    f.inspections.set('a', { ...snapshot, events: [envelope('turn/end', { turn: 1, reason: { kind: 'error' } }), envelope('turn/end', { turn: 2, reason: { kind: 'completed' } }, 1)] });
    expect((await f.sessions.attention('a')).failed).toBe(false);
  });
  it('protects cold shared worktrees using exact directories rather than immutable list cwd', async () => {
    const f = fixture(); const coldId = SessionId('cold'); const changed = join(root, 'external-tree', 'api');
    f.list.mockResolvedValue({ items: [{ sessionId: coldId, agentAvailable: false, running: false, updatedAt: 1, blank: false, cwd: root }] });
    f.projection.mockImplementation(async ({ sessionId }): Promise<Projection> => sessionId === coldId
      ? { kind: 'sequenced', asOfSeq: 0, values: { workingDirectory: changed } }
      : { kind: 'sequenced', asOfSeq: 0, values: {} });
    expect(await f.sessions.directories()).toEqual([{ sessionId: coldId, directory: changed }, { sessionId: 'a', directory: root }]);
    expect(f.resolveAgent).not.toHaveBeenCalled(); expect(f.inspect).not.toHaveBeenCalled();
  });
  it('narrows a shared-tree scan to the target path without reading unrelated cold sessions', async () => {
    const f = fixture(); const within = join(root, 'tree'); await mkdir(within); await mkdir(join(root, 'other'));
    const cold = SessionId('cold'); const unrelated = SessionId('unrelated');
    f.list.mockResolvedValue({ items: [
      { sessionId: cold, agentAvailable: false, running: false, updatedAt: 1, blank: false, cwd: root, formatStatus: 'current', projections: { kind: 'sequenced', asOfSeq: 1, values: { workingDirectory: join(within, 'api') } } },
      { sessionId: unrelated, agentAvailable: false, running: false, updatedAt: 1, blank: false, cwd: join(root, 'other'), formatStatus: 'current', projections: { kind: 'sequenced', asOfSeq: 1, values: { workingDirectory: join(root, 'other') } } },
    ] } as never);
    f.projection.mockImplementation(async ({ sessionId }): Promise<Projection> => sessionId === cold
      ? { kind: 'sequenced', asOfSeq: 1, values: { workingDirectory: join(within, 'api') } }
      : { kind: 'sequenced', asOfSeq: 1, values: { workingDirectory: join(root, 'other') } });
    expect(await f.sessions.directories(within)).toEqual([{ sessionId: cold, directory: join(within, 'api') }]);
    expect(f.inspect).not.toHaveBeenCalled();
  });
  it('reads canonical cold cwd when an unrelated aggregate projection fails without activating the peer', async () => {
    const f = fixture(); f.live.clear(); const expected = join(root, 'actual-tree', 'api');
    const snapshot = f.inspections.get('a')!; f.inspections.set('a', { ...snapshot, events: [envelope('working-directory/change', { cwd: expected })] });
    f.projection.mockRejectedValue(Object.assign(new Error('Session projection read failed'), { code: 'gateway/internal' }));
    expect(await f.sessions.directory('a')).toBe(expected); expect(f.inspect).toHaveBeenCalled();
    expect(f.resolveAgent).not.toHaveBeenCalled(); expect(f.ensure).not.toHaveBeenCalled(); expect(f.prompt).not.toHaveBeenCalled();
  });
  it('keeps a cold shared peer in the protection catalog when only aggregate projections fail', async () => {
    const f = fixture(); const id = SessionId('cold'); const expected = join(root, 'shared-tree');
    f.list.mockResolvedValue({ items: [{ sessionId: id, agentAvailable: false, running: false, updatedAt: 1, blank: false, cwd: root }] });
    f.inspections.set(id, { ...f.inspections.get('a')!, meta: { ...f.inspections.get('a')!.meta, id }, events: [envelope('working-directory/change', { cwd: expected })] });
    f.projection.mockRejectedValue(new Error('Session projections are unavailable'));
    expect(await f.sessions.directories()).toEqual([{ sessionId: id, directory: expected }, { sessionId: 'a', directory: root }]);
    expect(f.resolveAgent).not.toHaveBeenCalled(); expect(f.ensure).not.toHaveBeenCalled();
  });
  it('still fails closed if canonical peer history is unreadable after a projection error', async () => {
    const f = fixture(); f.live.clear(); f.list.mockResolvedValue({ items: [{ sessionId: SessionId('a'), agentAvailable: false, running: false, updatedAt: 1, blank: false, cwd: root }] });
    f.projection.mockRejectedValue(new Error('Session projection read failed')); f.inspect.mockRejectedValue(new Error('Canonical observation unavailable'));
    await expect(f.sessions.directories()).rejects.toThrow('Canonical observation unavailable'); expect(f.resolveAgent).not.toHaveBeenCalled();
  });
  it('propagates projection cancellation rather than starting another native read', async () => {
    const f = fixture(); f.live.clear(); const cancelled = Object.assign(new Error('Session projection read was cancelled'), { code: 'gateway/cancelled' });
    f.projection.mockRejectedValue(cancelled); await expect(f.sessions.directory('a')).rejects.toBe(cancelled); expect(f.inspect).not.toHaveBeenCalled();
  });
  it('ignores stale migration hints and reads the exact canonical inspection, propagating unreadable peers', async () => {
    const f = fixture(); f.live.clear();
    f.projection.mockResolvedValue({ kind: 'migration-required', values: { workingDirectory: '/stale' } });
    const snapshot = f.inspections.get('a')!;
    f.inspections.set('a', { ...snapshot, events: [envelope('working-directory/change', { cwd: join(root, 'current') })] });
    expect(await f.sessions.directory('a')).toBe(join(root, 'current'));
    f.list.mockResolvedValue({ items: [{ sessionId: SessionId('missing'), agentAvailable: false, running: false, updatedAt: 1, blank: false }] });
    await expect(f.sessions.directories()).rejects.toThrow('session missing');
    expect(f.resolveAgent).not.toHaveBeenCalled();
  });
});

describe('all-session policy preflight', () => {
  it('denies writes in read-only mode and never substitutes the project as a writable root', async () => {
    const f = fixture(); f.policies.set('a', { mode: 'read-only', workspaceRoot: root });
    await expect(f.executor.assertPolicy(project, [root], ['a'], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    await expect(f.executor.assertPolicy(project, [root], ['a'], false)).resolves.toBeUndefined();
    expect(f.confine).not.toHaveBeenCalled();
  });
  it('checks every session and the Git metadata outside a monorepo subproject', async () => {
    const f = fixture(); const sub = join(root, 'subproject'); await mkdir(sub);
    f.policies.set('a', { mode: 'workspace-write', workspaceRoot: sub });
    await expect(f.executor.assertPolicy(project, [sub, join(root, '.git')], ['a'], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    expect(f.resolvePolicy.mock.calls[0]?.[0]).toEqual({ session: f.session });
    expect(f.resolveAgent).not.toHaveBeenCalled();
  });
  it('resolves nonexistent targets through real ancestors, rejecting symlink escapes and prefix siblings', async () => {
    const f = fixture(); const allowed = join(root, 'allowed'); const outside = join(root, 'outside');
    await mkdir(allowed); await mkdir(outside); await symlink(outside, join(allowed, 'escape'));
    f.policies.set('a', { mode: 'workspace-write', workspaceRoot: allowed });
    await expect(f.executor.assertPolicy(project, [join(allowed, 'safe', 'new')], ['a'], true)).resolves.toBeUndefined();
    await expect(f.executor.assertPolicy(project, [join(allowed, 'escape', 'new')], ['a'], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    await expect(f.executor.assertPolicy(project, [allowed + '-sibling'], ['a'], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    await symlink(join(outside, 'missing'), join(allowed, 'dangling'));
    await expect(f.executor.assertPolicy(project, [join(allowed, 'dangling', 'new')], ['a'], true)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('requires every participating session to allow every effect path', async () => {
    const f = fixture();
    const b = Session.create(SessionId('b'), [], { ...f.session.header, id: SessionId('b') });
    f.live.set('b', b); f.policies.set('b', { mode: 'read-only', workspaceRoot: root });
    await expect(f.executor.assertPolicy(project, [join(root, 'tree')], ['a', 'b'], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    expect(f.resolvePolicy).toHaveBeenCalledTimes(2);
    expect(f.resolvePolicy.mock.calls.map(([request]) => request?.session?.id)).toEqual(['a', 'b']);
  });
  it('resolves a cold session policy without resuming an Agent or inventing a grant', async () => {
    const f = fixture(); f.live.clear();
    await f.executor.assertPolicy(project, [root], ['a'], true);
    const cold = f.resolvePolicy.mock.calls[0]?.[0]?.session;
    expect(cold).toBeInstanceOf(Session); expect(cold?.header.cwd).toBe(root); expect(cold).not.toBe(f.session);
    expect(f.resolveAgent).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it('uses the real deployment default for agentless checks and fails closed without a policy service', async () => {
    const f = fixture();
    await expect(f.executor.assertPolicy(project, [root], [], true)).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    expect(f.resolvePolicy).toHaveBeenCalledWith();
    delete f.services.sandboxPolicy;
    await expect(f.executor.run(project, ['status'], [])).rejects.toMatchObject({ code: 'SANDBOX_POLICY_UNAVAILABLE' });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('confined exact-argv Git execution', () => {
  it('spawns only the native wrapped argv, never a shell command', async () => {
    const f = fixture(); f.wrapped.argv = ['native-runner', '--profile', 'actual-policy', '--', 'git', 'branch', 'literal;$(payload)'];
    await f.executor.run(project, ['branch', 'literal;$(payload)'], ['a']);
    expect(f.confine).toHaveBeenCalledWith(['git', 'branch', 'literal;$(payload)'], { mode: 'workspace-write', workspaceRoot: root, sessionId: 'a' }, expect.any(AbortSignal));
    expect(spawnMock).toHaveBeenCalledWith('native-runner', ['--profile', 'actual-policy', '--', 'git', 'branch', 'literal;$(payload)'], expect.objectContaining({ cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }));
  });
  it('only bypasses confinement when every participant already chose full access', async () => {
    const f = fixture(); f.policies.set('a', { mode: 'danger-full-access', workspaceRoot: root });
    await f.executor.run(project, ['status', '--porcelain'], ['a']);
    expect(f.confine).not.toHaveBeenCalled(); expect(spawnMock.mock.calls[0]?.slice(0, 2)).toEqual(['git', ['status', '--porcelain']]);
    f.policies.set('a', { mode: 'read-only', workspaceRoot: root });
    await f.executor.run(project, ['status'], ['a']);
    expect(f.confine.mock.calls[0]?.[1].mode).toBe('read-only');
  });
  it('uses the narrowest existing root and rejects incomparable grants instead of fabricating an intersection', async () => {
    const f = fixture(); const nested = join(root, 'nested'); await mkdir(nested);
    const b = Session.create(SessionId('b'), [], { ...f.session.header, id: SessionId('b'), cwd: nested });
    f.live.set('b', b); f.policies.set('b', { mode: 'workspace-write', workspaceRoot: nested, sessionId: SessionId('b') });
    await f.executor.run(project, ['status'], ['a', 'b']);
    expect(f.confine.mock.calls[0]?.[1].workspaceRoot).toBe(nested);
    const sibling = join(root, 'sibling'); await mkdir(sibling);
    f.policies.set('a', { mode: 'workspace-write', workspaceRoot: sibling });
    await expect(f.executor.run(project, ['status'], ['a', 'b'])).rejects.toMatchObject({ code: 'SANDBOX_POLICY_CONFLICT' });
    expect(spawnMock).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'partial', 'throw'])('fails closed on a %s confinement backend', async (kind) => {
    const f = fixture();
    if (kind === 'missing') delete f.services.sandbox;
    if (kind === 'partial') f.wrapped.enforcement = 'partial';
    if (kind === 'throw') f.confine.mockRejectedValue(new Error('provider unavailable'));
    await expect(f.executor.run(project, ['status'], ['a'])).rejects.toThrow();
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it('classifies runner failure before denial and never retries unrestricted', async () => {
    const f = fixture(); output({ code: 1, stderr: 'runner setup failed: operation not permitted' });
    await expect(f.executor.run(project, ['status'], ['a'])).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(spawnMock).toHaveBeenCalledOnce(); expect(f.confine).toHaveBeenCalledOnce();
  });
  it('recognizes only the selected backend denial dialect; an ordinary Git exit remains an exit', async () => {
    const f = fixture(); output({ code: 128, stderr: 'fatal: operation not permitted' });
    await expect(f.executor.run(project, ['status'], ['a'])).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    output({ code: 128, stderr: 'fatal: not a git repository' });
    await expect(f.executor.run(project, ['status'], ['a'])).resolves.toEqual({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' });
    output({ code: 0, stdout: 'ok', stderr: 'operation not permitted' });
    await expect(f.executor.run(project, ['status'], ['a'])).resolves.toMatchObject({ exitCode: 0, stdout: 'ok' });
  });
  it('stops on cancellation and rejects before spawning for an already-cancelled request', async () => {
    const f = fixture(); const abort = new AbortController(); const child = new Child();
    let started!: () => void; const ready = new Promise<void>((resolveReady) => { started = resolveReady; });
    spawnMock.mockImplementation(() => { started(); return child; });
    const run = f.executor.run(project, ['worktree', 'add', 'tree'], ['a'], abort.signal);
    await ready; abort.abort();
    await expect(run).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(f.executor.run(project, ['status'], ['a'], abort.signal)).rejects.toThrow();
    expect(spawnMock).toHaveBeenCalledOnce();
  });
  it('bounds execution time and distinguishes its deadline from caller cancellation', async () => {
    const f = fixture(); const deadline = new AbortController(); const original = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => milliseconds === 60_000 ? deadline.signal : original(milliseconds));
    const child = new Child(); let started!: () => void;
    const ready = new Promise<void>((resolveReady) => { started = resolveReady; });
    spawnMock.mockImplementation(() => { started(); return child; });
    const run = f.executor.run(project, ['status'], ['a']);
    await ready; deadline.abort();
    await expect(run).rejects.toMatchObject({ code: 'GIT_TIMEOUT' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('kills and rejects overflowing output instead of returning a truncated successful result', async () => {
    const f = fixture(); const child = new Child();
    spawnMock.mockImplementation(() => { queueMicrotask(() => child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1))); return child; });
    await expect(f.executor.run(project, ['status'], ['a'])).rejects.toMatchObject({ code: 'GIT_OUTPUT_LIMIT' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('reports executable-specific sandbox spawn failure without claiming an ordinary Git failure', async () => {
    const f = fixture();
    spawnMock.mockImplementation(() => { const child = new Child(); queueMicrotask(() => { child.emit('error', Object.assign(new Error('runner missing'), { code: 'ENOENT', path: 'native-runner', syscall: 'spawn native-runner' })); child.emit('close', -2, null); }); return child; });
    await expect(f.executor.run(project, ['status'], ['a'])).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(spawnMock).toHaveBeenCalledOnce();
  });
});
