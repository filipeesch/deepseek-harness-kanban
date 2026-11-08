import React, { useCallback, useEffect, useState } from 'react';
import type { AgentPresetOption, AgentPresetPort } from './agent-preset-port.js';
import type { AgentPresetTranslate } from './agent-preset-context.js';

/** Props for the agent-preset card picker that starts a task conversation. */
export interface AgentPresetCardsProps {
  /** Native preset port; null until the optional Remote namespace mounts. */
  port: AgentPresetPort | null;
  /** Host locale bound to `settings.agentPreset`; absent in isolated harnesses. */
  translate?: AgentPresetTranslate | undefined;
  /** The task or worktree state prevents creation right now. */
  disabled: boolean;
  /** Why creation is unavailable, shown beside the cards. */
  hint?: string | undefined;
  /** A card activation is already creating or selecting. */
  busy: boolean;
  /** A previous card activation failed after the conversation was created. */
  error: string | null;
  /** Create/select/open for one preset card; the default needs no explicit selection. */
  onPick(presetId: string, isDefault: boolean): void;
  /** Dismiss the plus action's choice; absent in the no-conversation state. */
  onCancel?: (() => void) | undefined;
}

interface RosterState {
  status: 'loading' | 'ready' | 'error';
  options: readonly AgentPresetOption[];
  error: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const BUILT_IN_KEYS: Readonly<Record<string, { name: string; description: string }>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
};

function displayPreset(option: AgentPresetOption, translate: AgentPresetTranslate | undefined): { name: string; description: string | undefined } {
  const keys = BUILT_IN_KEYS[option.id];
  const name = keys === undefined ? undefined : translate?.(keys.name);
  const description = keys === undefined ? undefined : translate?.(keys.description);
  return {
    name: name ?? option.name ?? option.id,
    description: description ?? option.description,
  };
}

function useAgentPresetRoster(port: AgentPresetPort | null): { state: RosterState; retry: () => void } {
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

/**
 * Present the host's native agent-preset roster as the start choice for a task
 * conversation. The plugin owns this picker because the host's own preset seat
 * and label self-hide outside the main panel.
 * @param props - roster port, availability, failure state, and the chosen card.
 * @returns the card grid, or its loading/error state.
 */
export function AgentPresetCards({ port, translate, disabled, hint, busy, error, onPick, onCancel }: AgentPresetCardsProps) {
  const { state, retry } = useAgentPresetRoster(port);
  const locked = disabled || busy;
  return <div className="kb-preset-cards" role="group" aria-label="Start a conversation">
    <div className="kb-preset-cards-header">
      <h3>Choose an agent preset</h3>
      {onCancel === undefined ? null : <button type="button" className="kb-button" onClick={onCancel} disabled={busy}>Cancel</button>}
    </div>
    {hint === undefined ? null : <p className="kb-hint" role="note">{hint}</p>}
    {error === null ? null : <div className="kb-error" role="alert">{error}</div>}
    {state.status === 'loading' ? <p className="kb-hint" role="status">Loading agent presets…</p> : null}
    {state.status === 'error' ? <div className="kb-error" role="alert">
      <p>{state.error ?? 'The native agent-preset roster is unavailable.'}</p>
      <button type="button" className="kb-button" onClick={retry}>Retry presets</button>
    </div> : null}
    {state.status === 'ready' && state.options.length === 0 ? <div className="kb-empty" role="status">
      <p>No agent presets are available.</p>
      <button type="button" className="kb-button" onClick={retry}>Retry presets</button>
    </div> : null}
    {state.status === 'ready' && state.options.length > 0 ? <div className="kb-preset-grid">
      {state.options.map(option => {
        const display = displayPreset(option, translate);
        return <button
          key={option.id}
          type="button"
          className="kb-preset-card"
          disabled={locked}
          onClick={() => onPick(option.id, option.isDefault === true)}
        >
          <span className="kb-preset-card-name">{display.name}</span>
          {display.description === undefined ? null : <span className="kb-preset-card-description">{display.description}</span>}
        </button>;
      })}
    </div> : null}
  </div>;
}
