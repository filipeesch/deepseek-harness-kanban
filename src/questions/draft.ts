import type { QuestionAnswer, QuestionDraftContent, QuestionDraftSlide, QuestionPage, QuestionRound, StoredQuestionDraft } from '../shared/types.js';
import { answerFor, emptyAnswer } from './validation.js';

/**
 * The in-progress form state for one round. Only the durable subset is persisted;
 * the panel's collapsed state, submission status, and dismissal confirmation stay
 * in the form because they describe the mounted surface, not the answer.
 */
export interface QuestionDraft {
  roundId: string;
  answers: Record<string, QuestionAnswer>;
  generalNotes: string;
  active: QuestionDraftSlide | null;
}

/** A draft with nothing entered, positioned on the round's first slide. */
export function emptyDraft(roundId: string): QuestionDraft {
  return { roundId, answers: Object.create(null) as Record<string, QuestionAnswer>, generalNotes: '', active: null };
}

function copyAnswer(answer: QuestionAnswer): QuestionAnswer {
  return { choices: [...answer.choices], text: answer.text, other: answer.other, notes: answer.notes };
}

/**
 * Rebuild a draft from its stored projection. Answers stay keyed by page callId, so
 * pages that arrived after the projection remain answerable; an active page that no
 * longer exists falls back to the round's first slide. Stored data is copied because
 * the bridge keeps the original for hydration.
 */
export function restoreDraft(roundId: string, stored: QuestionDraftContent | undefined): QuestionDraft {
  if (stored === undefined) return emptyDraft(roundId);
  const answers: Record<string, QuestionAnswer> = Object.create(null) as Record<string, QuestionAnswer>;
  for (const [callId, answer] of Object.entries(stored.answers)) answers[callId] = copyAnswer(answer);
  return { roundId, answers, generalNotes: stored.generalNotes, active: stored.active === null ? null : { ...stored.active } };
}

/** The durable content of a draft; the host stamps its own retention time. */
export function toDraftContent(draft: QuestionDraft): QuestionDraftContent {
  const answers: Record<string, QuestionAnswer> = {};
  for (const [callId, answer] of Object.entries(draft.answers)) answers[callId] = copyAnswer(answer);
  return { answers, generalNotes: draft.generalNotes, active: draft.active === null ? null : { ...draft.active } };
}

/** The durable projection of a draft, stamped for the host's retention ordering. */
export function toStoredDraft(draft: QuestionDraft, updatedAt: string): StoredQuestionDraft {
  return { ...toDraftContent(draft), updatedAt };
}

/** Whether anything was entered in the draft, including Additional Notes. */
export function hasContent(draft: QuestionDraft): boolean {
  if (draft.generalNotes.trim().length > 0) return true;
  return Object.values(draft.answers).some(answer =>
    answer.choices.length > 0 || answer.text.trim().length > 0 || answer.other.trim().length > 0 || answer.notes.trim().length > 0);
}

/** The slide the panel shows: the recorded one while it still exists, else the first received page. */
export function activeSlide(round: QuestionRound, draft: QuestionDraft): QuestionDraftSlide {
  const requested = draft.active;
  if (requested?.kind === 'notes') return { kind: 'notes' };
  if (requested?.kind === 'page' && round.pages.some(page => page.callId === requested.callId)) return { kind: 'page', callId: requested.callId };
  const first = round.pages[0];
  return first === undefined ? { kind: 'notes' } : { kind: 'page', callId: first.callId };
}

/** The answer recorded for one page, or an empty answer when the page was never answered. */
export function draftAnswer(draft: QuestionDraft, callId: string): QuestionAnswer {
  return answerFor(draft.answers, callId) ?? emptyAnswer();
}

function withAnswer(draft: QuestionDraft, callId: string, answer: QuestionAnswer): QuestionDraft {
  return { ...draft, answers: { ...draft.answers, [callId]: answer } };
}

/** Record a choice; equals the form's choice semantics for single and multiple selection. */
export function choose(draft: QuestionDraft, page: QuestionPage, callId: string, value: string, checked: boolean): QuestionDraft {
  const previous = draftAnswer(draft, callId);
  const choices = page.type === 'exclusive'
    ? [value]
    : checked
      ? [...previous.choices.filter(choice => choice !== value), value]
      : previous.choices.filter(choice => choice !== value);
  return withAnswer(draft, callId, { ...previous, choices });
}

/** Replace one free-text field of an answer: the free-text answer, Other text, or that answer's notes. */
export function setAnswerText(draft: QuestionDraft, callId: string, field: 'text' | 'other' | 'notes', value: string): QuestionDraft {
  return withAnswer(draft, callId, { ...draftAnswer(draft, callId), [field]: value });
}

/** Replace the round-wide Additional Notes. */
export function setGeneralNotes(draft: QuestionDraft, value: string): QuestionDraft {
  return { ...draft, generalNotes: value };
}

/** Record the slide the user is viewing. */
export function setActive(draft: QuestionDraft, slide: QuestionDraftSlide): QuestionDraft {
  return { ...draft, active: slide };
}
