import type { TaskHistoryEntry } from '../shared/task-history.js';
import type { Workflow } from '../shared/types.js';
import { workflowGraph } from './workflow-graph.js';
import { KanbanError } from '../shared/errors.js';

/** How one use of a route was produced. */
export type RouteOriginKind = 'operator' | 'declared' | 'automatic' | 'script' | 'error' | 'unrecorded';

/** One card as the statistics read it: its identity, its stage, and its flow record. */
export interface RouteStatsCard {
  readonly taskId: string;
  readonly projectId: string;
  readonly columnId: string;
  readonly history?: readonly TaskHistoryEntry[];
}

/** The window and scope a statistics request asks about. */
export interface RouteStatsOptions {
  readonly since: string;
  readonly until: string;
  readonly projectIds?: readonly string[];
}

export interface TransitionUsage {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly origins: Readonly<Record<RouteOriginKind, number>>;
  /** Named script exits that produced this transition. */
  readonly exits: Readonly<Record<string, number>>;
}

export interface StageUsage {
  readonly stage: string;
  readonly entries: number;
  /** Milliseconds, rounded. */
  readonly mean: number;
  readonly p90: number;
  /** How many cards are in the stage now. */
  readonly now: number;
  /** The longest current stay, in milliseconds. */
  readonly oldest: number;
}

export interface ParkedCard {
  readonly taskId: string;
  readonly stage: string;
  readonly since: string;
  readonly duration: number;
}

export interface LoopUsage {
  readonly mean: number;
  readonly max: number;
  readonly cards: ReadonlyArray<{ readonly taskId: string; readonly count: number }>;
  readonly routes: ReadonlyArray<{ readonly from: string; readonly to: string; readonly count: number }>;
}

export interface RouteStats {
  readonly window: { readonly since: string; readonly until: string; readonly projectIds?: readonly string[] };
  readonly transitions: readonly TransitionUsage[];
  readonly exits: ReadonlyArray<{ readonly stage: string; readonly exit: string; readonly count: number }>;
  readonly stages: readonly StageUsage[];
  readonly parked: readonly ParkedCard[];
  readonly loops: LoopUsage;
  readonly unused: {
    readonly routes: ReadonlyArray<{ readonly from: string; readonly to: string }>;
    readonly exits: ReadonlyArray<{ readonly stage: string; readonly exit: string }>;
  };
}

const ORIGINS: readonly RouteOriginKind[] = ['operator', 'declared', 'automatic', 'script', 'error', 'unrecorded'];

function originOf(entry: Extract<TaskHistoryEntry, { kind: 'stage' }>): { kind: RouteOriginKind; exit?: string } {
  const origin = entry.origin;
  if (origin === undefined) return { kind: 'unrecorded' };
  if (origin === 'manual') return { kind: 'operator' };
  if (origin === 'agent') return { kind: 'declared' };
  if (origin === 'auto') return { kind: 'automatic' };
  const [kind, exit] = origin.startsWith('script:') ? ['script', origin.slice('script:'.length)] as const : ['error', origin.slice('error:'.length)] as const;
  return { kind, exit };
}

function within(window: { since: number; until: number }, at: string): boolean {
  const value = Date.parse(at);
  return Number.isFinite(value) && value >= window.since && value <= window.until;
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** The nearest-rank ninetieth percentile of a distribution. */
function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(proportion * sorted.length) - 1));
  return round(sorted[index]!);
}

/**
 * Aggregate how a board's workflow routes were used over a window.
 *
 * The input carries no card title, description, note, or conversation content,
 * and the result carries identifiers, counts, durations, and labels only. A card
 * whose record has no stage origin still contributes its transitions; it is
 * counted as an unrecorded origin rather than guessed.
 */
