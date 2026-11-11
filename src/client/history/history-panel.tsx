import React, { useEffect, useState } from 'react';
import type { TaskHistoryEntry } from '../../shared/task-history.js';
import type { Column } from '../../shared/types.js';
import { buildHistoryRows } from './history-view.js';

/** How often the current stage's duration is recomputed while the section is open. */
const REFRESH_MILLISECONDS = 60_000;

export interface HistoryPanelProps {
  /** The task's record; absent means nothing has been recorded yet. */
  history: readonly TaskHistoryEntry[] | undefined;
  /** The board's stages, so recorded references read with their current name. */
  columns: readonly Pick<Column, 'id' | 'name'>[];
}

/**
 * The History section: the task's recorded flow as one table.
 *
 * The panel owns layout and the refresh that keeps the current stage's duration
 * honest; how a row reads belongs to the view model beside it.
 */
export function HistoryPanel({ history, columns }: HistoryPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MILLISECONDS);
    return () => clearInterval(timer);
  }, []);
  const rows = buildHistoryRows({ history, columns, now });
  if (rows.length === 0) return <p className="kb-hint" role="status">Nothing has been recorded for this task yet.</p>;
  return <table className="kb-history" aria-label="Task history">
    <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Detail</th><th scope="col">In stage</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key} data-tone={row.tone}>
      <td className="kb-history-time"><time dateTime={row.moment}>{row.when}</time></td>
      <td className="kb-history-event">{row.event}</td>
      <td className="kb-history-detail">{row.detail}</td>
      <td className="kb-history-duration">{row.duration}</td>
    </tr>)}</tbody>
  </table>;
}
