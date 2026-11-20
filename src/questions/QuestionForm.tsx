import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { QuestionAttachment, QuestionDraftContent, QuestionDraftSlide, QuestionPage, QuestionRound, StoredQuestionDraft } from '../shared/types.js';
import { OTHER_CHOICE, answerFor, emptyAnswer, formatAnswers, isAnswerValid } from './validation.js';
import { ChoiceOptions, Markdown } from './choice-slide.js';
import { canSubmit, submitState } from './submission.js';
import { activeSlide, draftAnswer, hasContent, orderedAttachments, pageAttachments, restoreDraft } from './draft.js';
import { QuestionFiles, clipboardFiles } from './QuestionFiles.js';
import { useQuestionDraft } from './use-question-draft.js';
import { questionCss } from './styles.js';

/** One attached file as the form hands it to the submission. */
export interface QuestionAttachmentDraft {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly data: string;
}

/**
 * Where the form's answer files live while the round is unresolved. The port stores
 * a draft copy so the bytes survive a reload, and reads them back at submission.
 * Absent means the round accepts no files.
 */
export interface QuestionAttachmentPort {
  /** Store one picked file's exact bytes as a draft copy of this conversation. */
  save(file: { name: string; bytes: number; data: string }): Promise<QuestionAttachment>;
  /** Read one draft copy's exact bytes, base64-encoded. */
  load(attachment: QuestionAttachment): Promise<string>;
  /** Delete one draft copy whose attachment the person detached. */
  discard?(attachment: QuestionAttachment): Promise<void>;
}

