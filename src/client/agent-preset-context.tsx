import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AgentPresetPort, AgentPresetPortSource } from './agent-preset-port.js';

export type AgentPresetTranslate = (key: string, params?: Record<string, unknown>) => string;

interface AgentPresetContextValue {
  readonly source: AgentPresetPortSource;
  readonly translate?: AgentPresetTranslate;
}

const EMPTY_VALUE: AgentPresetContextValue = { source: { getSnapshot: () => null, subscribe: () => () => {} } };
const Context = createContext<AgentPresetContextValue | null>(null);

/** Supply the optional native preset port and its host locale to the card picker. */
export function AgentPresetProvider({ source, translate, children }: { source: AgentPresetPortSource; translate?: AgentPresetTranslate; children: ReactNode }) {
  const value = { source, ...(translate === undefined ? {} : { translate }) };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The current native preset port, or null until the optional namespace mounts. */
export function useAgentPresetPort(): { port: AgentPresetPort | null; translate: AgentPresetTranslate | undefined } {
  const value = useContext(Context) ?? EMPTY_VALUE;
  const source = value.source;
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  const getSnapshot = useCallback(() => source.getSnapshot(), [source]);
  const port = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { port, translate: value.translate };
}
