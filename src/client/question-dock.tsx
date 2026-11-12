import React, { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { Problem, QuestionRound } from '../shared/types.js';
import type { QuestionDraftPort } from './question-draft-state.js';
import type { QuestionRoundView } from './question-round-cache.js';
import { selectActiveRound } from '../questions/submission.js';
import { QuestionForm } from '../questions/QuestionForm.js';

/** The status strip the dock shows above its question panel. */
export interface QuestionDockStatus {
  error: Problem | null;
  connected: boolean;
}
export interface QuestionDockBridge {
  readonly status: HostObservable<QuestionDockStatus>;
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
/** Everything the extracted dock needs; no module-level plugin singleton leaks in. */
export interface QuestionDockServices {
  view: HostObservable<QuestionRoundView>;
  status?: ReactNode;
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
  focusComposer(sessionId: string): void;
}
export interface QuestionDockProps { sessionId: string; services: QuestionDockServices }

/**
 * Build the dock's services from the bridge and the native session registry. The
 * plugin composition root keeps owning native scope lookup; the dock module only
 * knows this contract, which is what makes it renderable under a test harness.
 */
export function createQuestionDockServices(input: {
  bridge: QuestionDockBridge;
  sessions: QuestionDockSessions;
  status?: ReactNode;
}): QuestionDockServices {
  const { bridge, sessions } = input;
  const conversationFor = (sessionId: string): QuestionDockConversation | undefined => sessions.scope(sessionId)?.get('conversation');
  return {
    view: bridge.questionsView,
    ...(input.status === undefined ? {} : { status: input.status }),
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
    focusComposer: sessionId => {
      const scoped = sessions.scope(sessionId);
      const conversation = scoped?.get('conversation');
      if (scoped === undefined || conversation === undefined) return;
      try { conversation.input.for(scoped).focus(); } catch { /* the form already blurred its active control */ }
    },
  };
}

/** The question strip docked above one conversation's composer. */
export function QuestionDock({ sessionId, services }: QuestionDockProps) {
  const view = useSyncExternalStore(services.view.subscribe, services.view.getSnapshot, services.view.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => services.track(sessionId), [services, sessionId]);
  useEffect(() => { if (attempt > 0) services.retry(sessionId); }, [attempt, services, sessionId]);
  // A closing drawer must not lose the last debounce window; the bridge also flushes on pagehide.
  useEffect(() => () => services.drafts.flush(), [services]);
  const historyError = view.errors.get(sessionId)?.message;
  const round = selectActiveRound(view.rounds, sessionId, id => services.isSubmitted(id), services.focusedRoundId());
  const storedDraft = round === undefined ? undefined : services.drafts.read(round.id);
  return <>{services.status}{historyError && <div role="alert">Question rounds are unavailable: {historyError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry questions</button></div>}{round && <QuestionForm key={round.id} round={round} {...(storedDraft === undefined ? {} : { storedDraft })} hidden={services.isSubmitted(round.id)} onHide={() => services.focusComposer(sessionId)} onDraftChange={draft => services.drafts.update(sessionId, round.id, draft)} onSubmit={async text => {
    // This is ordinary native human text. It does not settle native approvals or userQuestions.
    services.assertSubmissionAllowed(sessionId);
    // The dock hides the round before admission settles; a failure restores it with the draft.
    services.submit(round.id);
    try { await services.send(sessionId, text); services.settle(round.id); services.drafts.clear(sessionId, round.id); }
    catch (error) { services.rollback(round.id); throw error; }
  }} onDismiss={async () => {
    await services.dismiss(sessionId, round.id);
  }} />}</>;
}
