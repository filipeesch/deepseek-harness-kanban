import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ClientApi } from '../shared/types.js';
import type { DeterministicSummary } from '../shared/deterministic.js';
import type { RunCommand } from './ui.js';

type Summaries = Readonly<Record<string, DeterministicSummary>>;
const EMPTY: Summaries = {};
const noopSubscribe = () => () => {};
function summarySource(initial: Summaries) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: Summaries) {
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      const stable = Object.fromEntries(Object.entries(next).map(([id, value]) => [id, JSON.stringify(value) === JSON.stringify(current[id]) ? current[id]! : value]));
      current = stable;
      for (const listener of listeners) listener();
    },
  };
}
export interface DeterministicEnvironment { api: ClientApi; run: RunCommand; source: ReturnType<typeof summarySource>; boardId?: string }
const Context = createContext<DeterministicEnvironment | null>(null);
/** Summary publication does not invalidate every memoized card on attention-only updates. */
export function DeterministicProvider({ api, run, summaries, boardId, children }: { api: ClientApi; run: RunCommand; summaries: Summaries; boardId?: string; children: React.ReactNode }) {
  const latestRun = useRef(run); latestRun.current = run;
  const source = useMemo(() => summarySource(summaries), [api]);
  const value = useMemo(() => ({ api, run: (command: Parameters<RunCommand>[0]) => latestRun.current(command), source, ...(boardId === undefined ? {} : { boardId }) }), [api, source, boardId]);
  useLayoutEffect(() => source.update(summaries), [source, summaries]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDeterministicEnvironment() { return useContext(Context); }
export function useScriptSummary(taskId: string): DeterministicSummary | undefined {
  const environment = useDeterministicEnvironment();
  return useSyncExternalStore(environment?.source.subscribe ?? noopSubscribe, () => environment?.source.getSnapshot()[taskId], () => undefined);
}
export function useScriptSummaries(): Summaries {
  const environment = useDeterministicEnvironment();
  return useSyncExternalStore(environment?.source.subscribe ?? noopSubscribe, environment?.source.getSnapshot ?? (() => EMPTY), () => EMPTY);
}
