import React, { useSyncExternalStore } from 'react';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { BridgeStatus } from '../client-bridge.js';

/**
 * The strip sits above the board root, so its presentation travels with the component
 * rather than depending on the board stylesheet's mount.
 */
export const feedStatusStyles = String.raw`.kanban-feed-error{padding:8px 16px;color:var(--dsw-alias-state-error-primary,crimson);border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.kanban-feed-error button{font:inherit;font-size:13px;line-height:1.3;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 9px;cursor:pointer}
.kanban-feed-error button:hover{background:color-mix(in srgb,currentColor 8%,var(--dsw-alias-bg-l2))}
.kanban-feed-error button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,CanvasText);outline-offset:2px}`;

export interface FeedStatusProps {
  /** The board feed's health source; the Kanban page owns when this strip mounts. */
  readonly status: HostObservable<BridgeStatus>;
  /** Restart the board feed after a failure. */
  retry(): void;
}

/**
 * The board-update status.
 *
 * It presents only the live board feed: a rejected command, an explicit board read, or
 * a background refresh is a fact for the caller that started it and is reported there,
 * so it never replaces this status. The Kanban page is the only place that mounts this
 * component, which keeps a board failure out of every native conversation.
 */
export function FeedStatus({ status, retry }: FeedStatusProps) {
  const value = useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot);
  if (value.error === null) return null;
  return <><style>{feedStatusStyles}</style><div className="kanban-feed-error" role="alert">Kanban updates are unavailable: {value.error.message} <button type="button" onClick={() => retry()}>Retry updates</button></div></>;
}
