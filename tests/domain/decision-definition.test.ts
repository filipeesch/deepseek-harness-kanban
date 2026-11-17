import { describe, expect, it } from 'vitest';
import { DECISION_LIMITS, canonicalDecision, composeDecisionReason, decisionDestinations, decisionEqual, decisionOption, normalizeDecisionNote, parseDecisionDefinition } from '../../src/domain/decision-definition.js';

const option = (id: string, to = 'done') => ({ id, title: 'Title ' + id, to });

describe('parseDecisionDefinition', () => {
  it('accepts a question with one option and drops a blank context', () => {
    const value = parseDecisionDefinition({ question: 'Proceed?', context: '  ', options: [option('approve')] });
    expect(value.question).toBe('Proceed?');
    expect(value.context).toBeUndefined();
    expect(value.options).toHaveLength(1);
  });

  it('keeps authored context and description text', () => {
    const value = parseDecisionDefinition({ question: 'Proceed?', context: 'Read this first.', options: [{ id: 'approve', title: 'Approve', description: 'Ship it.', to: 'done' }] });
    expect(value.context).toBe('Read this first.');
    expect(value.options[0]?.description).toBe('Ship it.');
  });

  it('accepts the maximum number of options', () => {
    const options = Array.from({ length: DECISION_LIMITS.options }, (_, index) => option('o' + index));
    expect(parseDecisionDefinition({ question: 'Pick', options }).options).toHaveLength(DECISION_LIMITS.options);
  });

  it('rejects a blank or oversized question', () => {
    expect(() => parseDecisionDefinition({ question: '   ', options: [option('a')] })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'x'.repeat(DECISION_LIMITS.questionLength + 1), options: [option('a')] })).toThrow();
  });

  it('rejects zero options, too many options, and a repeated id', () => {
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [] })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'Pick', options: Array.from({ length: DECISION_LIMITS.options + 1 }, (_, index) => option('o' + index)) })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [option('a'), option('a')] })).toThrow();
  });

  it('rejects an unsafe option id and an unknown field', () => {
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [{ id: 'not safe', title: 'T', to: 'done' }] })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [{ id: 'a', title: 'T', to: 'done', extra: true }] })).toThrow();
  });

  it('rejects a blank title or description and an invalid destination', () => {
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [{ id: 'a', title: '  ', to: 'done' }] })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [{ id: 'a', title: 'T', description: ' ', to: 'done' }] })).toThrow();
    expect(() => parseDecisionDefinition({ question: 'Pick', options: [{ id: 'a', title: 'T', to: 'not a stage' }] })).toThrow();
  });

  it('rejects a non-mapping value', () => {
    expect(() => parseDecisionDefinition('question')).toThrow();
    expect(() => parseDecisionDefinition(undefined)).toThrow();
  });
});

describe('decision helpers', () => {
  it('compares canonically and reads destinations in authored order', () => {
    const definition = parseDecisionDefinition({ question: 'Pick', options: [option('rework', 'in_progress'), option('approve', 'done')] });
    expect(decisionEqual(definition, structuredClone(definition))).toBe(true);
    expect(decisionDestinations(definition)).toEqual(['in_progress', 'done']);
    expect(decisionOption(definition, 'approve')?.to).toBe('done');
    expect(decisionOption(definition, 'missing')).toBeUndefined();
    expect(canonicalDecision(undefined)).toBeUndefined();
  });

  it('treats an absent context differently from an authored one', () => {
    const bare = parseDecisionDefinition({ question: 'Pick', options: [option('a')] });
    const contextual = parseDecisionDefinition({ question: 'Pick', context: 'Why.', options: [option('a')] });
    expect(decisionEqual(bare, contextual)).toBe(false);
  });


  it('composes a bounded reason that keeps the title and the observation', () => {
    const option = { id: 'fix', title: 'Fix it', description: 'Address the findings.', to: 'review' };
    expect(composeDecisionReason(option, 'Please fix the copy.')).toBe('Decision: Fix it\nObservation: Please fix the copy.\nAddress the findings.');
    const withoutNote = composeDecisionReason(option);
    expect(withoutNote).toBe('Decision: Fix it\nAddress the findings.');
    const longNote = 'x'.repeat(DECISION_LIMITS.noteLength);
    const bounded = composeDecisionReason(option, longNote);
    expect(bounded.startsWith('Decision: Fix it\nObservation: ')).toBe(true);
    expect(bounded).toContain(longNote);
    expect(bounded.length).toBeLessThanOrEqual(1000);
    const longTitle = { id: 'x', title: 'T'.repeat(DECISION_LIMITS.titleLength), to: 'review' };
    const exact = composeDecisionReason(longTitle, longNote);
    expect(exact.startsWith('Decision: ' + longTitle.title)).toBe(true);
    expect(exact.endsWith(longNote)).toBe(true);
    expect(exact.length).toBe(1000);
  });

  it('normalizes an observation: blank is absence and an oversized one is refused', () => {
    expect(normalizeDecisionNote(undefined)).toBeUndefined();
    expect(normalizeDecisionNote('   ')).toBeUndefined();
    expect(normalizeDecisionNote('  Keep the API.  ')).toBe('Keep the API.');
    expect(() => normalizeDecisionNote(42)).toThrow();
    expect(() => normalizeDecisionNote('x'.repeat(DECISION_LIMITS.noteLength + 1))).toThrow();
  });
});