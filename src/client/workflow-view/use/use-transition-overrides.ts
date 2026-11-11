import { useCallback, useEffect, useRef, useState } from 'react';
import type { TransitionRule, Workflow } from '../../../shared/types.js';
import { sameTransitionRules } from '../../../domain/transition-rule.js';
import type { TransitionOverrides } from '../present-workflow.js';

export interface TransitionOverridePort {
  readonly overrides: TransitionOverrides;
  /** Present one stage's transitions right away, until the store settles them. */
  intend(stageId: string, rules: readonly TransitionRule[] | null): void;
  /** Present a whole set of stages, used to restore an undone change. */
  preview(values: TransitionOverrides): void;
  /** Drop exactly the overrides the given intents created, leaving any other stage's alone. */
  release(values: TransitionOverrides): void;
  reset(): void;
}

function rulesOf(workflow: Workflow, stageId: string): readonly TransitionRule[] | undefined {
  return workflow.columns.find(value => value.id === stageId)?.allowedTransitions;
}

/** How many intents one stage remembers, so an earlier acknowledgement is still known. */
const INTENT_MEMORY = 8;

/**
 * An authored transition lives as an override only until the store settles it.
 *
 * A store acknowledgement of an *earlier* intent of this client is not a replacement:
 * two quick gestures on the same stage leave the newer intent presented while the
 * store catches up, and only a value this client never intended drops the override as
 * another writer's change. That distinction is why each stage remembers the values it
 * presented instead of only a single baseline.
 */
export function useTransitionOverrides(stored: Workflow): TransitionOverridePort {
  const [overrides, setOverrides] = useState<TransitionOverrides>({});
  const intents = useRef<Record<string, Array<readonly TransitionRule[] | null>>>({});
  /** The stored value each stage had before this session changed it. */
  const baselines = useRef<Record<string, readonly TransitionRule[] | null>>({});
  const storedRef = useRef(stored); storedRef.current = stored;

  useEffect(() => {
    setOverrides(current => {
      const entries = Object.entries(current);
      if (entries.length === 0) return current;
      let changed = false;
      const next: Record<string, readonly TransitionRule[] | null | undefined> = {};
      for (const [stageId, rules] of entries) {
        if (rules === undefined) continue;
        const saved = rulesOf(storedRef.current, stageId);
        if (sameTransitionRules(saved, rules)) { changed = true; delete intents.current[stageId]; delete baselines.current[stageId]; continue; }
        // An unchanged baseline means nothing has been acknowledged yet: a snapshot refresh
        // for any other reason must not hide an unacknowledged connection.
        const baseline = baselines.current[stageId];
        if (baseline !== undefined && sameTransitionRules(saved, baseline)) { next[stageId] = rules; continue; }
        // An acknowledgement of an earlier intent of this client is not a replacement either.
        const mine = intents.current[stageId] ?? [];
        if (mine.some(intent => sameTransitionRules(saved, intent))) { next[stageId] = rules; continue; }
        changed = true;
        delete intents.current[stageId];
        delete baselines.current[stageId];
      }
      return changed ? next : current;
    });
  }, [stored]);

  const remember = useCallback((stageId: string, rules: readonly TransitionRule[] | null) => {
    intents.current = { ...intents.current, [stageId]: [...(intents.current[stageId] ?? []), rules].slice(-INTENT_MEMORY) };
  }, []);

  const intend = useCallback((stageId: string, rules: readonly TransitionRule[] | null) => {
    if (baselines.current[stageId] === undefined) {
      const baseline = rulesOf(storedRef.current, stageId);
      baselines.current = { ...baselines.current, [stageId]: baseline === undefined ? null : baseline };
    }
    remember(stageId, rules);
    setOverrides(current => ({ ...current, [stageId]: rules }));
  }, [remember]);

  const preview = useCallback((values: TransitionOverrides) => {
    const next: Record<string, readonly TransitionRule[] | null> = {};
    for (const [stageId, rules] of Object.entries(values)) {
      if (rules === undefined) continue;
      if (sameTransitionRules(rulesOf(storedRef.current, stageId), rules)) continue;
      remember(stageId, rules);
      next[stageId] = rules;
    }
    setOverrides(next);
  }, [remember]);

  const release = useCallback((values: TransitionOverrides) => {
    const owned = Object.entries(values).filter(([, rules]) => rules !== undefined) as Array<[string, readonly TransitionRule[] | null]>;
    setOverrides(current => {
      let changed = false;
      const next = { ...current };
      for (const [stageId, rules] of owned) {
        // A newer gesture on the same stage owns the override now, so it is not ours to drop.
        if (!sameTransitionRules(current[stageId] ?? undefined, rules)) continue;
        delete next[stageId];
        changed = true;
      }
      return changed ? next : current;
    });
    const remainingIntents = { ...intents.current };
    const remainingBaselines = { ...baselines.current };
    for (const [stageId] of owned) {
      if (!sameTransitionRules(storedRef.current.columns.find(column => column.id === stageId)?.allowedTransitions ?? undefined, values[stageId] ?? null)) continue;
      delete remainingIntents[stageId];
      delete remainingBaselines[stageId];
    }
    intents.current = remainingIntents;
    baselines.current = remainingBaselines;
  }, []);

  const reset = useCallback(() => { intents.current = {}; setOverrides({}); }, []);

  return { overrides, intend, preview, release, reset };
}
