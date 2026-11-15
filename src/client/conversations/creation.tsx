import React, { useCallback, useRef, useState } from 'react';
import type { Command, KanbanSnapshot, Problem, Task } from '../../shared/types.js';
import { AgentPresetCards } from '../agent-preset-cards.js';
import type { AgentPresetPort } from '../agent-preset-port.js';
import type { AgentPresetTranslate } from '../agent-preset-context.js';
import type { ConversationLeaseRegistry } from '../conversation-leases.js';
import type { ModelFallbackRegistry } from '../model-fallbacks.js';
import type { PresetFallbackRegistry } from '../preset-fallbacks.js';
import { creationModelOutcome, creationPresetOutcome, creationReceiptId } from '../ui.js';

/** What the conversation-creation flow needs from the drawer that owns it. */
export interface ConversationCreationOptions {
  readonly task: Task;
  /** The task or surface state that prevents creating a conversation right now. */
  readonly blocked: boolean;
  /** A task operation or pending transition is in flight. */
  readonly busy: boolean;
  /** The drawer's shared command runner, already scoped to the creation scope. */
  readonly execute: (command: Command) => Promise<KanbanSnapshot | null>;
  readonly pending: boolean;
  readonly leases: ConversationLeaseRegistry | null;
  readonly models: ModelFallbackRegistry | null;
  readonly presets: PresetFallbackRegistry | null;
  readonly presetPort: AgentPresetPort | null;
  /** The preset the task's board names for new conversations, when it names one. */
  readonly boardDefaultPreset?: string | undefined;
  /** Present one created conversation in the drawer. */
  readonly onSelected: (sessionId: string) => void;
  /** Move focus to one conversation's tab. */
  readonly onFocus: (sessionId: string) => void;
  /** The created conversation could not be proven; the drawer requires an explicit selection. */
  readonly onSelectionRequired: () => void;
}

/** The creation flow's state and actions, owned by the Conversations section. */
export interface ConversationCreation {
  readonly creating: boolean;
  readonly error: Problem | null;
  readonly choosing: boolean;
  readonly pendingConversation: string | null;
  readonly presetError: string | null;
  readonly busy: boolean;
  start(): void;
  cancel(): void;
  pick(presetId: string, isDefault: boolean): void;
  /** Forget the creation attempt after the user moves to another conversation. */
  forget(): void;
}

/**
 * Create a task conversation and apply the chosen agent preset.
 *
 * The conversation is created once; a failed preset selection keeps the created
 * conversation pending so a retry reuses it instead of creating another one.
 */
export function useConversationCreation(options: ConversationCreationOptions): ConversationCreation {
  const { task, blocked, busy, execute, pending, leases, models, presets, presetPort, boardDefaultPreset, onSelected, onFocus, onSelectionRequired } = options;
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<Problem | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [pendingConversation, setPendingConversation] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const generation = useRef(0);

  const forget = useCallback(() => {
    generation.current += 1;
    setCreating(false);
    setChoosing(false);
    setCreationError(null);
    setPendingConversation(null);
    setPresetError(null);
  }, []);

  const select = useCallback((sessionId: string) => {
    generation.current += 1;
    leases?.acquireRoot(sessionId);
    setCreationError(null);
    setChoosing(false);
    setPendingConversation(null);
    setPresetError(null);
    onSelected(sessionId);
  }, [leases, onSelected]);

  /** Create the conversation, validate its receipt, and keep it pending until its preset is chosen. */
  async function createConversationSession(): Promise<string | null> {
    if (creating || creationError || blocked || busy) return null;
    setCreating(true);
    try {
      // The first start reuses a conversation created while this request was queued;
      // the plus action on an existing task intentionally adds another one.
      const result = await execute({ type: 'conversation.create', taskId: task.id, ...(task.sessionIds.length === 0 ? { ensureFirst: true } : {}) });
      if (!result) return null;
      const sessionId = creationReceiptId(result, 'conversation');
      // What the host did with the board's model travels on the same receipt, so the
      // notice needs no extra read and can be shown when this conversation is opened.
      if (sessionId !== undefined) {
        models?.record(sessionId, creationModelOutcome(result));
        presets?.record(sessionId, creationPresetOutcome(result));
      }
      const createdTask = result.state.hubs.flatMap(hub => hub.tasks).find(value => value.id === task.id);
      if (!sessionId || !createdTask?.sessionIds.includes(sessionId) || createdTask.closedSessionIds.includes(sessionId)) {
        onSelectionRequired();
        setCreationError({ code: !sessionId ? 'CREATION_RECEIPT_REQUIRED' : 'CREATED_CONVERSATION_UNAVAILABLE', message: 'The saved conversation could not be identified safely from its exact creation receipt. Select a tab explicitly or refresh the application before creating another conversation.' });
        return null;
      }
      return sessionId;
    } finally { setCreating(false); }
  }

  /** Create (once), select the chosen preset on that conversation, and open its window. */
  async function pick(presetId: string, isDefault: boolean) {
    if (presetBusy || blocked || busy || pending) return;
    const attempt = generation.current;
    setPresetError(null);
    setPresetBusy(true);
    try {
      let sessionId = pendingConversation;
      if (sessionId === null) {
        sessionId = await createConversationSession();
        if (sessionId === null) return;
        if (attempt !== generation.current) return;
        setPendingConversation(sessionId);
      }
      // The created conversation already runs the deployment default; selecting
      // that same preset again would only ask the host to reapply it.
      if (!isDefault) {
        if (presetPort === null) throw new Error('The native agent-preset roster is unavailable.');
        const result = await presetPort.select(sessionId, presetId);
        if (attempt !== generation.current) return;
        if (!result.ok) throw new Error(result.message ?? 'The agent preset could not be selected.');
      }
      select(sessionId);
      onFocus(sessionId);
    } catch (error) {
      if (attempt !== generation.current) return;
      setPresetError(error instanceof Error ? error.message : String(error));
    } finally { setPresetBusy(false); }
  }

  return {
    creating,
    error: creationError,
    choosing,
    pendingConversation,
    presetError,
    busy: presetBusy || creating,
    start: () => { setChoosing(true); setPresetError(null); },
    cancel: forget,
    pick: (presetId, isDefault) => { void pick(presetId, isDefault); },
    forget,
  };
}

/** The preset choice the drawer presents when a conversation is started or all are closed. */
export interface ConversationCreationPanelProps {
  readonly creation: ConversationCreation;
  readonly port: AgentPresetPort | null;
  readonly translate: AgentPresetTranslate | undefined;
  readonly disabled: boolean;
  readonly hint?: string | undefined;
  /** Dismiss the plus action's choice; absent in the no-conversation state. */
  readonly onCancel?: (() => void) | undefined;
  readonly boardDefaultPreset?: string | undefined;
}

/** Render the agent-preset cards for a conversation the drawer is about to start. */
export function ConversationCreationPanel({ creation, port, translate, disabled, hint, onCancel, boardDefaultPreset }: ConversationCreationPanelProps) {
  return <AgentPresetCards
    port={port}
    translate={translate}
    disabled={disabled}
    hint={hint}
    busy={creation.busy}
    error={creation.presetError}
    onPick={(presetId, isDefault) => creation.pick(presetId, isDefault)}
    {...(onCancel === undefined ? {} : { onCancel })}
    {...(boardDefaultPreset === undefined ? {} : { defaultPresetId: boardDefaultPreset })}
  />;
}
