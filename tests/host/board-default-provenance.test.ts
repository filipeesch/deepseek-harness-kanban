import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveBoardPreset, WORKFLOW_OPERATOR_PRESET } from '../../src/domain/board-preset.js';
import { HubStateSchema } from '../../src/domain/hub-schema.js';
import { writeBoardAgentPresetField } from '../../src/domain/board-agent-preset-field.js';
import { productToolDefinitions } from '../../src/host/tools.js';
import { BoardRevisions } from '../../src/host/revisions.js';
import type { BoardRevisionLog } from '../../src/domain/revisions/log.js';
import { fixture } from './helpers.js';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

const yaml = `# Preserve this comment
name: Example
initial_column: todo
columns:
  - id: todo
    label: Todo
`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const active: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => { for (const f of active.splice(0)) await f.close(); });
async function setup(options: Parameters<typeof fixture>[0] = {}) { const f = await fixture(options); active.push(f); return f; }

describe('board default preset provenance', () => {
  it('preserves legacy absence and gives authored YAML precedence over metadata', async () => {
    const f = await setup();
    const legacy = structuredClone(f.app.hubs.requireHub(f.hub.id));
    delete legacy.boards[0]!.defaultPresetMode;
    expect(effectiveBoardPreset(HubStateSchema.parse(legacy).boards[0]!)).toEqual({ origin: 'legacy-host' });
    legacy.boards[0]!.defaultPresetMode = 'host';
    expect(effectiveBoardPreset(HubStateSchema.parse(legacy).boards[0]!)).toEqual({ origin: 'explicit-host' });
    const created = await f.app.boards.create({ name: 'Authored', workflowYaml: `agent_preset: custom
` + yaml });
    expect(effectiveBoardPreset(created.board)).toEqual({ origin: 'authored', preset: 'custom' });
  });

  it('reviews custom and generated creation without altering exact text or digest', async () => {
    const f = await setup();
    expect(effectiveBoardPreset(f.board)).toEqual({ origin: 'implicit-operator', preset: WORKFLOW_OPERATOR_PRESET });
    const count = f.store.snapshot().boards.length;
    const preview = await f.app.boards.createReviewed({ name: 'Preview', workflowYaml: yaml, expectSha256: sha(yaml), dryRun: true });
    expect(preview).toMatchObject({ saved: false, sha256: sha(yaml) });
    expect(f.store.snapshot().boards).toHaveLength(count);
    await expect(f.app.boards.createReviewed({ name: 'Refused', workflowYaml: yaml, expectSha256: 'bad' })).rejects.toMatchObject({ code: 'EXPECTED_SHA256_MISMATCH' });
    expect(f.store.snapshot().boards).toHaveLength(count);
    const result = await f.app.boards.createReviewed({ name: 'Custom', workflowYaml: yaml, expectSha256: sha(yaml) });
    if (!result.saved) throw new Error('not saved');
    expect(result.board.workflowYaml).toBe(yaml);
    expect(result.sha256).toBe(sha(yaml));
    expect(effectiveBoardPreset(result.board)).toEqual({ origin: 'implicit-operator', preset: WORKFLOW_OPERATOR_PRESET });
    const tool = productToolDefinitions(f.app).find(t => t.name === 'get_board_yaml')!;
    const ctx = { signal: new AbortController().signal, agent: { id: 'ordinary' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    const read = await tool.execute({ board_id: result.board.id }, ctx) as Record<string, unknown>;
    expect(read).toMatchObject({ effectiveDefaultPreset: { origin: 'implicit-operator', preset: WORKFLOW_OPERATOR_PRESET } });
  });

  it('atomically saves explicit selections, refuses stale or inconsistent writes, and isolates other boards', async () => {
    const f = await setup();
    const other = structuredClone(f.board);
    const first = await f.app.boards.create({ name: 'Target', workflowYaml: yaml });
    const id = first.board.id;
    const namedYaml = writeBoardAgentPresetField(yaml, 'custom');
    const named = await f.app.boards.saveWorkflow({ boardId: id, yaml: namedYaml, presetChoice: 'named', expectedRevision: first.hubRevision });
    expect(named.board.defaultPresetMode).toBeUndefined();
    expect(effectiveBoardPreset(named.board)).toEqual({ origin: 'authored', preset: 'custom' });
    expect(named.board.workflowYaml).toContain('# Preserve this comment');
    await expect(f.app.boards.saveWorkflow({ boardId: id, yaml, presetChoice: 'host', expectedRevision: first.hubRevision })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(f.app.boards.saveWorkflow({ boardId: id, yaml: namedYaml, presetChoice: 'host', expectedRevision: named.hubRevision })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.app.boards.read(id).board).toEqual(named.board);
    const host = await f.app.boards.saveWorkflow({ boardId: id, yaml: writeBoardAgentPresetField(namedYaml, undefined), presetChoice: 'host', expectedRevision: named.hubRevision });
    expect(effectiveBoardPreset(host.board)).toEqual({ origin: 'explicit-host' });
    expect(host.board.workflowYaml).toContain('# Preserve this comment');
    expect(f.app.boards.read(other.id).board).toEqual(other);
    expect(HubStateSchema.parse(f.app.hubs.requireHub(f.hub.id)).boards.find(b => b.id === id)?.defaultPresetMode).toBe('host');
  });

  it('rejects stale preset changes even when the YAML is byte-identical', async () => {
    const f = await setup();
    const created = await f.app.boards.create({ name: 'Stale', workflowYaml: yaml });
    const id = created.board.id;
    await f.store.transact(draft => { draft.boards.find(board => board.id === id)!.defaultPresetMode = 'host'; });
    const stale = { boardId: id, expectedRevision: created.hubRevision, compose: (text: string) => text };
    await expect(f.app.boards.saveWorkflowReviewed({ ...stale, restorePresetMode: { value: 'operator' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(f.app.boards.saveWorkflowReviewed({ ...stale, presetChoice: 'host' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(f.app.boards.saveWorkflowReviewed({ ...stale, restorePresetMode: { value: 'operator' }, dryRun: true })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.app.boards.read(id).board).toMatchObject({ workflowYaml: yaml, defaultPresetMode: 'host' });
    // YAML-only composed edits still follow the existing rebase behavior.
    const ordinary = await f.app.boards.saveWorkflowReviewed({ ...stale, compose: text => text.replace('label: Todo', 'label: Ready') });
    expect(ordinary.saved).toBe(true);
    expect(f.app.boards.read(id).board).toMatchObject({ workflowYaml: yaml.replace('label: Todo', 'label: Ready'), defaultPresetMode: 'host' });
  });

  it('does not rebase a preset change when metadata races after review', async () => {
    const f = await setup();
    const created = await f.app.boards.create({ name: 'Race', workflowYaml: yaml });
    const id = created.board.id;
    const writer = f.app.boards as any;
    const save = writer.saveBoardWorkflowNow.bind(writer);
    let attempts = 0;
    const intercept = vi.spyOn(writer, 'saveBoardWorkflowNow').mockImplementation(async (...args: any[]) => {
      attempts++;
      await f.store.transact(draft => { draft.boards.find(board => board.id === id)!.defaultPresetMode = 'host'; });
      return save(...args);
    });
    try {
      await expect(f.app.boards.saveWorkflowReviewed({ boardId: id, expectedRevision: created.hubRevision, compose: text => text, restorePresetMode: { value: undefined } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(attempts).toBe(1);
      expect(f.app.boards.read(id).board).toMatchObject({ workflowYaml: yaml, defaultPresetMode: 'host' });
    } finally { intercept.mockRestore(); }
  });

  it('reviews and restores metadata-only operator and host changes in both directions', async () => {
    const f = await setup();
    const created = await f.app.boards.create({ name: 'Reviewed', workflowYaml: yaml });
    const id = created.board.id;
    for (const [from, to] of [['operator', 'host'], ['host', 'operator']] as const) {
      const current = f.app.boards.read(id);
      const args = { boardId: id, compose: (text: string) => text, replace: true, expectedRevision: current.hubRevision, restorePresetMode: { value: to }, detail: 'full' as const };
      const preview = await f.app.boards.saveWorkflowReviewed({ ...args, dryRun: true });
      expect(preview.saved).toBe(false);
      expect(preview.sha256).toBe(sha(yaml));
      expect(preview.report).toMatchObject({ sha256Scope: 'workflow-yaml-only', boardDefaultPreset: {
        before: { mode: from, origin: from === 'operator' ? 'implicit-operator' : 'explicit-host' },
        after: { mode: to, origin: to === 'operator' ? 'implicit-operator' : 'explicit-host' },
      } });
      expect(f.app.boards.read(id).board.defaultPresetMode).toBe(from);
      const committed = await f.app.boards.saveWorkflowReviewed(args);
      expect(committed.saved).toBe(true);
      expect(committed.report).toEqual(preview.report);
      expect(f.app.boards.read(id).board.defaultPresetMode).toBe(to);
    }
  });

  it('reports metadata changes through revert_board preview and commit', async () => {
    const logs = new Map<string, BoardRevisionLog>();
    const store = {
      load: async (id: string) => logs.get(id),
      save: async (log: BoardRevisionLog) => { logs.set(log.boardId, structuredClone(log)); },
      delete: async (id: string) => { logs.delete(id); },
      deleteHub: async () => {}, close: async () => {},
    };
    const revisions = new BoardRevisions({ store });
    const f = await setup({ revisions });
    const created = await f.app.boards.create({ name: 'Revert', workflowYaml: yaml });
    const id = created.board.id;
    await f.app.boards.saveWorkflow({ boardId: id, yaml, presetChoice: 'host', expectedRevision: created.hubRevision });
    const revert = productToolDefinitions(f.app, f.app.boards, undefined, { revisions }).find(tool => tool.name === 'revert_board')!;
    const ctx = { signal: new AbortController().signal, agent: { id: 'ordinary' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
    for (const [revision, from, to] of [[1, 'host', 'operator'], [2, 'operator', 'host']] as const) {
      const args = { board_id: id, to_revision: revision, confirmed: true, expected_revision: f.app.boards.read(id).hubRevision, detail: 'full' };
      const preview = await revert.execute({ ...args, dry_run: true }, ctx) as any;
      expect(preview).toMatchObject({ saved: false, sha256: sha(yaml), report: { sha256Scope: 'workflow-yaml-only', boardDefaultPreset: { before: { mode: from }, after: { mode: to } } } });
      expect(f.app.boards.read(id).board.defaultPresetMode).toBe(from);
      const summary = await revert.execute({ ...args, detail: 'summary', dry_run: true }, ctx) as any;
      expect(summary.report).toMatchObject({ sha256Scope: 'workflow-yaml-only', boardDefaultPreset: { changed: true } });
      expect(summary.report.boardDefaultPreset).not.toHaveProperty('before');
      const commit = await revert.execute(args, ctx) as any;
      expect(commit).toMatchObject({ saved: true, report: preview.report });
      expect(f.app.boards.read(id).board.defaultPresetMode).toBe(to);
    }
  });

  it('records metadata-only changes and restores historical legacy absence atomically', async () => {
    const record = vi.fn(async () => {});
    const f = await setup({ revisions: { record } });
    const created = await f.app.boards.create({ name: 'History', workflowYaml: yaml });
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ previous: null, next: yaml, previousPresetMode: undefined, nextPresetMode: 'operator' }));
    const host = await f.app.boards.saveWorkflow({ boardId: created.board.id, yaml, presetChoice: 'host', expectedRevision: created.hubRevision });
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ previous: yaml, next: yaml, previousPresetMode: 'operator', nextPresetMode: 'host' }));
    const restored = await f.app.boards.saveWorkflowReviewed({ boardId: created.board.id, compose: text => text, replace: true, expectedRevision: host.hubRevision, restorePresetMode: { value: undefined } });
    if (!restored.saved) throw new Error('not saved');
    expect(effectiveBoardPreset(restored.board)).toEqual({ origin: 'legacy-host' });
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ previous: yaml, next: yaml, previousPresetMode: 'host', nextPresetMode: undefined }));
  });

  it('applies the operator only to new conversations and reports missing presets', async () => {
    const apply = vi.fn(async () => ({ applied: false as const, reason: 'unavailable' as const }));
    const f = await setup({ presets: { apply } });
    const created = await f.app.createTask({ projectId: f.project.id, title: 'Task', description: '' });
    await f.app.command({ type: 'worktree.dismiss', taskId: created.id });
    const receipt = await f.app.command({ type: 'conversation.create', taskId: created.id });
    const task = f.app.hubs.requireTask(created.id).task;
    expect(receipt.commandReceipt?.preset).toEqual({ requested: WORKFLOW_OPERATOR_PRESET, applied: false, reason: 'unavailable' });
    expect(apply).toHaveBeenCalledWith(task.sessionIds[0], WORKFLOW_OPERATOR_PRESET);
    const result = await f.app.command({ type: 'conversation.create', taskId: task.id });
    expect(result.commandReceipt).toMatchObject({ kind: 'conversation', preset: { requested: WORKFLOW_OPERATOR_PRESET, applied: false, reason: 'unavailable' } });
    const original = [...f.store.snapshot().tasks.find(t => t.id === task.id)!.sessionIds];
    const board = f.app.boards.read(f.board.id);
    await f.app.boards.saveWorkflow({ boardId: f.board.id, yaml: board.board.workflowYaml, presetChoice: 'host', expectedRevision: board.hubRevision });
    expect(f.store.snapshot().tasks.find(t => t.id === task.id)?.sessionIds).toEqual(original);
    await f.app.createConversation(task.id);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
