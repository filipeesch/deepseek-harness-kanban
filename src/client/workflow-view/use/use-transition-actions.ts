import { useCallback, useRef, useState } from 'react';
import type { ConnectionLayout, KanbanSnapshot, StagePatch, TransitionRule, Workflow } from '../../../shared/types.js';
import { connectionKey, sameConnectionLayout } from '../../../domain/connection-anchor.js';
import type { ConnectionLayouts } from '../../../domain/workflow-connections.js';
import type { StagePositions } from '../../../domain/workflow-positions.js';
import type { StageSizes } from '../../../domain/workflow-sizes.js';
import type { WorkflowWrites } from '../../workflow-write.js';
import type { PlacementHistoryState } from './use-placement-history.js';
import type { TransitionOverridePort } from './use-transition-overrides.js';
import type { PlacementStep, TransitionValues } from '../history.js';
import { presentedRules } from '../present-workflow.js';
import { replacingDestination, withCondition, withDestination, withMovedDestination, withoutDestination } from '../transition-edit.js';

/**
 * The connection layouts the diagram stores. A transition edit that supersedes a
 * connection layout asks for the document that carries the pruned set, and hands it
 * to the same transaction that writes the transitions.
 */
export interface ConnectionLayoutPort {
  /** The layout this session intends to store. */
  current(): ConnectionLayouts;
  /** Present the given layouts as the ones the next save will store. */
  intend(values: ConnectionLayouts): void;
  /** The authored workflow one write response acknowledged. */
  authoritativeYaml(snapshot: KanbanSnapshot): string | null;
  /** Apply this session's intended layout to authored text, keeping every other character. */
  apply(text: string): string;
  /** Adopt the connections the transaction stored, so they are not sent again. */
  accept(values: ConnectionLayouts): void;
  /** Put the connection layout back and discard the document the rejected write composed. */
  restore(values: ConnectionLayouts): void;
}

export interface TransitionActionInput {
  /** The workflow the diagram presents, including transitions it has not acknowledged. */
  readonly workflow: () => Workflow;
  readonly writes: WorkflowWrites;
  readonly overrides: TransitionOverridePort;
  readonly history: PlacementHistoryState;
  readonly connections: ConnectionLayoutPort;
  readonly positions: () => StagePositions;
  readonly sizes: () => StageSizes;
  readonly onError: (error: unknown) => void;
}

export interface TransitionActions {
  /** True while a connection gesture's writes are in flight. */
  readonly pending: boolean;
  /** Author a destination on a stage. */
  create(sourceId: string, to: string): void;
  /** Point one authored destination at another stage. */
  repoint(sourceId: string, from: string, to: string): void;
  /** Move an authored destination to another source stage. */
  reown(fromSource: string, to: string, toSource: string): void;
  /** Remove one drawn connection; a stage left without a destination permits none. */
  remove(sourceId: string, to: string): void;
  /**
   * Author or clear one destination's condition, promoting the default path when
   * needed. It rejects when the store refuses, so the editor that sent it can stay
   * open with its text and show the problem where the user is looking.
   */
  setCondition(sourceId: string, to: string, when: string | null): Promise<void>;
  /** Restore a destination set a history step carries. */
  restore(values: TransitionValues): void;
  /** The problem the last condition write reported, until it is cleared. */
  readonly error: string | null;
  clearError(): void;
}

/** One stage's destinations before and after one gesture. */
interface TransitionChange {
  readonly stageId: string;
  readonly before: readonly TransitionRule[] | null;
  readonly after: readonly TransitionRule[] | null;
}

/** The layouts without one connection's entry, or undefined when it stored none. */
function withoutEntry(connections: ConnectionLayouts, from: string, to: string): ConnectionLayouts | undefined {
  const key = connectionKey(from, to);
  if (connections[key] === undefined) return undefined;
  const result: Record<string, ConnectionLayout | undefined> = Object.create(null) as Record<string, ConnectionLayout | undefined>;
  for (const [id, layout] of Object.entries(connections)) {
    if (id === key || layout === undefined) continue;
    result[id] = layout;
  }
  return result as ConnectionLayouts;
}

