import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { QuestionRound } from '../shared/types.js';
import type { QuestionDraftPort } from './question-draft-state.js';
import type { QuestionRoundView } from './question-round-cache.js';
import { selectActiveRound } from '../questions/submission.js';
import { QuestionForm, type QuestionAttachmentPort } from '../questions/QuestionForm.js';
import type { ClientApi } from '../shared/types.js';

/**
 * The question-only facts the dock reads. A board-update status never belongs here: the
 * dock is a question surface in every native conversation, including ordinary chats.
 */
export interface QuestionDockBridge {
  readonly questionsView: HostObservable<QuestionRoundView>;
  readonly questionDrafts: QuestionDraftPort;
  readonly questions: {
    isSubmitted(roundId: string): boolean;
    readonly focusedRoundId: string | undefined;
    submit(roundId: string): void;
    settle(roundId: string): void;
    rollback(roundId: string): void;
  };
  retry(): void;
  trackQuestions(sessionId: string): () => void;
  retryQuestions(sessionId: string): void;
  assertSubmissionAllowed(sessionId: string): void;
  dismissQuestions(sessionId: string, roundId: string): Promise<readonly QuestionRound[]>;
}
/** The native conversation operations the dock needs from the composition root. */
export interface QuestionDockConversation {
  send(text: string): Promise<void>;
  input: { for(scope: unknown): { focus(): void } };
}
export interface QuestionDockSessionScope {
  get(name: 'conversation'): QuestionDockConversation | undefined;
}
export interface QuestionDockSessions {
  scope(sessionId: string): QuestionDockSessionScope | undefined;
}
/**
 * How one conversation receives an answer that carries files. The composition root
 * binds it to the native upload service and the session prompt; the dock never
 * learns how either works.
 */
export interface QuestionFileDelivery {
  /** Upload one file for the conversation and return the receipt a prompt cites. */
  upload(sessionId: string, file: { name: string; data: string }): Promise<string>;
  /** Send one text reply citing the uploaded receipts, as one prompt. */
  submit(sessionId: string, text: string, receipts: readonly string[]): Promise<void>;
}

/** Everything the extracted dock needs; no module-level plugin singleton leaks in. */
export interface QuestionDockServices {
  view: HostObservable<QuestionRoundView>;
  track(sessionId: string): () => void;
  retry(sessionId: string): void;
  isSubmitted(roundId: string): boolean;
  focusedRoundId(): string | undefined;
  submit(roundId: string): void;
  settle(roundId: string): void;
  rollback(roundId: string): void;
  assertSubmissionAllowed(sessionId: string): void;
  dismiss(sessionId: string, roundId: string): Promise<readonly QuestionRound[]>;
  drafts: QuestionDraftPort;
  send(sessionId: string, text: string): Promise<void>;
  /** The draft answer-file port for one conversation, or undefined when unsupported. */
  files(sessionId: string, api: ClientApi): QuestionAttachmentPort | undefined;
  /** Delete one stored draft copy once its answer was delivered. */
  discardFile(sessionId: string, id: string, api: ClientApi | undefined): Promise<void>;
  /** Submit one answer with its attached files, or throw and leave the draft intact. */
  submitWithFiles(sessionId: string, text: string, files: readonly { name: string; data: string }[]): Promise<void>;
  focusComposer(sessionId: string): void;
}
export interface QuestionDockProps { sessionId: string; services: QuestionDockServices; api?: ClientApi }

/**
 * Build the dock's services from the bridge and the native session registry. The
 * plugin composition root keeps owning native scope lookup; the dock module only
 * knows this contract, which is what makes it renderable under a test harness.
 */
