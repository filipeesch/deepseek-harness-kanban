import { useCallback, useEffect, useState } from 'react';
import type { AgentPresetOption, AgentPresetPort } from './agent-preset-port.js';
import type { AgentPresetTranslate } from './agent-preset-context.js';

/** What the roster read currently knows. */
export interface RosterState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly options: readonly AgentPresetOption[];
  readonly error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Built-in preset ids get the host's localized name and description. */
const BUILT_IN_KEYS: Readonly<Record<string, { name: string; description: string }>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
};

/** The name and description to present for one roster entry. */
export function displayPreset(option: AgentPresetOption, translate: AgentPresetTranslate | undefined): { name: string; description: string | undefined } {
  const keys = BUILT_IN_KEYS[option.id];
  const name = keys === undefined ? undefined : translate?.(keys.name);
  const description = keys === undefined ? undefined : translate?.(keys.description);
  return { name: name ?? option.name ?? option.id, description: description ?? option.description };
}

/**
 * Read the host's native agent-preset roster, with a retry. Shared by the
 * conversation cards and the board's default-preset list so both present the
 * same options, the same loading state, and the same failure.
 */
export function useAgentPresetRoster(port: AgentPresetPort | null): { state: RosterState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RosterState>({ status: 'loading', options: [], error: null });
  useEffect(() => {
    if (port === null) {
      setState({ status: 'error', options: [], error: 'The native agent-preset roster is unavailable.' });
      return undefined;
    }
    let active = true;
    setState({ status: 'loading', options: [], error: null });
    void port.list().then(
      options => { if (active) setState({ status: 'ready', options, error: null }); },
      error => { if (active) setState({ status: 'error', options: [], error: messageOf(error) }); },
    );
    return () => { active = false; };
  }, [port, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { state, retry };
}
