import React from 'react';
import type { ScheduleRuntimeView } from '../../../shared/types.js';
import { formatOccurrence } from './schedule-draft.js';

/** The last run of one schedule, with a link to its conversation when one exists. */
export function ScheduleLastRun({ runtime, timeZone, onOpenSession }: {
  runtime?: ScheduleRuntimeView;
  timeZone: string;
  onOpenSession?: (sessionId: string) => void;
}) {
  if (runtime?.running === true) return <span className="kb-badge" role="status">Running now</span>;
  const last = runtime?.lastRun;
  if (last === undefined) return <span className="kb-hint">Never ran.</span>;
  const when = formatOccurrence(new Date(last.at), timeZone);
  const failed = last.status === 'failed';
  return <span className="kb-schedule-last-run">
    <span className="kb-hint">{failed ? 'Last run failed ' + when + ': ' + (last.error?.message ?? 'unknown error') : 'Last run sent ' + when}</span>
    {last.sessionId !== undefined && onOpenSession !== undefined
      ? <button type="button" className="kb-button" onClick={() => onOpenSession(last.sessionId!)}>Open conversation</button>
      : last.sessionId !== undefined
        ? <span className="kb-hint">Conversation: {last.sessionId}</span>
        : null}
    {last.archiveError !== undefined && <span className="kb-hint" role="status">Conversation not archived: {last.archiveError.message}</span>}
  </span>;
}
