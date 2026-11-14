import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ClientApi } from '../shared/types.js';
import type { RunCommand } from './ui.js';
import { ScriptReviewDialog, type ScriptReviewRequest } from './deterministic-review.js';

type OpenReview = (request: ScriptReviewRequest) => Promise<void>;
const ReviewContext = createContext<OpenReview | null>(null);

const unavailable: OpenReview = async () => undefined;
/** A surface rendered outside the board (a unit test, an isolated card) keeps rendering; it simply has no review to open. */
export function useScriptReview(): OpenReview {
  return useContext(ReviewContext) ?? unavailable;
}

/**
 * One review surface for every entry point. Opening returns after the dialog
 * closes, so the stage editor can re-read the approval state before deciding
 * whether to close itself.
 */
export function ScriptReviewProvider({ api, run, children }: { api: ClientApi; run: RunCommand; children: React.ReactNode }) {
  const [request, setRequest] = useState<ScriptReviewRequest | null>(null);
  const resolver = useRef<(() => void) | null>(null);
  const open = useCallback<OpenReview>(next => new Promise<void>(resolve => {
    resolver.current?.();
    resolver.current = resolve;
    setRequest(next);
  }), []);
  const close = useCallback(() => {
    setRequest(null);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.();
  }, []);
  return <ReviewContext.Provider value={open}>
    {children}
    {request !== null && <ScriptReviewDialog request={request} api={api} run={run} onClose={close} />}
  </ReviewContext.Provider>;
}
