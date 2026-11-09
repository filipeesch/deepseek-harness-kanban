import { describe, expect, it } from 'vitest';
import type { Column, Workflow } from '../../src/shared/types.js';
import { buildTransitionBriefing } from '../../src/host/stage-briefing.js';
import { transitions } from '../support/transition-rules.js';

const column = (id: string, extra: Partial<Column> = {}): Column => ({ id, name: id.toUpperCase(), ...extra });
const flow = (...columns: Column[]): Workflow => ({ name: 'Flow', initialColumnId: columns[0]!.id, columns, groups: [] });

const twoTargets = () => flow(
  column('review', {
    onEnterPrompt: 'Review it.',
    allowedTransitions: [
      { to: 'done', when: 'The review approved the work.' },
      { to: 'rework', when: 'The review requested changes.' },
    ],
  }),
  column('rework'),
  column('done'),
);

describe('transition briefing', () => {
  it('produces no briefing without configured transitions', () => {
    const workflow = flow(column('review', { onEnterPrompt: 'Review it.' }), column('done'));
    expect(buildTransitionBriefing(workflow, { columnId: 'review' })).toBeUndefined();
  });

  it('produces no briefing with a single configured target', () => {
    const workflow = flow(column('review', { allowedTransitions: transitions('done') }), column('done'));
    expect(buildTransitionBriefing(workflow, { columnId: 'review' })).toBeUndefined();
  });

  it('lists every target with its condition and the default rule', () => {
    const briefing = buildTransitionBriefing(twoTargets(), { columnId: 'review' });
    expect(briefing).toBeDefined();
    expect(briefing).toContain('Workflow transitions from REVIEW:');
    expect(briefing).toContain('- REWORK — The review requested changes.');
    expect(briefing).toContain('- DONE — The review approved the work.');
    expect(briefing).toContain('No transition recorded.');
    expect(briefing).toContain('with none recorded the advance uses DONE.');
    expect(briefing).toContain('set_next_transition');
  });

  it('keeps a target without a condition free of trailing text', () => {
    const workflow = flow(column('review', { allowedTransitions: transitions('done', 'rework') }), column('rework'), column('done'));
    const briefing = buildTransitionBriefing(workflow, { columnId: 'review' });
    expect(briefing).toContain('- REWORK\n');
    expect(briefing).not.toContain('- REWORK —');
  });

  it('names the recorded transition', () => {
    const briefing = buildTransitionBriefing(twoTargets(), { columnId: 'review', recordedTransition: { fromColumnId: 'review', columnId: 'done', at: '2026-01-01T00:00:00.000Z' } });
    expect(briefing).toContain('Recorded transition: DONE.');
    expect(briefing).not.toContain('No transition recorded.');
  });

  it('explains a recording that no longer applies', () => {
    const briefing = buildTransitionBriefing(twoTargets(), { columnId: 'review', recordedTransition: { fromColumnId: 'review', columnId: 'gone', at: '2026-01-01T00:00:00.000Z' } });
    expect(briefing).toContain('The recorded transition no longer applies');
    expect(briefing).toContain('no longer exists');
  });
});
