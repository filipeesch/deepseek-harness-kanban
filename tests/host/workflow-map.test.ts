import { describe, expect, it } from 'vitest';
import type { Board, Column, HubSharingView, Task } from '../../src/shared/types.js';
import { OMISSION_NAME_LIMIT, OMISSION_NAMES_BUDGET, renderWorkflowMap, WORKFLOW_MAP_BUDGET } from '../../src/host/workflow-map.js';
import { projectWorkflowSummary, workflowSummaryPage } from '../../src/host/workflow-summary.js';

const hub = { id: 'hub-1', name: 'Hub' };
const board = (columns: Column[], workflow: Partial<Board['workflow']> = {}, extra: Partial<Board> = {}): Board => ({
  id: 'board-1', name: 'Board', workflowYaml: 'SECRET YAML', createdAt: '', updatedAt: '',
  workflow: { name: 'Delivery', initialColumnId: columns[0]!.id, groups: [], columns, ...workflow },
  ...extra,
});
const task = (columnId: string, extra: Partial<Task> = {}): Task => ({ id: 'task-1', columnId, ...extra } as Task);
const bytes = (text: string) => Buffer.byteLength(text);

/** A linear workflow whose stages carry long responsibilities and conditions, like a real delivery board. */
function longFlow(count: number, descriptionLength = 300): Column[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 's' + index, name: 'Stage ' + index,
    description: ('Owns the work of stage ' + index + '. ').padEnd(descriptionLength, 'x'),
    onEnterPrompt: 'SECRET PROMPT ' + index,
    allowedTransitions: index === count - 1 ? [] : [{ to: 's' + (index + 1), when: 'Stage ' + index + ' is finished and every check is green.' }, ...(index > 0 ? [{ to: 's' + (index - 1), when: 'Stage ' + index + ' found rework.' }] : [])],
  }));
}