function sameLayouts(left: ConnectionLayouts, right: ConnectionLayouts): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameConnectionLayout(left[key], right[key])) return false;
  }
  return true;
}

function messageOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') return (error as { message: string }).message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The writes a connection gesture makes.
 *
 * A gesture that changes transitions and connection layout together is one history
 * step and one optimistic presentation. Its writes run in one reserved slot, so the
 * transition is authored before the layout entry it supersedes is pruned and no other
 * write lands between them; a move between stages authors on the receiving stage
 * before removing from the previous one. A rejected write removes exactly the step it
 * pushed, releases exactly the stages it presented, and reports the problem.
 */
export function useTransitionActions(input: TransitionActionInput): TransitionActions {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(0);
  const inputRef = useRef(input); inputRef.current = input;

  const run = useCallback((changes: readonly TransitionChange[], prune: { from: string; to: string } | null): void => {
    const current = inputRef.current;
    if (changes.length === 0) return;
    const stageIds = changes.map(change => change.stageId);
    const beforeConnections = prune === null ? undefined : current.connections.current();
    const afterConnections = prune === null || beforeConnections === undefined ? undefined : withoutEntry(beforeConnections, prune.from, prune.to);
    const prunes = beforeConnections !== undefined && afterConnections !== undefined && !sameLayouts(beforeConnections, afterConnections);
    for (const change of changes) current.overrides.intend(change.stageId, change.after);
    if (prunes) current.connections.intend(afterConnections!);
    const positions = current.positions();
    const beforeTransitions: Record<string, readonly TransitionRule[] | null> = {};
    const afterTransitions: Record<string, readonly TransitionRule[] | null> = {};
    for (const change of changes) {
      beforeTransitions[change.stageId] = change.before;
      afterTransitions[change.stageId] = change.after;
    }
    const step: PlacementStep = {
      before: positions,
      after: positions,
      restores: prunes ? 'both' : 'transitions',
      ...(prunes ? { beforeConnections: beforeConnections!, afterConnections: afterConnections! } : {}),
      beforeTransitions,
      afterTransitions,
      beforeLayout: positions,
      afterLayout: positions,
    };
    current.history.push(step);
    inFlight.current += 1;
    setPending(true);
    void (async () => {
      try {
        await current.writes.atomically(async send => {
          let acknowledged: KanbanSnapshot | undefined;
          for (const change of changes) {
            const patch: StagePatch = { allowedTransitions: change.after === null ? null : [...change.after] };
            acknowledged = await send.patchStage(change.stageId, patch);
          }
          if (!prunes || afterConnections === undefined || acknowledged === undefined) return;
          // The prune is composed onto the document the patches acknowledged, so it can
          // never carry the transitions they replaced.
          const text = current.connections.authoritativeYaml(acknowledged);
          if (text === null) return;
          const yaml = current.connections.apply(text);
          await send.saveWorkflow(yaml);
          current.connections.accept(afterConnections);
        });
      } catch (writeError) {
        // The store refused: undo exactly what this gesture presented.
        current.history.dropStep(step);
        current.overrides.release(Object.fromEntries(changes.map(change => [change.stageId, change.after])));
        if (prunes) current.connections.restore(beforeConnections!);
        current.onError(writeError);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setPending(false);
      }
    })();
  }, []);

  const changesFor = useCallback((changes: readonly { stageId: string; after: readonly TransitionRule[] | null }[]): TransitionChange[] => {
    const workflow = inputRef.current.workflow();
    return changes.map(change => ({ stageId: change.stageId, before: presentedRules(workflow, change.stageId), after: change.after }));
  }, []);

  const create = useCallback((sourceId: string, to: string) => {
    const before = presentedRules(inputRef.current.workflow(), sourceId);
    const after = withDestination(before, to);
    if (before !== null && before.length === after.length && before.every((rule, index) => rule.to === after[index]?.to)) return;
    run(changesFor([{ stageId: sourceId, after }]), null);
  }, [changesFor, run]);

  const repoint = useCallback((sourceId: string, from: string, to: string) => {
    const before = presentedRules(inputRef.current.workflow(), sourceId);
    if (from === to) return;
    run(changesFor([{ stageId: sourceId, after: replacingDestination(before, from, to) }]), { from: sourceId, to: from });
  }, [changesFor, run]);

  const reown = useCallback((fromSource: string, to: string, toSource: string) => {
    if (fromSource === toSource || fromSource === to) return;
    const workflow = inputRef.current.workflow();
    const receiver = presentedRules(workflow, toSource);
    const previous = presentedRules(workflow, fromSource);
    // The default path is drawn but authored nowhere: moving its owner authors the
    // destination on the receiver and stops the previous source from drawing it.
    const moved = previous === null ? { to } : (previous ?? []).find(rule => rule.to === to);
    if (moved === undefined) return;
    // The default path can carry a stored layout too, so its pair is pruned like any other.
    run(changesFor([
      { stageId: toSource, after: withMovedDestination(receiver, to, moved) },
      { stageId: fromSource, after: withoutDestination(previous, to) },
    ]), { from: fromSource, to });
  }, [changesFor, run]);

  const remove = useCallback((sourceId: string, to: string) => {
    const before = presentedRules(inputRef.current.workflow(), sourceId);
    // A stage that authors nothing draws its default path; removing it leaves the stage
    // permitting no destination, which is the only way to stop drawing it.
    const after = before === null ? [] : withoutDestination(before, to);
    if (before !== null && !before.some(rule => rule.to === to)) return;
    run(changesFor([{ stageId: sourceId, after }]), { from: sourceId, to });
  }, [changesFor, run]);

  const setCondition = useCallback(async (sourceId: string, to: string, when: string | null): Promise<void> => {
    const current = inputRef.current;
    const before = presentedRules(current.workflow(), sourceId);
    const after = withCondition(before, to, when);
    const unchanged = before !== null && before.length === after.length
      && before.every((rule, index) => rule.to === after[index]?.to && (rule.when ?? '') === (after[index]?.when ?? ''));
    if (unchanged) return;
    setError(null);
    current.overrides.intend(sourceId, after);
    const positions = current.positions();
    const step: PlacementStep = {
      before: positions,
      after: positions,
      restores: 'transitions',
      beforeTransitions: { [sourceId]: before },
      afterTransitions: { [sourceId]: after },
      beforeLayout: positions,
      afterLayout: positions,
    };
    current.history.push(step);
    inFlight.current += 1;
    setPending(true);
    try {
      // The narrow patch changes only this destination's condition, so the stage's
      // other entries keep the comments their author wrote between them.
      await current.writes.patchStage(sourceId, { transitionCondition: { to, when: when === null || when.trim().length === 0 ? null : when } });
    } catch (writeError) {
      current.history.dropStep(step);
      current.overrides.release({ [sourceId]: after });
      setError(messageOf(writeError));
      throw writeError;
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPending(false);
    }
  }, []);

  const restore = useCallback((values: TransitionValues) => {
    const current = inputRef.current;
    const entries = Object.entries(values);
    if (entries.length === 0) return;
    for (const [stageId, rules] of entries) current.overrides.intend(stageId, rules);
    inFlight.current += 1;
    setPending(true);
    void (async () => {
      try {
        await current.writes.atomically(async send => {
          for (const [stageId, rules] of entries) {
            await send.patchStage(stageId, { allowedTransitions: rules === null ? null : [...rules] });
          }
        });
      } catch (writeError) {
        current.overrides.release(Object.fromEntries(entries));
        current.onError(writeError);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setPending(false);
      }
    })();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pending, create, repoint, reown, remove, setCondition, restore, error, clearError };
}
