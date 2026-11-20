import type { QuestionAnswer, QuestionAttachment, QuestionDraftContent, QuestionDraftSlide, QuestionPage, QuestionRound, StoredQuestionDraft } from '../shared/types.js';
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
  /** Files attached to each page, keyed by the page callId. */
  pageAttachments: Record<string, QuestionAttachment[]>;
  /** Files attached to the round as a whole. */
  roundAttachments: QuestionAttachment[];
  /** Attachment ids in the order they were attached, across every slide. */
  attachmentOrder: string[];
  active: QuestionDraftSlide | null;
}

/** A draft with nothing entered, positioned on the round's first slide. */
export function emptyDraft(roundId: string): QuestionDraft {
  return { roundId, answers: Object.create(null) as Record<string, QuestionAnswer>, generalNotes: '', pageAttachments: Object.create(null) as Record<string, QuestionAttachment[]>, roundAttachments: [], attachmentOrder: [], active: null };
}

function copyAnswer(answer: QuestionAnswer): QuestionAnswer {
  return { choices: [...answer.choices], text: answer.text, other: answer.other, notes: answer.notes };
}

/** One attachment as the durable projection keeps it; the array copy is detached. */
function copyAttachment(attachment: QuestionAttachment): QuestionAttachment {
  return { id: attachment.id, name: attachment.name, bytes: attachment.bytes };
}

/**
 * The attachment order a stored projection implies. A record written before the order
 * was stored has none, so its attachments keep the order the projection lists them:
 * page files in page order, then round files.
 */
function orderedIds(stored: QuestionDraftContent): string[] {
  if (stored.attachmentOrder !== undefined) return [...stored.attachmentOrder];
  return [
    ...Object.values(stored.pageAttachments ?? {}).flatMap(attachments => attachments.map(attachment => attachment.id)),
    ...(stored.roundAttachments ?? []).map(attachment => attachment.id),
  ];
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
  const pageAttachments: Record<string, QuestionAttachment[]> = Object.create(null) as Record<string, QuestionAttachment[]>;
  for (const [callId, attachments] of Object.entries(stored.pageAttachments ?? {})) pageAttachments[callId] = attachments.map(copyAttachment);
  return {
    roundId,
    answers,
    generalNotes: stored.generalNotes,
    pageAttachments,
    roundAttachments: (stored.roundAttachments ?? []).map(copyAttachment),
    attachmentOrder: orderedIds(stored),
    active: stored.active === null ? null : { ...stored.active },
  };
}

/** The durable content of a draft; the host stamps its own retention time. */
export function toDraftContent(draft: QuestionDraft): QuestionDraftContent {
  const answers: Record<string, QuestionAnswer> = {};
  for (const [callId, answer] of Object.entries(draft.answers)) answers[callId] = copyAnswer(answer);
  const pageAttachments: Record<string, QuestionAttachment[]> = {};
  for (const [callId, attachments] of Object.entries(draft.pageAttachments)) {
    if (attachments.length > 0) pageAttachments[callId] = attachments.map(copyAttachment);
  }
  return {
    answers,
    generalNotes: draft.generalNotes,
    ...(Object.keys(pageAttachments).length === 0 ? {} : { pageAttachments }),
    ...(draft.roundAttachments.length === 0 ? {} : { roundAttachments: draft.roundAttachments.map(copyAttachment) }),
    ...(draft.attachmentOrder.length === 0 ? {} : { attachmentOrder: [...draft.attachmentOrder] }),
    active: draft.active === null ? null : { ...draft.active },
  };
}

/** The durable projection of a draft, stamped for the host's retention ordering. */
export function toStoredDraft(draft: QuestionDraft, updatedAt: string): StoredQuestionDraft {
  return { ...toDraftContent(draft), updatedAt };
}

/** Whether anything was entered in the draft, including Additional Notes and files. */
export function hasContent(draft: QuestionDraft): boolean {
  if (draft.generalNotes.trim().length > 0) return true;
  if (draft.roundAttachments.length > 0) return true;
  if (Object.values(draft.pageAttachments).some(attachments => attachments.length > 0)) return true;
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

/** The files attached to one page, which is empty when the page has none. */
export function pageAttachments(draft: QuestionDraft, callId: string): readonly QuestionAttachment[] {
  return draft.pageAttachments[callId] ?? [];
}

/**
 * Every attachment of the draft in the order the person attached it, across pages
 * and the round. The reply names each file in its owning block, but the files
 * themselves travel in this order so a delivered answer matches how it was written.
 *
 * @param draft - the draft whose attachments are collected.
 * @returns the attachments, ordered as they were attached.
 */
export function orderedAttachments(draft: QuestionDraft): QuestionAttachment[] {
  const byId = new Map<string, QuestionAttachment>();
  for (const attachments of Object.values(draft.pageAttachments)) {
    for (const attachment of attachments) byId.set(attachment.id, attachment);
  }
  for (const attachment of draft.roundAttachments) byId.set(attachment.id, attachment);
  const ordered: QuestionAttachment[] = [];
  for (const id of draft.attachmentOrder) {
    const attachment = byId.get(id);
    if (attachment === undefined) continue;
    byId.delete(id);
    ordered.push(attachment);
  }
  // A record restored without an order keeps its remaining files in collection order.
  for (const attachment of byId.values()) ordered.push(attachment);
  return ordered;
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

/** Attach one file to a page; a page that arrives later still accepts files. */
export function addPageAttachment(draft: QuestionDraft, callId: string, attachment: QuestionAttachment): QuestionDraft {
  const current = draft.pageAttachments[callId] ?? [];
  // The order records when each file was attached, which page order does not preserve.
  const attachmentOrder = [...draft.attachmentOrder, attachment.id];
  return { ...draft, attachmentOrder, pageAttachments: { ...draft.pageAttachments, [callId]: [...current, copyAttachment(attachment)] } };
}

/** Detach one file from a page, leaving the page's answer untouched. */
export function removePageAttachment(draft: QuestionDraft, callId: string, attachmentId: string): QuestionDraft {
  const current = draft.pageAttachments[callId] ?? [];
  const remaining = current.filter(attachment => attachment.id !== attachmentId);
  const pageAttachments = { ...draft.pageAttachments };
  if (remaining.length === 0) delete pageAttachments[callId];
  else pageAttachments[callId] = remaining;
  return { ...draft, pageAttachments, attachmentOrder: draft.attachmentOrder.filter(id => id !== attachmentId) };
}

/** Attach one file to the round as a whole. */
export function addRoundAttachment(draft: QuestionDraft, attachment: QuestionAttachment): QuestionDraft {
  return { ...draft, attachmentOrder: [...draft.attachmentOrder, attachment.id], roundAttachments: [...draft.roundAttachments, copyAttachment(attachment)] };
}

/** Detach one file from the round as a whole. */
export function removeRoundAttachment(draft: QuestionDraft, attachmentId: string): QuestionDraft {
  return { ...draft, attachmentOrder: draft.attachmentOrder.filter(id => id !== attachmentId), roundAttachments: draft.roundAttachments.filter(attachment => attachment.id !== attachmentId) };
}
