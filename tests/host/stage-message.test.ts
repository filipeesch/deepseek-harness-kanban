import { describe, expect, it } from 'vitest';
import type { Column, Workflow } from '../../src/shared/types.js';
import {
  buildStageInstructionDelivery,
  buildStageInstructionSummary,
  createStageInstructionMessage,
  stageInstructionTarget,
} from '../../src/host/stage-message.js';

const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });

const branched = () => flow(
  column('review', { allowedTransitions: [{ to: 'done' }, { to: 'rework' }] }),
  column('rework'),
  column('done'),
);

describe('stage instruction message', () => {
  it('appends the briefing to the instruction when one applies', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Review it.', briefing: 'Workflow transitions from REVIEW:', stageName: 'REVIEW', task: { columnId: 'review' }, workflow: branched(), requestId: 'r1',
    });
    expect(delivery.text).toBe('Review it.\n\nWorkflow transitions from REVIEW:');
  });

  it('keeps the instruction alone without a briefing', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Review it.', stageName: 'REVIEW', task: { columnId: 'review' }, workflow: branched(), requestId: 'r1',
    });
    expect(delivery.text).toBe('Review it.');
  });

  it('places the declared reason between the instruction and the briefing', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Rework it.', transition: { fromStageName: 'REVIEW', reason: 'Changes are needed.' }, briefing: 'Workflow transitions from REWORK:',
      stageName: 'REWORK', task: { columnId: 'rework' }, workflow: branched(), requestId: 'r1',
    });
    expect(delivery.text).toBe('Rework it.\n\nTransition reason (from REVIEW):\nChanges are needed.\n\nWorkflow transitions from REWORK:');
  });

  it('carries the declared reason without a briefing', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Rework it.', transition: { fromStageName: 'REVIEW', reason: 'Changes are needed.' },
      stageName: 'REWORK', task: { columnId: 'rework' }, workflow: branched(), requestId: 'r1',
    });
    expect(delivery.text).toBe('Rework it.\n\nTransition reason (from REVIEW):\nChanges are needed.');
  });

  it('keeps the reason out of the collapsed summary', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Rework it.', transition: { fromStageName: 'REVIEW', reason: 'Changes are needed.' },
      stageName: 'REWORK', task: { columnId: 'rework' }, workflow: branched(), requestId: 'r1',
    });
    expect(delivery.summary).not.toContain('Changes are needed.');
  });

  it('carries the delivery identity', () => {
    const delivery = buildStageInstructionDelivery({
      instruction: 'Review it.', stageName: 'REVIEW', task: { columnId: 'review' }, workflow: branched(), requestId: 'request-1',
    });
    expect(delivery.requestId).toBe('request-1');
  });

  it('names the recorded transition while it resolves', () => {
    const target = stageInstructionTarget(branched(), { columnId: 'review', recordedTransition: { fromColumnId: 'review', columnId: 'rework', at: '2026-01-01T00:00:00.000Z' } });
    expect(target).toBe('REWORK');
  });

  it('names the default target without a recording', () => {
    expect(stageInstructionTarget(branched(), { columnId: 'review' })).toBe('DONE');
  });

  it('names the next stage in workflow order without configured transitions', () => {
    const workflow = flow(column('plan'), column('review'));
    expect(stageInstructionTarget(workflow, { columnId: 'plan' })).toBe('REVIEW');
  });

  it('names no target for the last stage without configured transitions', () => {
    const workflow = flow(column('plan'), column('review'));
    expect(stageInstructionTarget(workflow, { columnId: 'review' })).toBeUndefined();
  });

  it('composes the collapsed summary from the stage and its target', () => {
    expect(buildStageInstructionSummary('REVIEW', 'DONE')).toBe('Stage: REVIEW - next: DONE');
    expect(buildStageInstructionSummary('REVIEW')).toBe('Stage: REVIEW');
  });

  it('bounds the summary to the host notice limit', () => {
    const summary = buildStageInstructionSummary('X'.repeat(400), 'Y'.repeat(400));
    expect(summary).toHaveLength(120);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('wraps the delivery as a plugin-sourced user message with the notice form', () => {
    const message = createStageInstructionMessage({ requestId: 'request-1', text: 'Review it.', summary: 'Stage: REVIEW - next: DONE' });
    expect(message.role).toBe('user');
    expect(message.content).toEqual([{ type: 'text', text: 'Review it.' }]);
    expect(message.source).toMatchObject({ kind: 'stage-instruction', form: 'notice', summary: 'Stage: REVIEW - next: DONE', requestId: 'request-1' });
  });
});
