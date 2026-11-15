import { describe, expect, it } from 'vitest';
import { HubStateSchema, StoredHubStateSchema } from '../../src/domain/hub-schema.js';
import { normalizeLegacyHubRecord } from '../../src/domain/legacy-hub-record.js';
import type { HubState } from '../../src/shared/types.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { sampleHub } from './hub-helpers.js';

const now = '2026-01-01T00:00:00.000Z';
const YAML = [
  'name: Legacy',
  'initial_column: wait',
  'columns:',
  '  - id: wait',
  '    label: Wait',
  '    deterministic: {language: bash, code: "echo ready", exits: {ok: done}}',
  '  - {id: done, label: Done}',
  '',
].join(String.fromCharCode(10));

/** A Hub record exactly as a build before the scripted rename persisted it. */
function legacyHub(): Record<string, unknown> {
  const definition = { language: 'bash', code: 'echo ready', directory: 'task', exits: { ok: 'done' } };
  const hub = sampleHub() as unknown as Record<string, unknown>;
  hub.boards = [{
    id: 'board', name: 'Board', workflowYaml: YAML,
    workflow: {
      name: 'Legacy', initialColumnId: 'wait',
      columns: [{ id: 'wait', name: 'Wait', deterministic: definition }, { id: 'done', name: 'Done' }],
      groups: [],
    },
    createdAt: now, updatedAt: now,
  }];
  const control = {
    entryId: 'entry', executionId: 'execution', stageIdentity: 'wait', definition,
    phase: 'capture-pending', startedAt: now, attempt: 0, restartCount: 0,
  };
  hub.tasks = [{
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId: 'wait', position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo/app', worktree: null, operation: null,
    stageEntry: { id: 'entry', columnId: 'wait', stageIdentity: 'wait', enteredAt: now },
    deterministic: control,
    deterministicHandoff: { id: 'handoff', entryId: 'entry', executionId: 'execution', fromColumnId: 'done', columnId: 'wait', exit: 'ok', message: 'ready', at: now },
    history: [
      { kind: 'deterministic-execution', at: now, executionId: 'execution', columnId: 'wait', outcome: 'completed' },
      { kind: 'deterministic-handoff', at: now, deliveryId: 'delivery', executionId: 'execution', fromColumnId: 'done', columnId: 'wait', outcome: 'accepted', exit: 'ok', message: 'ready' },
    ],
    createdAt: now, updatedAt: now,
  }];
  return hub;
}

describe('stored Hub record compatibility', () => {
  it('converts the previous field names the storage domain validates before the repository reads them', () => {
    const parsed = StoredHubStateSchema.parse(legacyHub());
    expect(parsed.boards[0]!.workflow.columns[0]).toMatchObject({ scripted: { language: 'bash', exits: { ok: 'done' } } });
    expect(parsed.tasks[0]).toMatchObject({ scripted: { entryId: 'entry' }, scriptedHandoff: { id: 'handoff' } });
    expect(parsed.tasks[0]!.history!.map(entry => entry.kind)).toEqual(['scripted-execution', 'scripted-handoff']);
    // The authored YAML keeps its previous spelling; the parser accepts it, the stored objects do not.
    expect(JSON.stringify(parsed.boards[0]!.workflow)).not.toContain('deterministic');
    expect(JSON.stringify(parsed.tasks)).not.toContain('deterministic');
    expect(HubStateSchema.safeParse(parsed).success).toBe(true);
  });

  it('refuses the previous field names in an opened Hub, so only the stored shape converts them', () => {
    expect(HubStateSchema.safeParse(legacyHub()).success).toBe(false);
    expect(HubStateSchema.safeParse(normalizeLegacyHubRecord(legacyHub())).success).toBe(true);
  });

  it('leaves a current record as the same value, so a converted Hub is never converted twice', () => {
    const current = HubStateSchema.parse(normalizeLegacyHubRecord(legacyHub())) as unknown as Record<string, unknown>;
    expect(normalizeLegacyHubRecord(current)).toBe(current);
    expect(normalizeLegacyHubRecord(null)).toBeNull();
  });

  it('keeps a current field a record already carries and drops the previous spelling', () => {
    const legacy = legacyHub();
    const task = (legacy.tasks as Array<Record<string, unknown>>)[0]!;
    const definition = { language: 'bash', code: 'echo current', exits: { ok: 'done' } };
    task.scripted = { ...(task.deterministic as Record<string, unknown>), definition };
    const parsed = StoredHubStateSchema.parse(legacy) as HubState;
    expect(parsed.tasks[0]!.scripted).toMatchObject({ definition: { code: 'echo current' } });
    expect(JSON.stringify(parsed.tasks[0])).not.toContain('deterministic');
  });

  it('accepts a workflow YAML that still uses the previous spelling, as the authored parser does', () => {
    expect(parseWorkflow(YAML).columns[0]!.scripted).toMatchObject({ language: 'bash' });
    expect(StoredHubStateSchema.safeParse(legacyHub()).success).toBe(true);
  });
});
