import { describe, expect, it } from 'vitest';
import { emptyAnswer, formatAnswers, OTHER_CHOICE, validateQuestionPage } from '../../src/questions/index.js';
import { answer, choice, free, multi, round } from './fixtures.js';

describe('validateQuestionPage', () => {
  it('validates and detaches supported rich fields', () => {
    const input = { ...choice, answers_affect_followup: false, unknown: 'not a stored contract' };
    const parsed = validateQuestionPage(input);
    expect(parsed).toEqual({ ...choice, answers_affect_followup: false });
    expect(parsed.options).not.toBe(input.options);
    expect(validateQuestionPage(free)).toEqual(free);
  });
  it.each([
    null, {}, { ...choice, question: '  ' }, { ...choice, type: 'approval' }, { ...choice, options: [choice.options![0]] },
    { ...choice, options: [{ title: 'x', description: '' }, { title: 'x', description: '' }] },
    { ...choice, options: [{ title: 'x' }, { title: 'y', description: '' }] }, { ...choice, model_lean: 'Missing' },
    { ...choice, weight: 'high' }, { ...choice, context: 1 }, { ...choice, answers_affect_followup: 'yes' },
    { ...free, options: choice.options }, { ...free, model_lean: 'x' },
  ])('rejects malformed page %j', input => { expect(() => validateQuestionPage(input)).toThrow(); });
});

describe('formatAnswers', () => {
  it('produces one ordinary text reply with question/answer mappings, Other, and notes', () => {
    const value = round([choice, multi, free]);
    const text = formatAnswers(value, {
      'page-0': answer({ choices: ['Local'], notes: 'Keep it simple.' }),
      'page-1': answer({ choices: ['Read', 'Write', OTHER_CHOICE], other: 'Audit' }),
      'page-2': answer({ text: 'Keep all histories.' }),
    }, 'No external service.');
    expect(text).toContain('### 1. Choose **storage**');
    expect(text).toContain('Answer: Local');
    expect(text).toContain('Notes: Keep it simple.');
    expect(text).toContain('Answer: Read; Write');
    expect(text).toContain('Other: Audit');
    expect(text).toContain('Answer: Keep all histories.');
    expect(text).toContain('## Additional context\n\nNo external service.');
    expect(text).not.toContain(OTHER_CHOICE);
  });
  it('accepts Map answers and ignores unselected retained Other text', () => {
    expect(formatAnswers(round(), new Map([['page-0', answer({ choices: ['Local'], other: 'old draft' })]]))).not.toContain('old draft');
  });
  it('rejects incomplete, answered, empty or invalid rounds and choices', () => {
    const good = { 'page-0': answer({ choices: ['Local'] }) };
    expect(() => formatAnswers(round([choice], false), good)).toThrow('not ready');
    expect(() => formatAnswers({ ...round(), answered: true }, good)).toThrow('not ready');
    expect(() => formatAnswers(round([]), {})).toThrow('not ready');
    expect(() => formatAnswers(round(), {})).toThrow('valid answer');
    expect(() => formatAnswers(round(), { 'page-0': emptyAnswer() })).toThrow();
    expect(() => formatAnswers(round(), { 'page-0': answer({ choices: ['Local', 'Remote'] }) })).toThrow();
    expect(() => formatAnswers(round(), { 'page-0': answer({ choices: ['Invented'] }) })).toThrow();
    expect(() => formatAnswers(round(), { 'page-0': answer({ choices: [OTHER_CHOICE], other: ' ' }) })).toThrow();
    expect(() => formatAnswers(round([free]), { 'page-0': answer({ text: ' ' }) })).toThrow();
  });
});
