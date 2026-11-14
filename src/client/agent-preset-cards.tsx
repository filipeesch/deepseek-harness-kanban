import React, { useEffect, useRef } from 'react';
import type { AgentPresetPort } from './agent-preset-port.js';
import type { AgentPresetTranslate } from './agent-preset-context.js';
import { displayPreset, useAgentPresetRoster } from './agent-preset-roster.js';

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
  /** The preset the task's board names as its default, when it names one. */
  defaultPresetId?: string | undefined;
}


/**
 * Present the host's native agent-preset roster as the start choice for a task
 * conversation. The plugin owns this picker because the host's own preset seat
 * and label self-hide outside the main panel.
 * @param props - roster port, availability, failure state, and the chosen card.
 * @returns the card grid, or its loading/error state.
 */
export function AgentPresetCards({ port, translate, disabled, hint, busy, error, onPick, onCancel, defaultPresetId }: AgentPresetCardsProps) {
  const { state, retry } = useAgentPresetRoster(port);
  const locked = disabled || busy;
  const defaultCard = useRef<HTMLButtonElement | null>(null);
  // The board's default is pre-selected in the only sense this picker allows: the
  // card is focused and marked, while activation is still required to create.
  useEffect(() => {
    if (locked || state.status !== 'ready' || defaultPresetId === undefined) return;
    // Focus after the drawer's own mount focus settles, so the marked card is the
    // one the keyboard starts on rather than the surface that hosted it.
    const frame = requestAnimationFrame(() => defaultCard.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [locked, state.status, defaultPresetId]);
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
        const isDefault = option.id === defaultPresetId;
        return <button
          key={option.id}
          ref={isDefault ? defaultCard : undefined}
          type="button"
          className={'kb-preset-card' + (isDefault ? ' is-default' : '')}
          data-default={isDefault ? 'true' : undefined}
          data-preset-id={option.id}
          autoFocus={isDefault}
          disabled={locked}
          onClick={() => onPick(option.id, option.isDefault === true)}
        >
          <span className="kb-preset-card-name">{display.name}</span>
          {display.description === undefined ? null : <span className="kb-preset-card-description">{display.description}</span>}
          {isDefault ? <span className="kb-preset-card-badge">Board default</span> : null}
        </button>;
      })}
    </div> : null}
  </div>;
}
