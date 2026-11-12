import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { QuestionDraftContent, QuestionDraftSlide, QuestionPage, QuestionRound, StoredQuestionDraft } from '../shared/types.js';
import { OTHER_CHOICE, answerFor, emptyAnswer, formatAnswers, isAnswerValid } from './validation.js';
import { canSubmit, submitState } from './submission.js';
import { activeSlide, draftAnswer, hasContent, restoreDraft } from './draft.js';
import { useQuestionDraft } from './use-question-draft.js';
import { questionCss } from './styles.js';

export interface QuestionFormProps {
  round: QuestionRound;
  hidden?: boolean;
  /** The durably stored draft this round was restored with. */
  storedDraft?: StoredQuestionDraft;
  /** Receives the durable projection after every change worth persisting. */
  onDraftChange?(draft: QuestionDraftContent): void;
  onSubmit(text: string): void | Promise<void>;
  onDismiss?(): void | Promise<void>;
  /** Called after the hidden form releases focus, so the host can return it to the composer. */
  onHide?(): void;
}

type ActiveSlide = QuestionDraftSlide;
type Submission = 'idle' | 'submitting' | 'failed';
/** Transient state of the mounted strip; none of it survives a remount. */
interface Surface {
  roundId: string;
  collapsed: boolean;
  submission: Submission;
  error: string | null;
  confirmingDismiss: boolean;
  dismissing: boolean;
  dismissError: string | null;
}

const WEIGHT_LABELS: Record<NonNullable<QuestionPage['weight']>, string> = {
  critical: 'Hard to change later',
  medium: 'Can change with effort',
  easy: 'Easy to revisit',
};

function newSurface(roundId: string): Surface {
  return { roundId, collapsed: false, submission: 'idle', error: null, confirmingDismiss: false, dismissing: false, dismissError: null };
}
function Markdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml disallowedElements={['img']}>{text}</ReactMarkdown>;
}
function sameSlide(left: ActiveSlide, right: ActiveSlide): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'notes') return true;
  return right.kind === 'page' && left.callId === right.callId;
}
function descriptionFor(page: QuestionPage, title: string): string {
  return page.options?.find(option => option.title === title)?.description ?? '';
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message;
  return String(error);
}
function QuestionGlyph() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5.6 5.4a2.4 2.4 0 1 1 3.2 2.3c-.6.3-.8.7-.8 1.3v.4" /><circle cx="8" cy="12.2" r=".8" fill="currentColor" stroke="none" /></svg>;
}
function Chevron({ up }: { up: boolean }) {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} /></svg>;
}