export function routeStats(input: { readonly workflow: Workflow; readonly cards: readonly RouteStatsCard[]; readonly options: RouteStatsOptions; readonly now?: string }): RouteStats {
  const window = { since: Date.parse(input.options.since), until: Date.parse(input.options.until) };
  if (!Number.isFinite(window.since) || !Number.isFinite(window.until)) throw new KanbanError('INVALID_INPUT', 'Statistics need a valid since and until timestamp.');
  if (window.since > window.until) throw new KanbanError('INVALID_INPUT', 'The statistics window starts after it ends.');
  const cards = input.options.projectIds === undefined ? input.cards : input.cards.filter(card => input.options.projectIds!.includes(card.projectId));
  const transitions = new Map<string, { from: string; to: string; count: number; origins: Record<RouteOriginKind, number>; exits: Record<string, number> }>();
  const exits = new Map<string, number>();
  const dwell = new Map<string, number[]>();
  const entries = new Map<string, number>();
  const parked: ParkedCard[] = [];
  // Every card contributes its loop count, including zero, so the board mean is
  // the mean over the cards the board holds rather than over the looping ones.
  const cardLoops: Array<{ taskId: string; count: number }> = [];
  const loopRoutes = new Map<string, { from: string; to: string; count: number }>();
  const now = Date.parse(input.now ?? new Date().toISOString());
  const configuredExits: Array<{ stage: string; exit: string }> = [];

  for (const column of input.workflow.columns) {
    for (const exit of Object.keys(column.deterministic?.exits ?? {})) configuredExits.push({ stage: column.id, exit });
  }

  for (const card of cards) {
    const history = card.history ?? [];
    // The card's timeline in this board: when each stage started.
    const timeline: Array<{ stage: string; at: number }> = [];
    // Loops are counted inside the requested window, so a return that straddles
    // its start is not attributed to it.
    const windowVisited = new Set<string>();
    let loops = 0;
    for (const entry of history) {
      if (entry.kind === 'created') { timeline.push({ stage: entry.columnId, at: Date.parse(entry.at) }); if (within(window, entry.at)) windowVisited.add(entry.columnId); continue; }
      if (entry.kind === 'stage') {
        const at = Date.parse(entry.at);
        if (!Number.isFinite(at)) continue;
        const previous = timeline[timeline.length - 1];
        if (previous !== undefined && within(window, entry.at)) {
          const elapsed = at - previous.at;
          if (elapsed >= 0) {
            const list = dwell.get(previous.stage) ?? [];
            list.push(elapsed);
            dwell.set(previous.stage, list);
          }
        }
        timeline.push({ stage: entry.columnId, at });
        if (within(window, entry.at)) {
          entries.set(entry.columnId, (entries.get(entry.columnId) ?? 0) + 1);
          const key = entry.fromColumnId + '\u0000' + entry.columnId;
          const usage = transitions.get(key) ?? { from: entry.fromColumnId, to: entry.columnId, count: 0, origins: Object.fromEntries(ORIGINS.map(kind => [kind, 0])) as Record<RouteOriginKind, number>, exits: {} };
          usage.count += 1;
          const origin = originOf(entry);
          usage.origins[origin.kind] += 1;
          if (origin.exit !== undefined) usage.exits[origin.exit] = (usage.exits[origin.exit] ?? 0) + 1;
          transitions.set(key, usage);
          if (windowVisited.has(entry.columnId)) {
            loops += 1;
            const loop = loopRoutes.get(key) ?? { from: entry.fromColumnId, to: entry.columnId, count: 0 };
            loop.count += 1;
            loopRoutes.set(key, loop);
          }
          windowVisited.add(entry.columnId);
        }
        continue;
      }
      if (entry.kind === 'deterministic-execution' && entry.exit !== undefined && within(window, entry.at)) {
        const key = entry.columnId + '\u0000' + entry.exit;
        exits.set(key, (exits.get(key) ?? 0) + 1);
      }
    }
    // The current stay, and how many times this card came back to a stage it had left.
    const last = timeline[timeline.length - 1];
    const currentStage = last?.stage ?? card.columnId;
    const started = last?.at ?? now;
    if (Number.isFinite(started)) parked.push({ taskId: card.taskId, stage: currentStage, since: new Date(started).toISOString(), duration: Math.max(0, now - started) });
    cardLoops.push({ taskId: card.taskId, count: loops });
  }

  const graph = workflowGraph(input.workflow);
  const drawn = new Set(graph.connections.map(connection => connection.from + '\u0000' + connection.to));
  const usedRoutes = new Set(transitions.keys());
  const unusedRoutes = graph.connections
    .filter(connection => !usedRoutes.has(connection.from + '\u0000' + connection.to))
    .map(connection => ({ from: connection.from, to: connection.to }));
  const unusedExits = configuredExits.filter(exit => !exits.has(exit.stage + '\u0000' + exit.exit));

  const stageUsage: StageUsage[] = input.workflow.columns.map(column => {
    const stays = dwell.get(column.id) ?? [];
    const here = parked.filter(card => card.stage === column.id);
    return {
      stage: column.id,
      entries: entries.get(column.id) ?? 0,
      mean: stays.length === 0 ? 0 : round(stays.reduce((sum, value) => sum + value, 0) / stays.length),
      p90: percentile(stays, 0.9),
      now: here.length,
      oldest: here.reduce((longest, card) => Math.max(longest, card.duration), 0),
    };
  });

  const loopTotal = cardLoops.reduce((sum, entry) => sum + entry.count, 0);
  return {
    window: { since: input.options.since, until: input.options.until, ...(input.options.projectIds === undefined ? {} : { projectIds: [...input.options.projectIds] }) },
    transitions: [...transitions.values()].sort((left, right) => right.count - left.count || left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
    exits: [...exits.entries()].map(([key, count]) => {
      const [stage, exit] = key.split('\u0000') as [string, string];
      return { stage, exit, count };
    }).sort((left, right) => right.count - left.count || left.stage.localeCompare(right.stage) || left.exit.localeCompare(right.exit)),
    stages: stageUsage,
    parked: parked.sort((left, right) => right.duration - left.duration),
    loops: {
      mean: cardLoops.length === 0 ? 0 : Math.round((loopTotal / cardLoops.length) * 100) / 100,
      max: cardLoops.reduce((highest, entry) => Math.max(highest, entry.count), 0),
      cards: cardLoops.map(entry => ({ ...entry })),
      routes: [...loopRoutes.values()].sort((left, right) => right.count - left.count),
    },
    unused: { routes: unusedRoutes, exits: unusedExits },
  };
}