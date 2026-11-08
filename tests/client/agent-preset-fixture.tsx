import React, { useMemo, type ReactNode } from 'react';
import { AgentPresetProvider } from '../../src/client/agent-preset-context.js';
import type { AgentPresetPort } from '../../src/client/agent-preset-port.js';

/** A minimal host-native preset roster shared by drawer and board tests. */
export const PRESET_OPTIONS = [
  { id: 'standard', name: 'Standard', description: 'Balanced coding agent', isDefault: true },
  { id: 'ptc', name: 'PTC', description: 'Plan, test, and check' },
] as const;

export function presetPort(overrides: Partial<AgentPresetPort> = {}): AgentPresetPort {
  return {
    list: async () => PRESET_OPTIONS,
    select: async () => ({ ok: true }),
    ...overrides,
  } as AgentPresetPort;
}

/** Supply a deterministic preset port to a component under test. */
export function PresetProvider({ port, children }: { port?: AgentPresetPort; children: ReactNode }) {
  const source = useMemo(() => {
    const value = port ?? presetPort();
    return { getSnapshot: () => value, subscribe: () => () => {} };
  }, [port]);
  return <AgentPresetProvider source={source}>{children}</AgentPresetProvider>;
}
