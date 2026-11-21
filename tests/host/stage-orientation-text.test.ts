import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { orientStage } from '../../src/domain/stage-orientation.js';
import { ORIENTATION_BLOCK_BUDGET, renderOrientationBlock } from '../../src/host/stage-orientation-text.js';

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'review',
  groups: [],
  columns: [
    { id: 'review', name: 'Review', description: 'Owns the verification of the change.', onEnterPrompt: 'Review it.', allowedTransitions: [{ to: 'archive', when: 'Every finding is resolved.' }, { to: 'apply' }] },
    { id: 'apply', name: 'Apply', description: 'Owns the implementation.', onEnterPrompt: 'Apply it.' },
    { id: 'archive', name: 'Archive', onEnterPrompt: 'Archive it.' },
    { id: 'end', name: 'End', allowedTransitions: [] },
    { id: 'check', name: 'Check', description: 'Runs the check.', scripted: { language: 'bash', code: 'x', directory: 'task', exits: { passed: 'archive', failed: 'apply' } } },
    { id: 'gate', name: 'Gate', decision: { question: 'Go?', options: [{ id: 'go', title: 'Go ahead', to: 'archive' }] } },
  ],
};
const render = (id: string, budget?: number) => renderOrientationBlock(orientStage(workflow, id)!, budget);

describe('orientation block', () => {
  it('states the stage, its kind, its responsibility, its routing, and its exits with conditions', () => {
    const text = render('review');
    expect(text).toContain('Stage: Review (review), agent-instruction');
    expect(text).toContain('Responsibility: Owns the verification of the change.');
    expect(text).toContain('Routing: the stage configures its exits');
    expect(text).toContain('- Archive (archive), agent-instruction. Condition: Every finding is resolved.');
    expect(text).toContain('- Apply (apply), agent-instruction\n  Responsibility: Owns the implementation.');
  });

  it('says that no responsibility is authored', () => {
    expect(render('archive')).toContain('Responsibility: none authored');
  });

  it('states that a stage without exits has none', () => {
    const text = render('end');
    expect(text).toContain('Exits: none');
    expect(text).toContain('Routing: the stage permits no exit');
  });

  it('lists every other stage for an unrestricted stage', () => {
    const text = render('apply');
    expect(text).toContain('every other stage is an exit');
    for (const id of ['review', 'archive', 'end', 'check', 'gate']) expect(text).toContain('(' + id + ')');
    expect(text.split('\n').some(line => line.startsWith('- Apply'))).toBe(false);
  });

  it('names the exits of a scripted stage and the options of a decision stage', () => {
    expect(render('check')).toContain('- exit passed: Archive (archive), agent-instruction');
    expect(render('check')).toContain('the stage runs a program');
    expect(render('gate')).toContain('- option go (Go ahead): Archive (archive), agent-instruction');
    expect(render('gate')).toContain('waits for a person');
  });

  it('describes and never commands', () => {
    for (const id of ['review', 'apply', 'check', 'gate', 'end']) {
      expect(render(id), id).not.toMatch(/\b(must|should|do not|never|always|declare|move the task|perform)\b/i);
    }
  });

  it('keeps a multi-line responsibility whole', () => {
    const multi: Workflow = { ...workflow, columns: [{ id: 'a', name: 'A', description: 'First line.\nSecond line.' }] };
    expect(renderOrientationBlock(orientStage(multi, 'a')!)).toContain('Responsibility: First line.\n  Second line.');
  });

  it('keeps every exit and condition and drops only destination responsibilities over the budget', () => {
    const long = 'r'.repeat(900);
    const columns: Workflow['columns'] = [
      { id: 'hub', name: 'Hub', description: 'Owns the hub.', allowedTransitions: Array.from({ length: 6 }, (_, index) => ({ to: 's' + index, when: 'Condition ' + index + '.' })) },
      ...Array.from({ length: 6 }, (_, index) => ({ id: 's' + index, name: 'Stage ' + index, description: long })),
    ];
    const big: Workflow = { name: 'Big', initialColumnId: 'hub', groups: [], columns };
    const text = renderOrientationBlock(orientStage(big, 'hub')!);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(ORIENTATION_BLOCK_BUDGET);
    for (let index = 0; index < 6; index++) expect(text).toContain('- Stage ' + index + ' (s' + index + '), no-instruction. Condition: Condition ' + index + '.');
    expect(text).not.toContain(long);
    expect(text).toContain('Responsibility: Owns the hub.');
    expect(text).toContain("Exit destinations' responsibilities are omitted for length; read them with get_workflow_summary.");
  });

  it('does not claim an omission when no destination had a responsibility', () => {
    const columns: Workflow['columns'] = [
      { id: 'hub', name: 'Hub', allowedTransitions: [{ to: 's0', when: 'c'.repeat(4200) }] },
      { id: 's0', name: 'S0' },
    ];
    const text = renderOrientationBlock(orientStage({ name: 'W', initialColumnId: 'hub', groups: [], columns }, 'hub')!);
    expect(text).toContain('c'.repeat(4200));
    expect(text).not.toContain('omitted for length');
  });

  it('keeps the current stage text whole when it alone passes the budget, dropping only destination responsibilities', () => {
    const own = 'o'.repeat(ORIENTATION_BLOCK_BUDGET + 200);
    const columns: Workflow['columns'] = [
      { id: 'hub', name: 'Hub', description: own, allowedTransitions: [{ to: 's0', when: 'Condition.' }] },
      { id: 's0', name: 'S0', description: 'Destination responsibility.' },
    ];
    const text = renderOrientationBlock(orientStage({ name: 'W', initialColumnId: 'hub', groups: [], columns }, 'hub')!);
    expect(text).toContain(own);
    expect(text).toContain('Condition: Condition.');
    expect(text).not.toContain('Destination responsibility.');
    expect(text).toContain('omitted for length');
  });
});
