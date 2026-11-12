import { describe, expect, it } from 'vitest';
import { affectedCards, composeWorkflowReport, reviewWorkflowText, REPORT_ITEM_LIMIT } from '../../src/domain/workflow-report.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const FLOW = 'name: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [done]\n  - id: done\n    label: Done\n';

describe('workflow review', () => {
  it('reports positions and nothing else for a document that does not parse', () => {
    const review = reviewWorkflowText({ text: 'columns: [', previousText: FLOW });
    expect(review.valid).toBe(false);
    expect(review.problems.length).toBeGreaterThan(0);
    expect(review.difference).toBeNull();
    expect(review.warnings).toEqual([]);
    expect(review.affectedCards).toEqual([]);
    expect(review.workflow).toBeNull();
  });

  it('reports the difference, the warnings, and the affected cards for a document that parses', () => {
    const next = FLOW.replace('allowed_transitions: [done]', 'allowed_transitions: [review]').replace('  - id: done\n    label: Done\n', '  - id: review\n    label: Review\n    allowed_transitions: []\n');
    const review = reviewWorkflowText({
      text: next,
      previousText: FLOW,
      cards: [{ id: 'task-1', columnId: 'done', recordedTransition: { columnId: 'done' } }],
    });
    expect(review.valid).toBe(true);
    expect(review.difference?.stages).toContainEqual({ stage: 'done', change: 'removed' });
    expect(review.affectedCards).toContainEqual({ taskId: 'task-1', stage: 'done', reason: 'stage-removed' });
  });

  it('reads a creation as an added workflow', () => {
    const review = reviewWorkflowText({ text: FLOW, previousText: null });
    expect(review.valid).toBe(true);
    expect(review.difference?.stages.map(stage => stage.change)).toEqual(['added', 'added']);
    expect(review.affectedCards).toEqual([]);
  });
});

describe('affected cards', () => {
  const BEFORE = 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review, done]\n  - id: review\n    label: Review\n  - id: done\n    label: Done\n';
  const AFTER = 'initial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [review]\n  - id: review\n    label: Review\n';

  it('names no card when the change preserves every stage and route', () => {
    expect(affectedCards(parseWorkflow(BEFORE), parseWorkflow(BEFORE), [{ id: 'task-1', columnId: 'todo' }])).toEqual([]);
  });

  it('names a card in a removed stage', () => {
    expect(affectedCards(parseWorkflow(BEFORE), parseWorkflow(AFTER), [{ id: 'task-1', columnId: 'done' }])).toEqual([
      { taskId: 'task-1', stage: 'done', reason: 'stage-removed' },
    ]);
  });

  it('names a card whose recorded destination stage was removed', () => {
    const withoutDone = BEFORE.replace('  - id: done\n    label: Done\n', '').replace('allowed_transitions: [review, done]', 'allowed_transitions: [review]');
    expect(affectedCards(parseWorkflow(BEFORE), parseWorkflow(withoutDone), [{ id: 'task-3', columnId: 'todo', recordedTransition: { columnId: 'done' } }])).toEqual([
      { taskId: 'task-3', stage: 'todo', reason: 'route-removed' },
    ]);
  });

  it('names a card whose recorded destination is no longer permitted', () => {
    const withoutDone = BEFORE.replace('  - id: done\n    label: Done\n', '').replace('allowed_transitions: [review, done]', 'allowed_transitions: [review]');
    const narrowed = AFTER.replace('  - id: review\n    label: Review\n', '  - id: review\n    label: Review\n  - id: done\n    label: Done\n');
    expect(affectedCards(parseWorkflow(withoutDone), parseWorkflow(BEFORE), [{ id: 'task-2', columnId: 'todo', recordedTransition: { columnId: 'done' } }])).toEqual([]);
    expect(affectedCards(parseWorkflow(BEFORE), parseWorkflow(narrowed), [{ id: 'task-2', columnId: 'todo', recordedTransition: { columnId: 'done' } }])).toEqual([
      { taskId: 'task-2', stage: 'todo', reason: 'route-removed' },
    ]);
  });
});

describe('report bounds', () => {
  it('caps the itemized warnings and cards and counts the rest', () => {
    const warnings = Array.from({ length: REPORT_ITEM_LIMIT + 5 }, (_, index) => ({ kind: 'unreachable-stage' as const, stage: 'stage-' + index }));
    const cards = Array.from({ length: REPORT_ITEM_LIMIT + 2 }, (_, index) => ({ taskId: 'task-' + index, stage: 'todo', reason: 'stage-removed' as const }));
    const report = composeWorkflowReport({ valid: true, problems: [], difference: null, warnings, affectedCards: cards, workflow: null, previous: null });
    expect(report.warnings).toHaveLength(REPORT_ITEM_LIMIT);
    expect(report.warningsOmitted).toBe(5);
    expect(report.affectedCards).toHaveLength(REPORT_ITEM_LIMIT);
    expect(report.affectedCardsOmitted).toBe(2);
  });

  it('carries the script impact the host resolved', () => {
    const report = composeWorkflowReport({ valid: true, problems: [], difference: null, warnings: [], affectedCards: [], workflow: null, previous: null }, [
      { stage: 'wait', projectId: 'project-1', verdict: 'changed', reasons: ['exits'] },
    ]);
    expect(report.scripts).toEqual([{ stage: 'wait', projectId: 'project-1', verdict: 'changed', reasons: ['exits'] }]);
  });
});