import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Problem, Project, RetainedCheckout, Task } from '../../shared/types.js';
import {
  boardNotices,
  commandFailureNotice,
  operationNotices,
  relocationNotices,
  retainedNotices,
  type BoardNotice,
  type NoticeHandlers,
} from './model.js';

/** The board's dismissal commands, injected so the notice model never knows the transport. */
export interface NoticeDismissalPort {
  /** Acknowledge retained checkout paths on the host; the directories stay on disk. */
  dismissRetained: (paths: readonly string[]) => Promise<void>;
  /** Clear the board command failure. */
  dismissFailure: () => void;
}

export interface BoardNoticesInput {
  retained: readonly RetainedCheckout[];
  tasks: readonly Task[];
  projects: readonly Project[];
  actionError: Problem | null;
  handlers: NoticeHandlers;
  dismissal: NoticeDismissalPort;
  /** Reports a rejected dismissal; the board turns it into its ordinary failure notice. */
  onDismissError?: (error: unknown) => void;
}

export interface BoardNoticeState {
  notices: readonly BoardNotice[];
  /** Dismiss every retained checkout the board presents; absent when there is none. */
  dismissAllRetained?: () => void;
}

/**
 * Composes the board's notices from host state and the page's own failure. A retained
 * path is hidden as soon as the user dismisses it and is restored if the host rejects
 * the acknowledgement, so the row can never flash back before the snapshot returns.
 */
export function useBoardNotices(input: BoardNoticesInput): BoardNoticeState {
  const { retained, tasks, projects, actionError, handlers, dismissal, onDismissError } = input;
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  // A dismissal the host has applied leaves the pending set as soon as its snapshot arrives.
  useEffect(() => {
    setPending(previous => {
      if (previous.size === 0) return previous;
      const live = new Set(retained.map(entry => entry.path));
      const next = new Set([...previous].filter(path => live.has(path)));
      return next.size === previous.size ? previous : next;
    });
  }, [retained]);

  const dismissRetained = useCallback((paths: readonly string[]) => {
    if (paths.length === 0) return;
    setPending(previous => new Set([...previous, ...paths]));
    void dismissal.dismissRetained(paths).catch(error => {
      setPending(previous => {
        const next = new Set(previous);
        for (const path of paths) next.delete(path);
        return next;
      });
      onDismissError?.(error);
    });
  }, [dismissal, onDismissError]);

  const visibleRetained = useMemo(() => retained.filter(entry => !pending.has(entry.path)), [retained, pending]);
  const dismissFailure = useCallback(() => dismissal.dismissFailure(), [dismissal]);

  const notices = useMemo(() => boardNotices({
    commandFailure: commandFailureNotice(actionError, dismissFailure),
    operations: operationNotices(tasks, handlers),
    relocations: relocationNotices(projects, handlers),
    retained: retainedNotices(visibleRetained, path => dismissRetained([path])),
  }), [actionError, dismissFailure, tasks, handlers, projects, visibleRetained, dismissRetained]);

  const dismissAllRetained = visibleRetained.length === 0 ? undefined : () => dismissRetained(visibleRetained.map(entry => entry.path));
  return { notices, ...(dismissAllRetained === undefined ? {} : { dismissAllRetained }) };
}
