import React from 'react';
import type { ConversationModelOutcome, ConversationPresetOutcome, ModelSelection, Problem } from '../shared/types.js';
import { ErrorNotice } from './ui.js';

export interface ConversationNotice {
  key: string;
  problem: Problem | null;
}

/** One presentation point for the Conversations section notices. */
export function ConversationNotices({ notices }: { notices: readonly ConversationNotice[] }) {
  return <>{notices.map(({ key, problem }) => problem ? <ErrorNotice key={key} problem={problem} /> : null)}</>;
}

/** One catalog route as the notice names it. */
function modelName(selection: ModelSelection): string {
  return selection.provider + ' · ' + selection.model;
}

/**
 * Tell the person opening one conversation that it did not start on the model its
 * board names. This is a hint, never a blocker: the conversation stays usable and
 * its instruction can still be sent while the notice is visible, and the dismissal
 * belongs to the board mount alone.
 */
export function ConversationModelNotice({ outcome, onDismiss }: { outcome: ConversationModelOutcome; onDismiss: () => void }) {
  const requested = modelName(outcome.requested);
  const inUse = outcome.inUse === undefined ? 'the host default model' : modelName(outcome.inUse);
  // Each reason gets its own first sentence, because each is a different fact: a route
  // this host does not offer, a host that cannot scope a model to one conversation,
  // and a host that could not be asked at all are not the same thing to act on. The
  // route the board wanted is named once, here, so the second sentence stays short.
  const cause = outcome.reason === 'unsupported'
    ? `This host cannot apply ${requested} to one conversation without changing the installation default.`
    : outcome.reason === 'failed'
      ? `The host could not be asked to apply ${requested} to this conversation.`
      : `This host does not offer ${requested}.`;
  // Past tense on purpose: this says how the conversation *started*. The person may
  // since have chosen another model here, and this notice does not follow that.
  return <div className="kb-model-notice" role="status">
    <strong>Board model unavailable</strong>
    <div className="kb-model-notice-body">
      <p>{cause} This conversation started on {inUse}.</p>
      <button type="button" className="kb-button" onClick={onDismiss}>Dismiss</button>
    </div>
  </div>;
}

/**
 * Tell the person opening one conversation that it did not start on the agent
 * preset its board names. Like the model notice, this is a hint and never a
 * blocker, and its dismissal belongs to the open drawer alone.
 */
export function ConversationPresetNotice({ outcome, onDismiss }: { outcome: ConversationPresetOutcome; onDismiss: () => void }) {
  const requested = outcome.requested;
  // Each cause is a different fact: a preset this host does not offer, a host
  // that cannot scope a preset to one conversation, and a host that could not be
  // asked at all.
  const cause = outcome.reason === 'unsupported'
    ? 'This host cannot apply ' + requested + ' to one conversation.'
    : outcome.reason === 'failed'
      ? 'The host could not be asked to apply ' + requested + ' to this conversation.'
      : 'This host does not offer ' + requested + '.';
  return <div className="kb-model-notice kb-preset-notice" role="status">
    <strong>Board preset unavailable</strong>
    <div className="kb-model-notice-body">
      <p>{cause} This conversation started on the host default preset.</p>
      <button type="button" className="kb-button" onClick={onDismiss}>Dismiss</button>
    </div>
  </div>;
}