describe('workflow map', () => {
  it('carries a 22-stage workflow with 300-character descriptions whole within its budget', () => {
    const columns = longFlow(22);
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s5') });
    expect(bytes(text)).toBeLessThanOrEqual(WORKFLOW_MAP_BUDGET);
    for (const column of columns) {
      expect(text, column.id).toContain(column.id + ' | ' + column.name + ' | agent-instruction | ' + (column.allowedTransitions!.length === 0 ? 'empty' : 'configured'));
      expect(text, column.id).toContain(column.description!);
    }
    expect(text).toContain('-> s6 [when: Stage 5 is finished and every check is green.]');
    expect(text).toContain('-> s4 [when: Stage 5 found rework.]');
    expect(text).not.toContain('omitted for length');
  });

  it('marks the stage that holds the task', () => {
    const text = renderWorkflowMap({ board: board(longFlow(3)), hub, sharing: undefined, task: task('s1') });
    const lines = text.split('\n');
    expect(lines.filter(line => line.startsWith('* '))).toEqual(['* s1 | Stage 1 | agent-instruction | configured']);
    expect(lines.filter(line => /^ {2}s\d \|/.test(line))).toHaveLength(2);
  });

  it('states the workflow, board, Hub, scope, sharing, and the task and its automatic mode', () => {
    const sharing = { status: 'synced', boards: [{ boardId: 'board-1', bound: true, state: 'clean' }] } as unknown as HubSharingView;
    const text = renderWorkflowMap({
      board: board(longFlow(2), { description: 'Delivers a change.' }, { allowedProjectKeys: ['a', 'b'] }), hub, sharing,
      task: task('s0', { autoMode: { enabled: true, hold: { reason: 'waiting', at: '' } } }), held: true,
    });
    expect(text).toContain('Workflow: Delivery - Delivers a change.');
    expect(text).toContain('Board: Board (board-1) | Hub: Hub (hub-1) | Initial stage: s0');
    expect(text).toContain('Scope: restricted to 2 projects | Sharing: synced, board bound');
    expect(text).toContain('Task stage: Stage 0 (s0) | Auto mode: enabled, paused, held');
  });

  it('states unknown and absent state instead of inventing it', () => {
    const text = renderWorkflowMap({ board: board(longFlow(2)), hub, sharing: 'unavailable', task: task('gone') });
    expect(text).toContain('Scope: all projects | Sharing: unavailable');
    expect(text).toContain('Task stage: gone (unavailable) | Auto mode: disabled, not paused, hold unknown');
    expect(renderWorkflowMap({ board: board(longFlow(2)), hub, sharing: undefined })).toContain('Sharing: not-published, board not bound');
  });

  it('renders the workflow alone without a task and marks no stage', () => {
    const text = renderWorkflowMap({ board: board(longFlow(2)), hub, sharing: undefined });
    expect(text).not.toContain('Task stage:');
    expect(text.split('\n').some(line => line.startsWith('* '))).toBe(false);
  });

  it('shows the exits of a scripted stage, a decision stage, an unrestricted stage, and a stage with none', () => {
    const columns: Column[] = [
      { id: 'check', name: 'Check', description: 'Runs the check.', scripted: { language: 'bash', code: 'SECRET SCRIPT', directory: 'task', exits: { passed: 'done', failed: 'gate' } } },
      { id: 'gate', name: 'Gate', decision: { question: 'Go?', context: 'SECRET CONTEXT', options: [{ id: 'go', title: 'Go ahead', description: 'SECRET OPTION', to: 'done' }] } },
      { id: 'free', name: 'Free', onEnterPrompt: 'Do it.' },
      { id: 'done', name: 'Done', allowedTransitions: [] },
    ];
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('free') });
    expect(text).toContain('check | Check | scripted | scripted\n    Runs the check.\n    exits: exit passed -> done; exit failed -> gate');
    expect(text).toContain('gate | Gate | decision | decision\n    exits: option go (Go ahead) -> done');
    expect(text).toContain('* free | Free | agent-instruction | unrestricted\n    exits: any other stage');
    expect(text).toContain('done | Done | no-instruction | empty\n    exits: none');
  });

  it('never carries an entry instruction, script code, decision text, or the YAML', () => {
    const columns: Column[] = [
      { id: 'a', name: 'A', onEnterPrompt: 'SECRET PROMPT', allowedTransitions: [{ to: 'b' }] },
      { id: 'b', name: 'B', scripted: { language: 'bash', code: 'SECRET SCRIPT', directory: 'task', exits: { ok: 'a' } } },
      { id: 'c', name: 'C', decision: { question: 'SECRET QUESTION', context: 'SECRET CONTEXT', options: [{ id: 'go', title: 'Go', description: 'SECRET OPTION', to: 'a' }] } },
    ];
    expect(renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('a') })).not.toContain('SECRET');
  });

  it('keeps a multi-line responsibility whole and flattens whitespace in a condition', () => {
    const columns: Column[] = [
      { id: 'a', name: 'A', description: 'First line.\nSecond line.', allowedTransitions: [{ to: 'b', when: 'When the work\nis finished.' }] },
      { id: 'b', name: 'B' },
    ];
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined });
    expect(text).toContain('    First line.\n    Second line.');
    expect(text).toContain('-> b [when: When the work is finished.]');
  });

  describe('over the budget', () => {
    const columns = longFlow(22);
    const budget = 3000;
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s10') }, budget);
    const omitted = columns.filter(column => !text.includes(column.id + ' | ' + column.name + ' | '));

    it('stays within the budget and says what it left out', () => {
      expect(bytes(text)).toBeLessThanOrEqual(budget);
      expect(omitted.length).toBeGreaterThan(0);
      expect(text).toContain(omitted.length + ' stages omitted for length, each left out whole: ');
      for (const column of omitted) expect(text).toContain(column.id + ' (' + column.name + ')');
      expect(text).toContain('Read them with get_workflow_summary.');
    });

    it('keeps the task stage and its destinations before any other stage', () => {
      for (const id of ['s10', 's11', 's9']) expect(text, id).toContain(id + ' | Stage ' + id.slice(1) + ' | ');
      expect(text).toContain('* s10 | ');
    });

    it('leaves a stage out whole and never truncates a kept description or condition', () => {
      for (const column of columns) {
        const kept = text.includes(column.id + ' | ' + column.name + ' | ');
        expect(text.includes(column.description!), column.id).toBe(kept);
      }
    });

    it('keeps the stages it holds in workflow order', () => {
      const order = columns.filter(column => text.includes(column.id + ' | ' + column.name + ' | ')).map(column => text.indexOf(column.id + ' | '));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });
  });

  it('keeps the task stage whole even when it alone exceeds the budget', () => {
    const columns = longFlow(3, 2000);
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s1') }, 800);
    expect(text).toContain(columns[1]!.description!);
    expect(text).toContain('2 stages omitted for length');
  });

  it('keeps the header and the task stage whole even when they alone pass the default budget', () => {
    const huge = 'h'.repeat(WORKFLOW_MAP_BUDGET + 1000);
    const columns = [{ ...longFlow(1)[0]!, description: huge }, ...longFlow(3).slice(1).map(column => ({ ...column, id: 'x' + column.id }))];
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s0') });
    // Mandatory content is kept whole, never cut, so only it can pass the budget; nothing else is kept.
    expect(text).toContain(huge);
    expect(text).toContain('2 stages omitted for length');
    expect(text.split('\n').filter(line => /^ {2}\w+ \|/.test(line))).toEqual([]);
  });

  it('names a bounded number of omitted stages and keeps the count exact', () => {
    const columns = longFlow(300);
    const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s0') }, 2000);
    const omittedCount = columns.filter(column => !text.includes(column.id + ' | ' + column.name + ' | ')).length;
    expect(omittedCount).toBeGreaterThan(OMISSION_NAME_LIMIT);
    const line = text.split('\n').find(value => value.includes('omitted for length'))!;
    expect(line.startsWith(omittedCount + ' stages omitted for length')).toBe(true);
    expect(line).toContain(', and ' + (omittedCount - OMISSION_NAME_LIMIT) + ' more.');
    expect((line.match(/ \(Stage \d+\)/g) ?? []).length).toBe(OMISSION_NAME_LIMIT);
    expect(bytes(text)).toBeLessThanOrEqual(2000);
  });

  describe('closing line allowance', () => {
    const closingLine = (text: string) => text.split('\n').find(value => value.includes('omitted for length'))!;
    const named = (name: string) => longFlow(60).map(column => ({ ...column, name }));

    it('lists only the names that fit whole in its allowance, so the map stays within the default budget', () => {
      const columns = named('L'.repeat(500));
      const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s0') });
      const omittedCount = columns.filter(column => !text.includes(column.id + ' | ' + column.name + ' | ')).length;
      expect(omittedCount).toBeGreaterThan(OMISSION_NAME_LIMIT);
      expect(bytes(text)).toBeLessThanOrEqual(WORKFLOW_MAP_BUDGET);
      const line = closingLine(text);
      expect(line.startsWith(omittedCount + ' stages omitted for length')).toBe(true);
      const listed = line.match(/s\d+ \(L+\)/g) ?? [];
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.length).toBeLessThan(OMISSION_NAME_LIMIT);
      for (const label of listed) expect(label.length).toBe(label.indexOf(' ') + 3 + 500);
      expect(line).toContain(', and ' + (omittedCount - listed.length) + ' more.');
      expect(bytes(line.slice(line.indexOf(': ') + 2, line.lastIndexOf('. Read them')))).toBeLessThanOrEqual(OMISSION_NAMES_BUDGET + 40);
    });

    it('counts the allowance in UTF-8 bytes, not characters', () => {
      const columns = named('日本語'.repeat(100));
      const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s0') });
      expect(bytes(text)).toBeLessThanOrEqual(WORKFLOW_MAP_BUDGET);
      const listed = closingLine(text).match(/s\d+ \((?:日本語)+\)/g) ?? [];
      expect(listed.length).toBe(1);
    });

    describe('when the kept content leaves little room', () => {
      const flat = (ids: string[]): Column[] => ids.map(id => ({ id, name: id.toUpperCase(), description: ('Owns ' + id + '. ').padEnd(200, 'x') }));
      const mandatory = bytes(renderWorkflowMap({ board: board(flat(['a'])), hub, sharing: undefined, task: task('a') }));
      const minimum = bytes('2 stages omitted for length, each left out whole. Read them with get_workflow_summary.');
      const render = (budget: number) => renderWorkflowMap({ board: board(flat(['a', 'b', 'c'])), hub, sharing: undefined, task: task('a') }, budget);

      it('stays within the budget when the header, the current stage, and the shortest line fit', () => {
        const text = render(mandatory + 1 + minimum);
        expect(bytes(text)).toBe(mandatory + 1 + minimum);
        expect(closingLine(text)).toBe('2 stages omitted for length, each left out whole. Read them with get_workflow_summary.');
      });

      it('names only what the remaining room holds', () => {
        for (const extra of [0, 20, 40, 60, 80, 120, 200, 400]) {
          const budget = mandatory + 1 + minimum + extra;
          const text = render(budget);
          expect(bytes(text), String(extra)).toBeLessThanOrEqual(budget);
          expect(text, String(extra)).toContain('2 stages omitted for length');
        }
        expect(closingLine(render(mandatory + 1 + minimum + 400))).toContain(': b (B), c (C).');
      });

      it('overflows only by the shortest closing line when even that does not fit', () => {
        const text = render(mandatory + minimum - 40);
        expect(bytes(text)).toBe(mandatory + 1 + minimum);
        expect(text).toContain('2 stages omitted for length, each left out whole. Read them');
      });
    });

    it('names no stage when none fits, and still states the exact count and where to read them', () => {
      const columns = named('L'.repeat(OMISSION_NAMES_BUDGET + 10));
      const text = renderWorkflowMap({ board: board(columns), hub, sharing: undefined, task: task('s0') });
      const omittedCount = columns.filter(column => !text.includes(column.id + ' | ' + column.name + ' | ')).length;
      expect(omittedCount).toBeGreaterThan(0);
      expect(closingLine(text)).toBe(omittedCount + ' stage' + (omittedCount === 1 ? '' : 's') + ' omitted for length, each left out whole. Read them with get_workflow_summary.');
    });
  });

  it('lets the summary tool read every stage the map left out', () => {
    const columns = longFlow(22);
    const source = board(columns);
    const text = renderWorkflowMap({ board: source, hub, sharing: undefined, task: task('s10') }, 3000);
    const omitted = columns.filter(column => !text.includes(column.id + ' | ' + column.name + ' | ')).map(column => column.id);
    expect(omitted.length).toBeGreaterThan(0);
    const records = projectWorkflowSummary(source, hub, undefined, task('s10'));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let index = 0; index < 20; index++) {
      const page = workflowSummaryPage(records, cursor);
      for (const record of page.records) if (record.kind === 'stage') seen.add(String(record.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    for (const id of omitted) expect(seen.has(id), id).toBe(true);
  });
});
