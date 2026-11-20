import { describe, expect, it } from 'vitest';
import {
  applyPlanEdits,
  planFileName,
  planRelativePath,
  PLAN_SEGMENT_MAX_LENGTH,
  planSegment,
} from '../../src/domain/plan-path.js';

/** A newline built at runtime, so the source carries no escape a shell could consume. */
const NL = String.fromCharCode(10);

describe('the plan segment rule', () => {
  it('turns a card title into a readable directory', () => {
    expect(planSegment('Fix login bug')).toBe('fix-login-bug');
    expect(planSegment('  Checkout REDESIGN  ')).toBe('checkout-redesign');
    expect(planSegment('Project Planner v2')).toBe('project-planner-v2');
  });

  it('collapses a run of separators into one hyphen and trims the edges', () => {
    expect(planSegment('Fix   the // login -- bug')).toBe('fix-the-login-bug');
    expect(planSegment('--- leading and trailing ---')).toBe('leading-and-trailing');
  });

  it('drops every character outside the kept set', () => {
    expect(planSegment('Acao de revisao')).toBe('acao-de-revisao');
    expect(planSegment('A' + String.fromCharCode(0xE7) + 'ao')).toBe('a-ao');
    expect(planSegment('v2.1: release!')).toBe('v2-1-release');
  });

  it('keeps an already-slugged value unchanged', () => {
    expect(planSegment('fix-login-bug')).toBe('fix-login-bug');
  });

  it('refuses a name with no usable character', () => {
    expect(planSegment('!!!')).toBeUndefined();
    expect(planSegment('   ')).toBeUndefined();
    expect(planSegment('')).toBeUndefined();
  });

  it('bounds the segment and never ends it with a hyphen', () => {
    const bounded = planSegment('a'.repeat(PLAN_SEGMENT_MAX_LENGTH) + ' trailing');
    expect(bounded).toHaveLength(PLAN_SEGMENT_MAX_LENGTH);
    const cut = planSegment('a'.repeat(PLAN_SEGMENT_MAX_LENGTH - 1) + ' b');
    expect(cut).toBe('a'.repeat(PLAN_SEGMENT_MAX_LENGTH - 1));
  });
});

describe('the plan file name rule', () => {
  it('accepts a bare Markdown name', () => {
    expect(planFileName('plan.md')).toBe('plan.md');
    expect(planFileName('  design.md  ')).toBe('design.md');
    expect(planFileName('TASKS.MD')).toBe('TASKS.MD');
  });

  it('refuses a name that is not Markdown', () => {
    expect(() => planFileName('plan.txt')).toThrow(/must end in/);
    expect(() => planFileName('plan')).toThrow(/must end in/);
  });

  it('refuses a name that is a path', () => {
    expect(() => planFileName('../plan.md')).toThrow();
    expect(() => planFileName('nested/plan.md')).toThrow();
    expect(() => planFileName('nested' + String.fromCharCode(92) + 'plan.md')).toThrow();
    expect(() => planFileName('..')).toThrow();
    expect(() => planFileName('.')).toThrow();
  });

  it('refuses an empty name and a control character', () => {
    expect(() => planFileName('   ')).toThrow(/Provide a plan file name/);
    expect(() => planFileName('pl' + String.fromCharCode(7) + 'an.md')).toThrow();
  });

  it('builds the workspace-relative path with forward slashes', () => {
    expect(planRelativePath('fix-login-bug', 'plan.md')).toBe('plans/fix-login-bug/plan.md');
  });
});

describe('the plan patch rule', () => {
  it('applies one replacement', () => {
    const plan = ['# Plan', '', 'Old step.', ''].join(NL);
    const patched = applyPlanEdits(plan, [{ old: 'Old step.', new: 'New step.' }]);
    expect(patched).toBe(['# Plan', '', 'New step.', ''].join(NL));
  });

  it('applies several replacements in order', () => {
    const patched = applyPlanEdits('alpha beta gamma', [
      { old: 'alpha', new: 'one' },
      { old: 'gamma', new: 'three' },
    ]);
    expect(patched).toBe('one beta three');
  });

  it('applies a later replacement to the result of an earlier one', () => {
    expect(applyPlanEdits('start', [{ old: 'start', new: 'middle' }, { old: 'middle', new: 'end' }])).toBe('end');
  });

  it('refuses a search text that occurs zero times', () => {
    expect(() => applyPlanEdits('the plan', [{ old: 'missing', new: 'x' }])).toThrow(/matched no text/);
  });

  it('refuses a search text that occurs more than once', () => {
    expect(() => applyPlanEdits('step one and step one', [{ old: 'step one', new: 'step two' }]))
      .toThrow(/matched more than once/);
  });

  it('leaves the input untouched when one replacement of the batch fails', () => {
    const original = ['# Plan', '', 'Keep this.', ''].join(NL);
    expect(() => applyPlanEdits(original, [
      { old: 'Keep this.', new: 'Changed.' },
      { old: 'absent', new: 'x' },
    ])).toThrow();
    expect(original).toBe(['# Plan', '', 'Keep this.', ''].join(NL));
  });

  it('refuses an empty search text and a no-op replacement', () => {
    expect(() => applyPlanEdits('plan', [{ old: '', new: 'x' }])).toThrow(/empty search text/);
    expect(() => applyPlanEdits('plan', [{ old: 'plan', new: 'plan' }])).toThrow(/unchanged/);
  });

  it('accepts an empty replacement as a deletion', () => {
    expect(applyPlanEdits('keep remove', [{ old: ' remove', new: '' }])).toBe('keep');
  });
});
