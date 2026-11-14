import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HubStorage } from '../../src/shared/ports.js';
import type { HubState, KanbanMeta } from '../../src/shared/types.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';
import { HubRepository } from '../../src/host/hub-repository.js';
import { DeterministicCaptureStore, createDeterministicTrust } from '../../src/host/deterministic/capture.js';
import type { DeterministicRuntime, ExecuteRequest, ExecutionOutcome } from '../../src/host/deterministic/ports.js';
import { createNativeSupervisorPorts } from '../../src/host/deterministic-control.js';
import { DeterministicSupervisor, type SupervisorPorts } from '../../src/host/deterministic-supervisor.js';
import { createDeterministicRouter } from '../../src/host/deterministic-routing.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { sampleHub, operationDeps } from '../domain/hub-helpers.js';

/** Test-owned file storage exercises the production Hub transaction and strict persisted codecs. */
class FileHubStorage implements HubStorage {
  constructor(private readonly path: string) {}
  async loadAll(): Promise<{ hubs: HubState[]; meta: KanbanMeta }> { return JSON.parse(await readFile(this.path, 'utf8')) as { hubs: HubState[]; meta: KanbanMeta }; }
  private async save(data: { hubs: HubState[]; meta: KanbanMeta }) { await writeFile(this.path + '.tmp', JSON.stringify(data)); await rename(this.path + '.tmp', this.path); }
  async saveHub(hub: HubState) { const data = await this.loadAll(); data.hubs = [...data.hubs.filter(value => value.id !== hub.id), hub]; await this.save(data); }
  async saveMeta(meta: KanbanMeta) { const data = await this.loadAll(); data.meta = meta; await this.save(data); }
  async deleteHub(id: string) { const data = await this.loadAll(); data.hubs = data.hubs.filter(value => value.id !== id); await this.save(data); }
  async close() {}
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-supervisor-persistence-'))); const project = join(root, 'project'); await mkdir(project); const primary = join(project, 'wait.ts');
  await writeFile(primary, 'return { exit: "passed", message: "approved original bytes" };');
  const hub = sampleHub(); hub.projects[0]!.projectPath = project; delete hub.projects[0]!.gitRootPath;
  const board = hub.boards[0]!; board.workflowYaml = 'name: Flow\ninitial_column: wait\ncolumns:\n  - id: wait\n    label: Wait\n    deterministic: {language: typescript, file: wait.ts, exits: {passed: review}}\n  - id: review\n    label: Review\n'; board.workflow = parseWorkflow(board.workflowYaml);
  const path = join(root, 'hubs.json'); await writeFile(path, JSON.stringify({ hubs: [hub], meta: { settingsRevision: 0 } }));
  const captures = new DeterministicCaptureStore(join(root, 'private'), { directory: async path => realpath(path), source: async path => ({ path: primary, code: await readFile(join(project, path), 'utf8') }), execution: async () => ({ mode: 'danger-full-access', workspaceRoot: project }) });
  const trust = createDeterministicTrust(join(root, 'private')); let executions = 0; const codes: string[] = [];
  const requests: Array<{ input: ExecuteRequest['input']; executionId?: string }> = [];
  let executeHook: ((request: ExecuteRequest) => Promise<ExecutionOutcome>) | undefined;
  const native: DeterministicRuntime = { capture: request => captures.capture(request), plan: request => captures.plan(request), loadCapture: capture => captures.load(capture), normalizeCapture: (capture, definition) => captures.normalize(capture, definition), releaseCapture: capture => captures.releaseSource(capture.sourceRef), collectSources: references => captures.collectSources(references), releaseSource: reference => captures.releaseSource(reference), trust, variables: { status: async () => [], set: async () => undefined, remove: async () => undefined, resolve: async () => ({}) }, verify: async () => undefined, reclaim: async () => undefined,
    async execute(request) { executions++; codes.push(await captures.load(request.capture)); requests.push({ input: structuredClone(request.input), executionId: request.executionId }); return executeHook ? executeHook(request) : { kind: 'completed', completion: { exit: 'passed', message: 'approved original bytes' }, diagnostics: [] }; } };
  let hubs = await HubRepository.open(new FileHubStorage(path), operationDeps());
  const task = await hubs.hub('hub').createTask({ projectId: 'project', boardId: 'board', title: 'File-backed execution', description: '' });
  const supervisors: DeterministicSupervisor[] = [];
  function supervisor(route?: SupervisorPorts['route']) {
    const ports = createNativeSupervisorPorts({ nativeRuntime: native, locate: taskId => hubs.findTask(taskId), all: () => hubs.allTasks(),
      transact: (taskId, change) => hubs.transact('hub', draft => { const task = draft.tasks.find(value => value.id === taskId)!; return change(task, { hubId: draft.id, hub: draft, task, board: draft.boards.find(value => value.id === task.boardId)!, project: draft.projects.find(value => value.id === task.projectId)! }); }),
      route: route ?? (async () => ({ status: 'held' })),
    }); const value = new DeterministicSupervisor(ports); supervisors.push(value); return value;
  }
  return { root, project, primary, path, native, taskId: task.id, supervisor, task: () => hubs.requireTask(task.id).task, get hubs() { return hubs; }, executions: () => executions, codes, requests,
    executeWith(hook: typeof executeHook) { executeHook = hook; },
    async reopen() { await hubs.close(); hubs = await HubRepository.open(new FileHubStorage(path), operationDeps()); },
    async close() { for (const value of supervisors) value.dispose(); for (const value of supervisors) await value.settle(); await hubs.close(); if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('dsh-supervisor-persistence-') || await realpath(root) !== root) throw new Error('Unsafe test cleanup target'); await rm(root, { recursive: true, force: true }); },
  };
}

