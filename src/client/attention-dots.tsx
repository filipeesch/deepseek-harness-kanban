import React from 'react';
import type { Attention } from '../shared/types.js';

export type AttentionState = Pick<Attention, 'unread' | 'awaitingReply' | 'failed'>;

/** Human-readable states shared by the visible dots and the hidden summaries. */
export function attentionStatusLabels(value: AttentionState): string[] {
  const labels: string[] = [];
  if (value.unread) labels.push('Unread messages');
  if (value.awaitingReply) labels.push('Awaiting reply');
  if (value.failed) labels.push('Agent failure');
  return labels;
}

/**
 * The three coexisting attention dots. Non-decorative uses expose each dot's meaning;
 * decorative uses hide them so the surrounding control keeps one stable accessible name.
 */
export function AttentionDots({ value, label = 'Attention', decorative = false }: { value: AttentionState; label?: string; decorative?: boolean }) {
  if (!value.unread && !value.awaitingReply && !value.failed) return null;
  return <span className="kb-attention-dots" role={decorative ? undefined : 'group'} aria-label={decorative ? undefined : label} aria-hidden={decorative ? true : undefined}>
    {value.unread && <span className="kb-dot kb-blue" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Unread messages'} title="Unread messages" />}
    {value.awaitingReply && <span className="kb-dot kb-orange" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Awaiting reply'} title="Awaiting reply" />}
    {value.failed && <span className="kb-dot kb-red" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Agent failure'} title="Agent failure" />}
  </span>;
}

/** Hidden text that folds the same states into a surrounding control's accessible name. */
export function AttentionStatusText({ value }: { value: AttentionState }) {
  const labels = attentionStatusLabels(value);
  return labels.length > 0 ? <span className="kb-sr">{labels.join(', ')}</span> : null;
}
