import type { AgentModelFallback, SessionObservation, Task } from '../shared/types.js';
import { sessionObservationLabel } from '../domain/session-observation.js';
import type { AutoModeStatus } from './auto-mode.js';
import { cardOperationStatus } from './operation-description.js';

export interface CardStatusEntry { key: string; tone: 'danger' | 'pending'; label: string; alert?: boolean }

/**
 * The card's status lines, in a stable order: operation, transition,
 * stage-instruction failure, unobservable Session, then auto mode. The
 * diagnostic pause is a separate line so a turn that failed while the task was
 * paused is never hidden by the pause the agent requested.
 */
export function cardStatusEntries(task: Task, runFailure?: string, autoStatus?: AutoModeStatus, pauseStatuses: readonly AutoModeStatus[] = [], sessionObservation?: SessionObservation, decision?: string, agentFallback?: { agent: string; model: AgentModelFallback }): CardStatusEntry[] {
  const entries: CardStatusEntry[] = [];
  if (task.operation) {
    const status = cardOperationStatus(task.operation);
    entries.push({ key: 'operation', tone: status.tone, label: status.label });
  }
  if (task.pendingTransition && task.pendingTransition.origin !== 'auto') {
    const pending = task.pendingTransition;
    const failed = pending.status === 'failed';
    // A transition the agent declared is named as such: it is not a confirmed
    // action the user approved, and the earlier wording would claim they did.
    const noun = pending.origin === 'agent' ? 'Agent-declared transition' : 'Confirmed action';
    entries.push({ key: 'transition', tone: failed ? 'danger' : 'pending', label: failed ? noun + ' failed' : noun + ': ' + pending.status });
  }
  if (decision !== undefined) entries.push({ key: 'decision', tone: 'pending', label: decision });
  if (runFailure !== undefined) entries.push({ key: 'instruction', tone: 'danger', label: runFailure, alert: true });
  // A stage held for an agent preset the host does not offer is a pending fact about
  // the agent, not a failed run: the card names what is missing and keeps its run action.
  const hold = task.instructionPending?.hold;
  if (hold !== undefined) {
    entries.push({
      key: 'instruction-hold',
      tone: 'pending',
      label: hold.preset === undefined
        ? 'Waiting for the ' + hold.agent + ' agent preset'
        : 'Waiting for the ' + hold.agent + ' agent preset "' + hold.preset + '"',
    });
  }
  // A route the stage's agent conversation fell back from is a durable fact of its
  // binding, so the card keeps reporting it while that conversation runs.
  if (agentFallback !== undefined) {
    const { agent, model } = agentFallback;
    entries.push({
      key: 'agent-model-fallback',
      tone: 'pending',
      label: model.inUse === undefined
        ? 'Using the deployment default model: the ' + agent + ' agent could not use ' + model.requested.provider + ' · ' + model.requested.model + '.'
        : 'Using ' + model.inUse.provider + ' · ' + model.inUse.model + ' instead of ' + model.requested.provider + ' · ' + model.requested.model + ': the ' + agent + ' agent could not use it.',
    });
  }
  // A Session the plugin cannot observe is a failure about the conversation, so it
  // sits with the other conversation-derived facts and never replaces them.
  if (sessionObservation !== undefined) entries.push({ key: 'session-observation', tone: 'danger', label: sessionObservationLabel(sessionObservation.state), alert: true });
  if (autoStatus !== undefined) entries.push({ key: 'auto', tone: autoStatus.tone, label: autoStatus.label, ...(autoStatus.alert === true ? { alert: true } : {}) });
  for (const [index, value] of pauseStatuses.entries()) entries.push({ key: 'auto-pause-' + index, tone: value.tone, label: value.label, ...(value.alert === true ? { alert: true } : {}) });
  return entries;
}