export function createQuestionDockServices(input: {
  bridge: QuestionDockBridge;
  sessions: QuestionDockSessions;
  /** Native file delivery for an answer; absent means answers carry text only. */
  fileDelivery?: QuestionFileDelivery;
}): QuestionDockServices {
  const { bridge, sessions, fileDelivery } = input;
  const conversationFor = (sessionId: string): QuestionDockConversation | undefined => sessions.scope(sessionId)?.get('conversation');
  return {
    view: bridge.questionsView,
    track: sessionId => bridge.trackQuestions(sessionId),
    retry: sessionId => bridge.retryQuestions(sessionId),
    isSubmitted: roundId => bridge.questions.isSubmitted(roundId),
    focusedRoundId: () => bridge.questions.focusedRoundId,
    submit: roundId => bridge.questions.submit(roundId),
    settle: roundId => bridge.questions.settle(roundId),
    rollback: roundId => bridge.questions.rollback(roundId),
    assertSubmissionAllowed: sessionId => bridge.assertSubmissionAllowed(sessionId),
    dismiss: (sessionId, roundId) => bridge.dismissQuestions(sessionId, roundId),
    drafts: bridge.questionDrafts,
    send: async (sessionId, text) => {
      const conversation = conversationFor(sessionId);
      if (conversation === undefined) throw new Error('The native conversation scope is not available. Reopen this conversation and retry.');
      await conversation.send(text);
    },
    // Answer files are stored as draft copies so a reload can deliver them; the
    // submission then uploads each one for a fresh receipt, which is what a prompt
    // requires, and sends the whole answer as one prompt.
    files: (sessionId, api) => ({
      save: async file => {
        if (api.saveQuestionAttachment === undefined) throw new Error('Answer files are unavailable in this host.');
        return api.saveQuestionAttachment({ sessionId, name: file.name, data: file.data });
      },
      load: async attachment => {
        if (api.readQuestionAttachment === undefined) throw new Error('Answer files are unavailable in this host.');
        // Only the identity travels: the host knows the name and the length, so a
        // tampered reference cannot relabel the file it returns.
        const read = await api.readQuestionAttachment({ sessionId, id: attachment.id });
        return read.data;
      },
      discard: async attachment => {
        // Detaching a file leaves no orphan draft copy behind; a host without the
        // method simply keeps the copy, which the draft retention sweep reclaims.
        await api.removeQuestionAttachment?.({ sessionId, id: attachment.id });
      },
    }),
    submitWithFiles: async (sessionId, text, files) => {
      const conversation = conversationFor(sessionId);
      if (conversation === undefined) throw new Error('The native conversation scope is not available. Reopen this conversation and retry.');
      if (files.length === 0) { await conversation.send(text); return; }
      if (fileDelivery === undefined) {
        throw new Error('This host cannot attach files to an answer yet. Remove the files and submit again.');
      }
      const receipts: string[] = [];
      for (const file of files) receipts.push(await fileDelivery.upload(sessionId, { name: file.name, data: file.data }));
      await fileDelivery.submit(sessionId, text, receipts);
    },
    /** Delete one stored draft copy after its answer was delivered. */
    discardFile: async (sessionId: string, id: string, api: ClientApi | undefined) => {
      await api?.removeQuestionAttachment?.({ sessionId, id });
    },
    focusComposer: sessionId => {
      const scoped = sessions.scope(sessionId);
      const conversation = scoped?.get('conversation');
      if (scoped === undefined || conversation === undefined) return;
      try { conversation.input.for(scoped).focus(); } catch { /* the form already blurred its active control */ }
    },
  };
}

/** The question strip docked above one conversation's composer. */
export function QuestionDock({ sessionId, services, api }: QuestionDockProps) {
  const view = useSyncExternalStore(services.view.subscribe, services.view.getSnapshot, services.view.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => services.track(sessionId), [services, sessionId]);
  useEffect(() => { if (attempt > 0) services.retry(sessionId); }, [attempt, services, sessionId]);
  // A closing drawer must not lose the last debounce window; the bridge also flushes on pagehide.
  useEffect(() => () => services.drafts.flush(), [services]);
  const historyError = view.errors.get(sessionId)?.message;
  const round = selectActiveRound(view.rounds, sessionId, id => services.isSubmitted(id), services.focusedRoundId());
  const storedDraft = round === undefined ? undefined : services.drafts.read(round.id);
  const files = api === undefined ? undefined : services.files(sessionId, api);
  return <>{historyError && <div role="alert">Question rounds are unavailable: {historyError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry questions</button></div>}{round && <QuestionForm key={round.id} round={round} {...(storedDraft === undefined ? {} : { storedDraft })} {...(files === undefined ? {} : { files })} hidden={services.isSubmitted(round.id)} onHide={() => services.focusComposer(sessionId)} onDraftChange={draft => services.drafts.update(sessionId, round.id, draft)} onSubmit={async (text, attached) => {
    // This is ordinary native human text. It does not settle native approvals or userQuestions.
    services.assertSubmissionAllowed(sessionId);
    // The dock hides the round before admission settles; a failure restores it with the draft.
    services.submit(round.id);
    try {
      await services.submitWithFiles(sessionId, text, attached);
      services.settle(round.id);
      services.drafts.clear(sessionId, round.id);
      // The answer keeps its own copy inside the conversation, so the draft copies are
      // deleted now; otherwise a submission that beats the debounced draft write would
      // leave bytes no record ever names.
      //
      // The reply is already admitted, so cleanup is best effort: a copy the host already
      // reclaimed, or a cleanup call that fails, must never roll back a delivered answer or
      // abandon the remaining copies.
      for (const file of attached) {
        await services.discardFile(sessionId, file.id, api).catch(() => undefined);
      }
    }
    catch (error) { services.rollback(round.id); throw error; }
  }} onDismiss={async draft => {
    // The form reports the files the draft actually holds, after any pick settled, so a
    // draft still inside its debounce window cannot leave bytes behind.
    await services.dismiss(sessionId, round.id);
    for (const file of draft) await services.discardFile(sessionId, file.id, api).catch(() => undefined);
  }} />}</>;
}