/** Read one browser file as canonical base64. */
function readFileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const separator = url.indexOf(',');
      if (separator < 0) { reject(new Error('The selected file could not be read.')); return; }
      resolve(url.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export interface QuestionFormProps {
  round: QuestionRound;
  hidden?: boolean;
  /** The durably stored draft this round was restored with. */
  storedDraft?: StoredQuestionDraft;
  /** Receives the durable projection after every change worth persisting. */
  onDraftChange?(draft: QuestionDraftContent): void;
  /**
   * Submit the round's reply. `files` are the draft's answer files in the order they
   * were attached; the text already names each one in its block.
   */
  onSubmit(text: string, files: readonly QuestionAttachmentDraft[]): void | Promise<void>;
  /** Dismiss, passing the files the draft holds after any in-flight pick settled. */
  onDismiss?(attachments: readonly QuestionAttachment[]): void | Promise<void>;
  /** Called after the hidden form releases focus, so the host can return it to the composer. */
  onHide?(): void;
  /** Where answer files are stored while the round is unresolved; absent disables them. */
  files?: QuestionAttachmentPort;
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
function sameSlide(left: ActiveSlide, right: ActiveSlide): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'notes') return true;
  return right.kind === 'page' && left.callId === right.callId;
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
export function QuestionForm({ round, hidden = false, storedDraft, onDraftChange, onSubmit, onDismiss, onHide, files }: QuestionFormProps) {
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
  // Reads in flight. A file picked a moment before Submit must not be omitted from
  // the reply, so submission waits until none remain and reports a failed read.
  const pendingReads = useRef(0);
  /** Selections that failed; a later pick clears only its own entry. */
  const failures = useRef<Array<{ selection: number; failure: unknown; retry: () => void }>>([]);
  /** One identity per pick, so a retry clears exactly the selection it retries. */
  const selectionIds = useRef(0);
  /** Serializes attachment batches so selection order survives async completion. */
  const attachmentQueue = useRef<Promise<void>>(Promise.resolve());
  const onHideRef = useRef(onHide);
  useEffect(() => { onHideRef.current = onHide; }, [onHide]);
  const draft = useQuestionDraft({ round, ...(storedDraft === undefined ? {} : { stored: storedDraft }), ...(onDraftChange === undefined ? {} : { onChange: onDraftChange }) });
  useEffect(() => { setSurface(previous => previous.roundId === round.id ? previous : newSurface(round.id)); }, [round.id]);
  useEffect(() => { seenPages.current = new Set(); sending.current = false; }, [round.id]);
  const current = surface.roundId === round.id ? surface : newSurface(round.id);
  // A round swapped in place must never render the previous round's answers before
  // its reset effect runs; the hook reseeds on the same identity change.
  const value = draft.draft.roundId === round.id ? draft.draft : restoreDraft(round.id, storedDraft);
  // A closure created before a state update would read the previous draft, so the
  // latest value is published here for helpers that run after the commit.
  const latestDraft = useRef(value);
  /** The draft as the hook last produced it, updated synchronously by every mutator. */
  const committedDraft = useRef(value);
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
    // A pick may still be storing bytes; waiting keeps a dismissal from orphaning them.
    updateSurface(previous => ({ ...previous, dismissing: true, dismissError: null }));
    try {
      await attachmentQueue.current;
      await onDismiss(draftFiles());
      setSurface(previous => previous.roundId === round.id ? { ...previous, dismissing: false } : previous);
    } catch (error) {
      setSurface(previous => previous.roundId === round.id ? {
        ...previous, dismissing: false, confirmingDismiss: hasDraft,
        dismissError: errorMessage(error),
      } : previous);
    }
  }

  /**
   * Store picked files for one slide. The read is counted while it runs, so a Submit
   * pressed in the same breath waits for it instead of sending an answer without it.
   *
   * A batch is all-or-nothing: every file is stored first and only then added to the
   * draft, so a failure partway leaves nothing behind and a retry cannot duplicate a
   * prefix. A failure is recorded against its own selection, so an unrelated successful
   * pick cannot release the gate and let an incomplete answer through.
   */

  async function attach(target: ActiveSlide, picked: readonly File[], retrying?: number): Promise<void> {
    if (files === undefined || picked.length === 0) return;
    // A retry keeps the identity of the selection it retries, so its own failure is the
    // one cleared and no duplicate selection is invented.
    const selection = retrying ?? ++selectionIds.current;
    pendingReads.current += picked.length;
    // Batches run one after another, so a later fast pick cannot overtake an earlier one.
    const run = async (): Promise<void> => {
      const saved: QuestionAttachment[] = [];
      try {
        for (const file of picked) saved.push(await files.save({ name: file.name, bytes: file.size, data: await readFileData(file) }));
      } catch (failure) {
        // The batch is all-or-nothing, so the objects it already stored are discarded
        // here: otherwise a retry would duplicate them and leave the prefix orphaned.
        for (const attachment of saved) await files.discard?.(attachment)?.catch(() => undefined);
        failures.current = [...failures.current.filter(entry => entry.selection !== selection), { selection, failure, retry: () => { failures.current = failures.current.filter(entry => entry.selection !== selection); void attach(target, picked, selection); } }];
        updateSurface(previous => ({ ...previous, error: errorMessage(failure) }));
        pendingReads.current -= picked.length;
        return;
      }
      for (const attachment of saved) {
        if (target.kind === 'page') draft.addPageFile(target.callId, attachment);
        else draft.addRoundFile(attachment);
      }
      // This selection succeeded, so its own failure clears. Other selections keep theirs,
      // because only the person retrying them may release the gate.
      failures.current = failures.current.filter(entry => entry.selection !== selection);
      if (failures.current.length === 0) updateSurface(previous => ({ ...previous, error: null }));
      pendingReads.current -= picked.length;
    };
    attachmentQueue.current = attachmentQueue.current.then(run, run);
    await attachmentQueue.current;
  }

  /**
   * Wait for every in-flight file read, then report the one that failed. Without this
   * a fast Submit would race the read and send the answer without its evidence.
   */
  async function settleFileReads(): Promise<void> {
    // The counter drops the moment a save resolves, but the attachment reaches the
    // draft through a state update that React commits a tick later. Waiting for the
    // counter alone would let the reply go out before the file is in the draft.
    while (pendingReads.current > 0) await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    if (failures.current.length > 0) {
      // Any outstanding selection blocks the submission until it is retried or removed.
      throw failures.current[0]!.failure;
    }
  }
  /**
   * Drop the recorded failure of one selection the person retried. Exposed so a retry
   * path can release the gate without inventing a new selection identity.
   */
  function clearFailure(selection: number): void {
    failures.current = failures.current.filter(entry => entry.selection !== selection);
    if (failures.current.length === 0) updateSurface(previous => ({ ...previous, error: null }));
  }
  /** Retry every failed selection with the files it already carried. */
  function retryFailed(): void {
    // Each closure claims its selection before saving, so repeated clicks in the same
    // breath cannot save one selection twice.
    for (const entry of [...failures.current]) entry.retry();
  }
  /** Drop every failed selection; the answer then proceeds without those files. */
  function discardFailed(): void {
    failures.current = [];
    updateSurface(previous => ({ ...previous, error: null }));
  }
  /** How many selections currently block submission. */
  const failedCount = failures.current.filter(entry => pendingReads.current === 0).length;
  /** Every attached file, in the order the person attached them. */
  /**
   * Detach one file and delete its stored draft copy. The draft copy is otherwise
   * unreachable, so leaving it would accumulate bytes the person discarded.
   */
  function detach(attachment: QuestionAttachment, remove: () => void): void {
    changeAnswer(remove);
    void files?.discard?.(attachment)?.catch(() => undefined);
  }

  function draftFiles(): QuestionAttachment[] {
    return orderedAttachments(draft.current());
  }
  /** Read every attached file so the submission can deliver its exact bytes. */
  async function collectedFiles(): Promise<QuestionAttachmentDraft[]> {
    if (files === undefined) return [];
    const collected: QuestionAttachmentDraft[] = [];
    for (const attachment of draftFiles()) {
      collected.push({ id: attachment.id, name: attachment.name, bytes: attachment.bytes, data: await files.load(attachment) });
    }
    return collected;
  }
  async function send(): Promise<void> {
    if (active.kind !== 'notes' || !canSubmitNow || sending.current) return;
    sending.current = true;
    updateSurface(previous => ({ ...previous, submission: 'submitting', error: null }));
    try {
      // A file selected moments ago may still be reading; waiting keeps the reply
      // from omitting evidence the person already attached. A round with no files stays
      // synchronous, which the double-click guard depends on.
      if (pendingReads.current > 0 || failures.current.length > 0) await settleFileReads();
      const pageFiles: Record<string, readonly { name: string }[]> = {};
      for (const page of round.pages) {
        const attached = pageAttachments(draft.current(), page.callId);
        if (attached.length > 0) pageFiles[page.callId] = attached.map(attachment => ({ name: attachment.name }));
      }
      const text = formatAnswers(round, draft.current().answers, draft.current().generalNotes, pageFiles, draft.current().roundAttachments.map(attachment => ({ name: attachment.name })));
      // A round with files reads them before sending, so a vanished object fails the
      // submission whole and the draft survives for a retry. A text-only answer keeps
      // the synchronous call the double-click guard relies on.
      const attached = draftFiles().length === 0 ? [] : await collectedFiles();
      await onSubmit(text, attached);
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
          {entry ? <section className="kq-slide" aria-labelledby={headingId} onPaste={event => {
            // Paste belongs to the slide, not only the file control: a file pasted
            // while the answer or notes field has focus still attaches here.
            const picked = clipboardFiles(event.clipboardData);
            if (picked.length === 0) return;
            event.preventDefault();
            void attach({ kind: 'page', callId: entry.callId }, picked);
          }}>
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
              : <ChoiceOptions
                  prefix={prefix}
                  callId={entry.callId}
                  type={entry.page.type}
                  options={(entry.page.options ?? []).map(option => ({ title: option.title, description: option.description }))}
                  selected={answer.choices}
                  disabled={disabled}
                  focus={optionFocus}
                  lean={entry.page.model_lean}
                  other={{ text: answer.other, active: otherActive }}
                  onFocus={focusOption}
                  onSelect={choose}
                  onOtherText={value => changeAnswer(() => draft.setText(entry.callId, 'other', value))}
                />}
            <label className="kq-field">Notes for this answer
              <textarea className="kq-input" aria-label="Notes for this answer" value={answer.notes} disabled={disabled} onChange={event => changeAnswer(() => draft.setText(entry.callId, 'notes', event.target.value))} />
            </label>
            {files !== undefined && <QuestionFiles
              attachments={pageAttachments(value, entry.callId)}
              disabled={disabled}
              label={'Files for this question'}
              failures={failedCount}
              onRetryFailed={retryFailed}
              onDiscardFailed={discardFailed}
              onPick={picked => { void attach({ kind: 'page', callId: entry.callId }, picked); }}
              onRemove={attachmentId => {
                const attached = pageAttachments(value, entry.callId).find(item => item.id === attachmentId);
                if (attached !== undefined) detach(attached, () => draft.removePageFile(entry.callId, attachmentId));
              }}
            />}
            {entry.page.answers_affect_followup && <p className="kq-hint">Your answer here will shape follow-up questions.</p>}
          </section> : <section className="kq-slide" aria-labelledby={headingId} onPaste={event => {
            const picked = clipboardFiles(event.clipboardData);
            if (picked.length === 0) return;
            event.preventDefault();
            void attach({ kind: 'notes' }, picked);
          }}>
            <div ref={headingRef} id={headingId} role="heading" aria-level={3} tabIndex={-1} className="kq-question">Additional Notes</div>
            {round.pages.length === 0 && <p className="kq-hint">Waiting for question pages.</p>}
            <textarea className="kq-input" aria-label="Additional Notes" placeholder="Anything else the agent should know?" value={value.generalNotes} disabled={disabled} onChange={event => changeAnswer(() => draft.setGeneralNotes(event.target.value))} />
            {files !== undefined && <QuestionFiles
              attachments={value.roundAttachments}
              disabled={disabled}
              label={'Files for the whole round'}
              failures={failedCount}
              onRetryFailed={retryFailed}
              onDiscardFailed={discardFailed}
              onPick={picked => { void attach({ kind: 'notes' }, picked); }}
              onRemove={attachmentId => {
                const attached = value.roundAttachments.find(item => item.id === attachmentId);
                if (attached !== undefined) detach(attached, () => draft.removeRoundFile(attachmentId));
              }}
            />}
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
