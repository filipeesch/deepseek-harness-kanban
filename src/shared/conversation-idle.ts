/** One family of owned conversation activity that refuses an admission. */
export type ConversationBlocker =
  | { readonly family: 'turn' | 'subagent' | 'inbox' }
  | { readonly family: 'job' | 'schedule'; readonly id?: string; readonly label: string }
  | { readonly family: 'question' | 'approval' };

/** The readiness verdict for one conversation, with the bounded facts behind it. */
export interface ConversationIdleReport {
  readonly idle: boolean;
  readonly blockers: readonly ConversationBlocker[];
}

/** The verdict for a conversation that could not be read; the caller decides how to fail closed. */
export const IDLE_REPORT: ConversationIdleReport = Object.freeze({ idle: true, blockers: [] });

/** Whether a blocker belongs to the background-work family. */
export function isBackgroundBlocker(blocker: ConversationBlocker): blocker is Extract<ConversationBlocker, { family: 'job' | 'schedule' }> {
  return blocker.family === 'job' || blocker.family === 'schedule';
}

/** Whether a blocker is a pending user response. */
export function isUserWorkBlocker(blocker: ConversationBlocker): blocker is Extract<ConversationBlocker, { family: 'question' | 'approval' }> {
  return blocker.family === 'question' || blocker.family === 'approval';
}