/** Approve the current capture exactly as the stage approval service does. */
async function approveCaptured(f: Awaited<ReturnType<typeof fixture>>, supervisor: DeterministicSupervisor) {
  const task = f.task();
  const stageIdentity = task.stageEntry!.stageIdentity;
  await f.native.trust.approve({ hubId: 'hub', boardId: 'board', stageIdentity }, task.deterministic!.capture!.fingerprint);
  supervisor.sync();
}

describe('deterministic supervisor real durable aggregate and private source blobs', () => {
  it('recovers placement-before-capture and approved immutable bytes after complete repository reopen', async () => {
    const f = await fixture(); try {
      const initial = f.task().deterministic!; expect(initial.phase).toBe('capture-pending'); expect(initial.targets?.passed?.stageIdentity).toBeTruthy(); await f.reopen();
      const s = f.supervisor(); s.start(); await s.settle(); expect(f.task().deterministic!.phase).toBe('awaiting-trust'); const sourceRef = f.task().deterministic!.capture!.sourceRef;
      await approveCaptured(f, s); await s.settle();
      await writeFile(f.primary, 'return {exit: "passed",message: "different unapproved bytes"};'); s.dispose(); await f.reopen();
      expect(f.executions()).toBe(1); expect(f.codes).toEqual(['return { exit: "passed", message: "approved original bytes" };']); expect(f.task().deterministic!.capture!.sourceRef).toBe(sourceRef); expect(f.task().deterministic!.startedAt).toBe(initial.startedAt);
      const disk = JSON.parse(await readFile(f.path, 'utf8')) as { hubs: HubState[] }; expect(disk.hubs[0]!.tasks[0]!.deterministic?.result?.deliveryId).toBeTruthy(); expect(await readFile(f.path, 'utf8')).not.toContain('different unapproved bytes');
    } finally { await f.close(); }
  });
  it('reopens an active attempt from captured bytes and starts a new local polling sequence', async () => {
    const f = await fixture();
    try {
      let started!: () => void; const firstStarted = new Promise<void>(resolve => { started = resolve; });
      const firstPolls: number[] = []; const secondPolls: number[] = [];
      f.executeWith(async request => {
        let localPoll = 0; firstPolls.push(++localPoll); started();
        return await new Promise<ExecutionOutcome>(resolve => {
          if (request.signal.aborted) resolve({ kind: 'aborted' });
          else request.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true });
        });
      });
      const initial = f.supervisor(); initial.start(); await initial.settle();
      await approveCaptured(f, initial); await firstStarted;
      const before = structuredClone(f.task().deterministic!); expect(before.phase).toBe('active');
      initial.dispose(); await initial.settle(); expect(f.task().deterministic?.phase).toBe('active');
      await writeFile(f.primary, 'return {exit: "passed", message: "changed after interruption"};'); await f.reopen();
      f.executeWith(async () => { let localPoll = 0; secondPolls.push(++localPoll); return { kind: 'completed', completion: { exit: 'passed', message: 'new local sequence' }, diagnostics: [] }; });
      const restored = f.supervisor(); restored.start(); await restored.settle();
      const after = f.task().deterministic!; expect(after.phase).toBe('result-ready');
      expect(after.executionId).toBe(before.executionId); expect(after.entryId).toBe(before.entryId); expect(after.startedAt).toBe(before.startedAt);
      expect(after.attempt).toBe(before.attempt + 1); expect(after.attemptId).not.toBe(before.attemptId); expect(after.restartCount).toBe(before.restartCount + 1);
      expect(firstPolls).toEqual([1]); expect(secondPolls).toEqual([1]); expect(f.executions()).toBe(2);
      expect(f.codes).toEqual(['return { exit: "passed", message: "approved original bytes" };', 'return { exit: "passed", message: "approved original bytes" };']);
      expect(f.requests[1]!.input).toMatchObject({ executionId: before.executionId, entryId: before.entryId, startedAt: before.startedAt, attempt: after.attempt, attemptId: after.attemptId, restartCount: after.restartCount });
      expect(await readFile(f.path, 'utf8')).not.toContain('changed after interruption');
    } finally { await f.close(); }
  });
  it('resumes only durable result placement after restart and atomically binds the same delivery receipt', async () => {
    const f = await fixture(); try {
      const s = f.supervisor(); s.start(); await s.settle(); await approveCaptured(f, s); await s.settle(); const result = f.task().deterministic!.result!;
      expect(f.task().deterministic!.phase).toBe('result-ready'); s.dispose(); await f.reopen();
      const router = createDeterministicRouter({ hubs: f.hubs, sessions: { isIdle: async () => true }, pending: async () => NO_PENDING_USER_WORK }); const restored = f.supervisor(router); restored.start(); await restored.settle();
      expect(f.executions()).toBe(1); expect(f.task().columnId).toBe('review'); expect(f.task().deterministic).toBeUndefined(); expect(f.task().deterministicHandoff?.id).toBe(result.deliveryId); const entryId = f.task().stageEntry!.id;
      restored.dispose(); await f.reopen(); expect(f.task().stageEntry!.id).toBe(entryId); expect(f.task().deterministicHandoff?.id).toBe(result.deliveryId); expect(f.executions()).toBe(1);
    } finally { await f.close(); }
  });
  it('reuses the saved sent values when resuming a durable result after restart', async () => {
    const f = await fixture(); try {
      f.executeWith(async () => ({ kind: 'completed', completion: { exit: 'passed', message: 'ok', params: { pipeline: 'ci-main' } }, diagnostics: [] }));
      const s = f.supervisor(); s.start(); await s.settle(); await approveCaptured(f, s); await s.settle();
      expect(f.task().deterministic!.result?.params).toEqual({ pipeline: 'ci-main' });
      s.dispose(); await f.reopen();
      const seen: Array<Record<string, string> | undefined> = [];
      const router = createDeterministicRouter({ hubs: f.hubs, sessions: { isIdle: async () => true }, pending: async () => NO_PENDING_USER_WORK });
      const restored = f.supervisor(async request => { seen.push(request.result.params); return router(request); });
      restored.start(); await restored.settle();
      expect(seen[0]).toEqual({ pipeline: 'ci-main' });
      expect(f.task().deterministicHandoff?.params).toEqual({ pipeline: 'ci-main' });
      expect(f.executions()).toBe(1);
    } finally { await f.close(); }
  });

  it('collects only globally unreferenced private blobs after committed task deletion', async () => {
    const f = await fixture(); try {
      const s = f.supervisor(); s.start(); await s.settle(); const capture = f.task().deterministic!.capture!;
      const second = await f.hubs.hub('hub').createTask({ projectId: 'project', boardId: 'board', title: 'Shared captured source', description: '' });
      await f.hubs.transact('hub', hub => { const task = hub.tasks.find(value => value.id === second.id)!; task.deterministic!.capture = capture; task.deterministic!.phase = 'stopped'; hub.tasks = hub.tasks.filter(value => value.id !== f.taskId); });
      await s.collectSources(); expect(await f.native.loadCapture(capture)).toContain('approved original bytes');
      await f.hubs.transact('hub', hub => { hub.tasks = hub.tasks.filter(value => value.id !== second.id); }); await s.collectSources(); await expect(f.native.loadCapture(capture)).rejects.toMatchObject({ code: 'CAPTURE_MISSING' });
    } finally { await f.close(); }
  });
  it('fails closed when a durably referenced blob is corrupted without replacing it from a changed primary', async () => {
    const f = await fixture(); try {
      const s = f.supervisor(); s.start(); await s.settle(); const capture = f.task().deterministic!.capture!;
      await approveCaptured(f, s);
      await writeFile(join(f.root, 'private', 'sources', capture.sourceRef + '.json'), 'corrupt'); await writeFile(f.primary, 'return "not approved"'); s.dispose(); await f.reopen();
      const restored = f.supervisor(); restored.start(); await restored.settle(); expect(f.executions()).toBe(0); expect(f.task().deterministic!.phase).toBe('failed'); expect(f.task().deterministic!.error?.code).toBe('CAPTURE_CORRUPT');
    } finally { await f.close(); }
  });
});
