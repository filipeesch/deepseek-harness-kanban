import { describe, expect, it } from 'vitest';
import { activeSlide, choose, emptyDraft, hasContent, restoreDraft, setActive, setAnswerText, setGeneralNotes, toStoredDraft } from '../../src/questions/draft.js';
import { choice, free, multi, round } from './fixtures.js';

describe('question draft state', () => {
  it('starts empty and positioned on the round first slide', () => {
    const draft = emptyDraft('round-1');
    expect(draft).toEqual({ roundId: 'round-1', answers: {}, generalNotes: '', active: null });
    expect(hasContent(draft)).toBe(false);
    expect(activeSlide(round(), draft)).toEqual({ kind: 'page', callId: 'page-0' });
    expect(activeSlide(round([]), draft)).toEqual({ kind: 'notes' });
  });

  it('round-trips every durable field through the stored projection', () => {
    const draft = {
      roundId: 'round-1',
      answers: {
        'page-0': { choices: [], text: '', other: '', notes: 'Only on the weekend.' },
        'page-1': { choices: ['Read', 'Write'], text: '', other: 'Audit', notes: '' },
        'page-2': { choices: [], text: 'Keep histories.', other: '', notes: '' },
      },
      generalNotes: 'Stay local.',
      active: { kind: 'notes' as const },
    };
    const projection = toStoredDraft(draft, '2026-11-12T10:00:00.000Z');
    expect(projection.updatedAt).toBe('2026-11-12T10:00:00.000Z');
    const restored = restoreDraft('round-1', projection);
    expect(restored).toEqual(draft);
    expect(hasContent(restored)).toBe(true);
    expect(activeSlide(round([choice, multi, free]), restored)).toEqual({ kind: 'notes' });
  });

  it('falls back to the first page when the recorded slide no longer exists', () => {
    const stale = { ...emptyDraft('round-1'), active: { kind: 'page' as const, callId: 'removed-call' } };
    expect(activeSlide(round([choice]), stale)).toEqual({ kind: 'page', callId: 'page-0' });
    expect(activeSlide(round([]), stale)).toEqual({ kind: 'notes' });
    expect(activeSlide(round([choice]), { ...emptyDraft('round-1'), active: { kind: 'notes' } })).toEqual({ kind: 'notes' });
  });

  it('copies restored and projected answers instead of aliasing them', () => {
    const projection = toStoredDraft({
      roundId: 'round-1',
      answers: { 'page-0': { choices: ['Local'], text: '', other: '', notes: '' } },
      generalNotes: '',
      active: null,
    }, 'now');
    const restored = restoreDraft('round-1', projection);
    restored.answers['page-0']!.choices.push('Remote');
    projection.answers['page-0']!.notes = 'changed';
    expect(restored.answers['page-0']!.notes).toBe('');
    expect(projection.answers['page-0']!.choices).toEqual(['Local']);
    expect(toStoredDraft(restored, 'now').answers['page-0']!.choices).toEqual(['Local', 'Remote']);
  });

  it('detects content from any entered field', () => {
    const base = emptyDraft('round-1');
    expect(hasContent({ ...base, generalNotes: '  ' })).toBe(false);
    expect(hasContent({ ...base, generalNotes: 'Notes' })).toBe(true);
    for (const overrides of [{ choices: ['Local'] }, { text: 'text' }, { other: 'other' }, { notes: 'notes' }]) {
      expect(hasContent({ ...base, answers: { 'page-0': { choices: [], text: '', other: '', notes: '', ...overrides } } })).toBe(true);
    }
  });

  it('records choices with single and multiple selection semantics', () => {
    const single = choose(emptyDraft('round-1'), choice, 'page-0', 'Local', true);
    expect(single.answers['page-0']!.choices).toEqual(['Local']);
    expect(choose(single, choice, 'page-0', 'Remote', true).answers['page-0']!.choices).toEqual(['Remote']);

    let multiDraft = choose(emptyDraft('round-1'), multi, 'page-1', 'Read', true);
    multiDraft = choose(multiDraft, multi, 'page-1', 'Write', true);
    expect(multiDraft.answers['page-1']!.choices).toEqual(['Read', 'Write']);
    multiDraft = choose(multiDraft, multi, 'page-1', 'Read', false);
    expect(multiDraft.answers['page-1']!.choices).toEqual(['Write']);
  });

  it('keeps the other fields of an answer while replacing one text field', () => {
    let draft = choose(emptyDraft('round-1'), multi, 'page-1', 'Read', true);
    draft = setAnswerText(draft, 'page-1', 'other', 'Audit');
    draft = setAnswerText(draft, 'page-1', 'notes', 'Keep it.');
    draft = setGeneralNotes(draft, 'Stay local.');
    draft = setActive(draft, { kind: 'notes' });
    expect(draft.answers['page-1']).toEqual({ choices: ['Read'], text: '', other: 'Audit', notes: 'Keep it.' });
    expect(draft.generalNotes).toBe('Stay local.');
    expect(draft.active).toEqual({ kind: 'notes' });
  });
});
