import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuestionAttachment, QuestionDraftContent, QuestionDraftSlide, QuestionPage, QuestionRound, StoredQuestionDraft } from '../shared/types.js';
import { activeSlide, addPickedAttachments, choose, removePageAttachment, removeRoundAttachment, restoreDraft, setActive, setAnswerText, setGeneralNotes as setNotes, toDraftContent, type PickedAttachment, type QuestionDraft } from './draft.js';

export interface UseQuestionDraftOptions {
  round: QuestionRound;
  /** The durably stored draft this round was seeded with; read once per mount. */
  stored?: StoredQuestionDraft;
  /** Called with the durable projection after every change that must persist. */
  onChange?: (draft: QuestionDraftContent) => void;
}

/** The durable half of the question form: answers, notes, files, and the active slide. */
export interface QuestionDraftHandle {
  draft: QuestionDraft;
  /** The newest draft, updated synchronously by every change rather than by a render. */
  current(): QuestionDraft;
  active: QuestionDraftSlide;
  choose(page: QuestionPage, callId: string, value: string, checked: boolean): void;
  setText(callId: string, field: 'text' | 'other' | 'notes', value: string): void;
  setGeneralNotes(value: string): void;
  goTo(slide: QuestionDraftSlide): void;
  /**
   * Store one selection's files where the person picked them.
   *
   * @param picked - the accepted files with the slide each belongs to.
   * @param sequence - the pick rank the selection was started with.
   */
  addPicked(picked: readonly PickedAttachment[], sequence: number): void;
  removePageFile(callId: string, attachmentId: string): void;
  removeRoundFile(attachmentId: string): void;
}

/**
 * Owns the question form's durable draft. The form keeps only transient UI state,
 * and every content or slide change is reported so the caller can persist it.
 * A stored draft reseeds only when the round identity changes, so an answered or
 * replaced round never inherits the previous round's answers.
 */
export function useQuestionDraft({ round, stored, onChange }: UseQuestionDraftOptions): QuestionDraftHandle {
  const [draft, setDraft] = useState<QuestionDraft>(() => restoreDraft(round.id, stored));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  /**
   * The pick rank of every attachment this form stored. A restored attachment has none,
   * which places it before every pick of the session.
   */
  const ranks = useRef(new Map<string, number>());
  const notifyRef = useRef(onChange);
  useEffect(() => { notifyRef.current = onChange; }, [onChange]);
  useEffect(() => {
    ranks.current = new Map();
    setDraft(previous => previous.roundId === round.id ? previous : restoreDraft(round.id, storedRef.current));
  }, [round.id]);

  const commit = useCallback((change: (current: QuestionDraft) => QuestionDraft) => {
    const base = draftRef.current.roundId === round.id ? draftRef.current : restoreDraft(round.id, storedRef.current);
    const next = change(base);
    if (next === base) return;
    draftRef.current = next;
    setDraft(next);
    notifyRef.current?.(toDraftContent(next));
  }, [round.id]);

  return {
    draft,
    current: () => draftRef.current,
    active: activeSlide(round, draft),
    // Editing an answer also marks its page as the resume point, so a page inserted
    // before it later never hides the answer the user was just working on.
    choose: (page, callId, value, checked) => commit(current => choose(setActive(current, { kind: 'page', callId }), page, callId, value, checked)),
    setText: (callId, field, value) => commit(current => setAnswerText(setActive(current, { kind: 'page', callId }), callId, field, value)),
    setGeneralNotes: value => commit(current => setNotes(current, value)),
    goTo: slide => commit(current => setActive(current, slide)),
    // A file can arrive after the person moved on, so attaching never claims the page: the
    // store keeps the file on the question it was picked for and in the order it was picked.
    addPicked: (picked, sequence) => commit(current => {
      for (const entry of picked) ranks.current.set(entry.attachment.id, sequence);
      return addPickedAttachments(current, picked, id => ranks.current.get(id) ?? 0, sequence);
    }),
    removePageFile: (callId, attachmentId) => commit(current => removePageAttachment(current, callId, attachmentId)),
    removeRoundFile: attachmentId => commit(current => removeRoundAttachment(current, attachmentId)),
  };
}
