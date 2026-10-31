import React from 'react';
import type { Problem } from '../shared/types.js';
import { ErrorNotice } from './ui.js';

export interface ConversationNotice {
  key: string;
  problem: Problem | null;
}

/** One presentation point for the Conversations section notices. */
export function ConversationNotices({ notices }: { notices: readonly ConversationNotice[] }) {
  return <>{notices.map(({ key, problem }) => problem ? <ErrorNotice key={key} problem={problem} /> : null)}</>;
}