/** The fixed question strip docked above the composer: pages first, Additional Notes last. */
export function QuestionForm({ round, hidden = false, storedDraft, onDraftChange, onSubmit, onDismiss, onHide }: QuestionFormProps) {
  const prefix = useId();
  const bodyId = prefix + '-body';
  const headingId = prefix + '-heading';
  const [surface, setSurface] = useState<Surface>(() => newSurface(round.id));
  const [focused, setFocused] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLDivElement>(null);
  const keepAnsweringRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const firstSlide = useRef(true);
  const sending = useRef(false);
  const seenPages = useRef<Set<string>>(new Set());
  const onHideRef = useRef(onHide);
  useEffect(() => { onHideRef.current = onHide; }, [onHide]);
  const draft = useQuestionDraft({ round, ...(storedDraft === undefined ? {} : { stored: storedDraft }), ...(onDraftChange === undefined ? {} : { onChange: onDraftChange }) });
  useEffect(() => { setSurface(previous => previous.roundId === round.id ? previous : newSurface(round.id)); }, [round.id]);
  useEffect(() => { seenPages.current = new Set(); sending.current = false; }, [round.id]);
  const current = surface.roundId === round.id ? surface : newSurface(round.id);
  // A round swapped in place must never render the previous round's answers before
  // its reset effect runs; the hook reseeds on the same identity change.
  const value = draft.draft.roundId === round.id ? draft.draft : restoreDraft(round.id, storedDraft);
  const slides: ActiveSlide[] = [...round.pages.map(page => ({ kind: 'page' as const, callId: page.callId })), { kind: 'notes' as const }];
  const active = activeSlide(round, value);
  const index = slides.findIndex(slide => sameSlide(slide, active));
  const entry = active.kind === 'page' ? round.pages.find(page => page.callId === active.callId) : undefined;
  const answer = entry ? draftAnswer(value, entry.callId) : emptyAnswer();
  const disabled = round.answered || current.submission === 'submitting' || current.dismissing;
  const hasDraft = hasContent(value);
  const answersValid = round.pages.length > 0 && round.pages.every(page => isAnswerValid(page.page, answerFor(value.answers, page.callId)));
  const state = submitState({ complete: round.complete, answersValid, busy: current.submission === 'submitting', error: current.error });
  const canSubmitNow = canSubmit(state);
  const canAdvance = entry !== undefined && !disabled && isAnswerValid(entry.page, answer);
  const activeKey = active.kind === 'page' ? active.callId : 'notes';
  const optionFocus = entry ? focused[entry.callId] ?? answer.choices[0] ?? '' : '';
  const otherActive = answer.choices.includes(OTHER_CHOICE) || optionFocus === OTHER_CHOICE;
  const newPage = active.kind === 'notes'
    ? round.pages.filter(page => !seenPages.current.has(page.callId)).sort((left, right) => left.sequence - right.sequence)[0]
    : undefined;
  const awaitingTurn = active.kind === 'notes' && state.kind === 'blocked' && state.reason === 'awaiting-turn';

  useEffect(() => {
    if (!hidden) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) activeElement.blur();
    onHideRef.current?.();
  }, [hidden]);
  useEffect(() => {
    if (active.kind === 'page') seenPages.current.add(active.callId);
  }, [activeKey, round.pages]);
  useEffect(() => {
    // A restored draft resumes after the pages the user already reached, so pages up
    // to the restored slide count as seen and only later arrivals are announced.
    if (value.active === null) return;
    const target = slides.findIndex(slide => sameSlide(slide, value.active!));
    for (const slide of target < 0 ? [] : slides.slice(0, target + 1)) if (slide.kind === 'page') seenPages.current.add(slide.callId);
  }, [round.id]);
  useEffect(() => {
    if (firstSlide.current) { firstSlide.current = false; return; }
    headingRef.current?.focus();
  }, [activeKey]);
  useEffect(() => { if (current.confirmingDismiss) keepAnsweringRef.current?.focus(); }, [current.confirmingDismiss]);
  useEffect(() => {
    if (wasConfirming.current && !current.confirmingDismiss) dismissRef.current?.focus();
    if (current.dismissError) (current.confirmingDismiss ? keepAnsweringRef.current : dismissRef.current)?.focus();
    wasConfirming.current = current.confirmingDismiss;
  }, [current.confirmingDismiss, current.dismissError]);

  function updateSurface(update: (previous: Surface) => Surface) {
    setSurface(previous => update(previous.roundId === round.id ? previous : newSurface(round.id)));
  }
  function changeAnswer(apply: () => void) {
    updateSurface(previous => ({ ...previous, error: null }));
    apply();
  }
  function focusOption(option: string) {
    if (!entry) return;
    setFocused(previous => ({ ...previous, [entry.callId]: option }));
  }
  function choose(value: string, checked: boolean) {
    if (!entry) return;
    focusOption(value);
    changeAnswer(() => draft.choose(entry.page, entry.callId, value, checked));
  }
  function goTo(target: ActiveSlide | undefined) {
    if (!target) return;
    draft.goTo(target);
  }
  function next() { if (canAdvance) goTo(slides[index + 1]); }
  function back() { goTo(slides[index - 1]); }
  function toggle() { updateSurface(previous => ({ ...previous, collapsed: !previous.collapsed })); }
  function requestDismiss() {
    if (!onDismiss || disabled) return;
    if (hasDraft && !current.confirmingDismiss) { updateSurface(previous => ({ ...previous, collapsed: false, confirmingDismiss: true, dismissError: null })); return; }
    void dismiss();
  }
  function cancelDismiss() {
    if (current.dismissing) return;
    updateSurface(previous => ({ ...previous, confirmingDismiss: false, dismissError: null }));
  }
  async function dismiss(): Promise<void> {
    if (!onDismiss || disabled || current.dismissing) return;
    updateSurface(previous => ({ ...previous, dismissing: true, dismissError: null }));
    try {
      await onDismiss();
      setSurface(previous => previous.roundId === round.id ? { ...previous, dismissing: false } : previous);
    } catch (error) {
      setSurface(previous => previous.roundId === round.id ? {
        ...previous, dismissing: false, confirmingDismiss: hasDraft,
        dismissError: errorMessage(error),
      } : previous);
    }
  }
  async function send(): Promise<void> {
    if (active.kind !== 'notes' || !canSubmitNow || sending.current) return;
    sending.current = true;
    updateSurface(previous => ({ ...previous, submission: 'submitting', error: null }));
    try {
      const text = formatAnswers(round, value.answers, value.generalNotes);
      await onSubmit(text);
      // The dock hides this form as soon as the submission is recorded; the feed
      // confirms the answer instead of a local "submitted" status.
    } catch (error) {
      setSurface(previous => previous.roundId === round.id ? { ...previous, submission: 'failed', error: errorMessage(error) } : previous);
    } finally {
      sending.current = false;
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return <>
    <style>{questionCss}</style>
    <form className="kq-strip" aria-label="Questions from the agent" hidden={hidden} aria-hidden={hidden || undefined} onSubmit={submit}>
      <button type="button" className="kq-header" aria-expanded={!current.collapsed} aria-controls={bodyId} onClick={toggle}>
        <span className="kq-icon"><QuestionGlyph /></span>
        <span className="kq-title">Questions from the agent</span>
        <span className="kq-progress" aria-live="polite">{index + 1} / {slides.length}</span>
        <span className="kq-chevron" data-open={!current.collapsed}><Chevron up={!current.collapsed} /></span>
      </button>
      {!current.collapsed && <div className="kq-panel" id={bodyId}>
        <div className="kq-scroll">
          {round.answered && <p className="kq-status" role="status">This round has been answered in the conversation.</p>}
          {entry ? <section className="kq-slide" aria-labelledby={headingId}>
            {entry.page.context && <div className="kq-context"><Markdown text={entry.page.context} /></div>}
            <div className="kq-question-head">
              <div ref={headingRef} id={headingId} role="heading" aria-level={3} tabIndex={-1} className="kq-question"><Markdown text={entry.page.question} /></div>
              {entry.page.weight && <span className={'kq-weight kq-weight-' + entry.page.weight}>{WEIGHT_LABELS[entry.page.weight]}</span>}
            </div>
            {entry.page.model_lean && <p className="kq-lean">I lean toward <strong>{entry.page.model_lean}</strong>{entry.page.model_lean_reason ? ' — ' + entry.page.model_lean_reason : ''}</p>}
            {entry.page.type === 'freetext'
              ? <label className="kq-field">Your answer
                <textarea className="kq-input" aria-label="Your answer" value={answer.text} disabled={disabled} onChange={event => changeAnswer(() => draft.setText(entry.callId, 'text', event.target.value))} />
              </label>
              : <>
                <fieldset className="kq-options" disabled={disabled}>
                  <legend>{entry.page.type === 'exclusive' ? 'Choose one answer' : 'Choose one or more answers'}</legend>
                  {(entry.page.options ?? []).map((option, optionIndex) => {
                    const selected = answer.choices.includes(option.title);
                    return <div key={option.title} className="kq-option" data-focused={optionFocus === option.title} data-selected={selected}
                      onClick={() => { focusOption(option.title); if (entry.page.type === 'exclusive') choose(option.title, true); }}>
                      <input id={prefix + '-option-' + optionIndex} type={entry.page.type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices-' + entry.callId}
                        checked={selected} disabled={disabled} onChange={event => choose(option.title, event.target.checked)} onFocus={() => focusOption(option.title)} />
                      <label htmlFor={prefix + '-option-' + optionIndex} className="kq-option-title">{option.title}</label>
                      {entry.page.model_lean === option.title && <span className="kq-ai">AI suggests</span>}
                    </div>;
                  })}
                  <div className="kq-option" data-focused={optionFocus === OTHER_CHOICE} data-selected={answer.choices.includes(OTHER_CHOICE)}
                    onClick={() => { focusOption(OTHER_CHOICE); if (entry.page.type === 'exclusive') choose(OTHER_CHOICE, true); }}>
                    <input id={prefix + '-other'} type={entry.page.type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices-' + entry.callId}
                      checked={answer.choices.includes(OTHER_CHOICE)} disabled={disabled} onChange={event => choose(OTHER_CHOICE, event.target.checked)} onFocus={() => focusOption(OTHER_CHOICE)} />
                    <label htmlFor={prefix + '-other'} className="kq-option-title">Other (write your own answer)</label>
                  </div>
                </fieldset>
                <div className="kq-desc" data-other={otherActive}>
                  {otherActive
                    ? <textarea className="kq-input" data-fill="true" aria-label="Other answer" value={answer.other} disabled={disabled} onChange={event => changeAnswer(() => draft.setText(entry.callId, 'other', event.target.value))} />
                    : optionFocus
                      ? <div className="kq-desc-body"><Markdown text={descriptionFor(entry.page, optionFocus)} /></div>
                      : <p className="kq-desc-empty">Select an option to see details.</p>}
                </div>
              </>}
            <label className="kq-field">Notes for this answer
              <textarea className="kq-input" aria-label="Notes for this answer" value={answer.notes} disabled={disabled} onChange={event => changeAnswer(() => draft.setText(entry.callId, 'notes', event.target.value))} />
            </label>
            {entry.page.answers_affect_followup && <p className="kq-hint">Your answer here will shape follow-up questions.</p>}
          </section> : <section className="kq-slide" aria-labelledby={headingId}>
            <div ref={headingRef} id={headingId} role="heading" aria-level={3} tabIndex={-1} className="kq-question">Additional Notes</div>
            {round.pages.length === 0 && <p className="kq-hint">Waiting for question pages.</p>}
            <textarea className="kq-input" aria-label="Additional Notes" placeholder="Anything else the agent should know?" value={value.generalNotes} disabled={disabled} onChange={event => changeAnswer(() => draft.setGeneralNotes(event.target.value))} />
            {newPage && <div className="kq-new-page" role="status">
              <span>New question received.</span>
              <button type="button" className="kq-secondary" onClick={() => goTo({ kind: 'page', callId: newPage.callId })}>Answer new question</button>
            </div>}
          </section>}
          {current.error && <p className="kq-error" role="alert">{current.error}</p>}
          {current.dismissError && <p className="kq-error" role="alert">{current.dismissError}</p>}
        </div>
        <footer className="kq-footer">
          {current.confirmingDismiss ? <>
            <p className="kq-confirm-text">Discard this and other unanswered rounds? Your answers and notes will not be submitted.</p>
            <div className="kq-footer-actions">
              <button ref={keepAnsweringRef} type="button" className="kq-secondary" disabled={current.dismissing} onClick={cancelDismiss}>Keep answering</button>
              <button type="button" className="kq-secondary kq-dismiss-confirm" disabled={current.dismissing} onClick={() => void dismiss()}>{current.dismissing ? 'Dismissing…' : 'Dismiss questions'}</button>
            </div>
          </> : <>
            {awaitingTurn && <p className="kq-waiting" role="status">Waiting for the agent to finish this turn before Submit is available.</p>}
            {onDismiss && <button ref={dismissRef} type="button" className="kq-secondary kq-dismiss" disabled={disabled} onClick={requestDismiss}>Dismiss</button>}
            <div className="kq-footer-actions">
              <button type="button" className="kq-secondary" onClick={back} disabled={index === 0 || disabled}>Back</button>
              {active.kind === 'notes'
                ? <button type="button" className="kq-primary" disabled={!canSubmitNow} onClick={event => { if (event.detail > 1) return; void send(); }}>{current.submission === 'submitting' ? 'Submitting…' : 'Submit'}</button>
                : <button type="button" className="kq-primary" onClick={next} disabled={!canAdvance}>Next</button>}
            </div>
          </>}
        </footer>
      </div>}
    </form>
  </>;
}
