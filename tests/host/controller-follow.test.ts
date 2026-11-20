import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { HubRepository } from '../../src/host/hub-repository.js';
import { KanbanController } from '../../src/host/controller.js';
import { KanbanApp } from '../../src/host/app.js';
import { SnapshotSchema } from '../../src/remote.js';
import type { HostSnapshot } from '../../src/shared/types.js';
import { MemoryHubStorage, TestGit, TestSessions } from './helpers.js';

const apps: KanbanApp[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage());
  const app = new KanbanApp(hubs, new TestSessions(), new TestGit(), {});
  apps.push(app);
  return { hubs, app, controller: new KanbanController(new Context(), app) };
}

describe('snapshot wire contract', () => {
  it('accepts an update without state but requires the state revision', () => {
    const base = { sequence: 1, conversations: {}, sharing: {} };
    expect(SnapshotSchema.safeParse({ ...base, stateRevision: 0 }).success).toBe(true);
    expect(SnapshotSchema.safeParse({ ...base }).success).toBe(false);
    expect(SnapshotSchema.safeParse({ ...base, stateRevision: 0, state: { hubs: [], settings: { revision: 0 } } }).success).toBe(true);
  });

  it('emits state on the baseline and a state-changing frame, and omits it on an attention-only frame', async () => {
    const f = await fixture();
    const abort = new AbortController();
    const frames: HostSnapshot[] = [];
    const iterator = f.controller.follow(abort.signal);
    try {
      frames.push(await next(iterator));
      expect(frames[0]!.state).toBeDefined();
      f.app.activityChanged();
      frames.push(await next(iterator));
      expect(frames[1]!.state).toBeUndefined();
      expect(frames[1]!.stateRevision).toBe(frames[0]!.stateRevision);
      await f.hubs.defaultHub().saveProject({ name: 'Project', projectPath: '/memory/project' });
      frames.push(await next(iterator));
      expect(frames[2]!.state).toBeDefined();
      expect(frames[2]!.stateRevision).toBeGreaterThan(frames[0]!.stateRevision);
    } finally {
      abort.abort();
      await iterator.return?.(undefined as never);
    }
  });
});

async function next(iterator: AsyncGenerator<HostSnapshot>): Promise<HostSnapshot> {
  const result = await iterator.next();
  if (result.done) throw new Error('The Kanban snapshot stream ended.');
  return result.value;
}

describe('workflow import wire contract', () => {
  it('returns an import result that survives the real command codec', async () => {
    const f = await fixture();
    const hubId = f.hubs.defaultHubId();
    const board = f.hubs.requireHub(hubId).boards[0]!;
    const workflow = ['name: Delivery', 'columns:', '  - id: todo', '    label: To do', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));
    // A document that creates one board, so the command writes and reports.
    const { encodeTransferDocument } = await import('../../src/host/workflow-transfer/archive.js');
    const archive = encodeTransferDocument({
      format: 'dsh-kanban-workflows', version: 1, origin: { hubName: 'Other Hub' },
      boards: [{ name: 'Imported board', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }],
    }).toString('base64');
    const outcome = await f.controller.command({ type: 'hub.workflows.import', hubId, archive, decisions: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The codec the transport actually applies must accept the response exactly as
    // it was produced, including the import outcome the surface reads.
    const parsed = SnapshotSchema.safeParse(outcome.value);
    expect(parsed.success).toBe(true);
    expect(outcome.value.workflowImport).toEqual({ hubId, outcomes: [{ name: 'Imported board', status: 'created', boardId: expect.any(String) }] });
    expect(f.hubs.requireHub(hubId).boards.some(value => value.name === 'Imported board')).toBe(true);
    expect(board).toBeDefined();
  });

  it('rejects a command the schema does not declare', async () => {
    const f = await fixture();
    const { CommandSchema } = await import('../../src/remote.js');
    expect(CommandSchema.safeParse({ type: 'hub.workflows.import', hubId: 'hub', archive: '', decisions: [] }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'hub.workflows.import', hubId: 'hub', archive: 'AAEC', decisions: [{ name: 'x', settlement: 'rename' }] }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: 'hub.workflows.import', hubId: 'hub', archive: 'AAEC', decisions: [] }).success).toBe(true);
    void f;
  });
});

