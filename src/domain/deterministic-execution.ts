import type { DeterministicControl, DeterministicDefinition, DeterministicHandoff } from '../shared/deterministic.js';
import type { Problem, TaskStageEntry } from '../shared/types.js';
import type { TaskHistoryEntry } from '../shared/task-history.js';
import { deterministicEqual } from './deterministic-definition.js';
import { declaredParameterNames, missingParameterNames } from './deterministic-parameters.js';
import { holdAction } from './deterministic-hold.js';

/** How many settled facts one diagnostic read returns before it counts the rest. */
export const EXECUTION_HISTORY_LIMIT = 5;

/** One settled execution or handoff fact, without the record's extra bookkeeping. */
export interface ExecutionHistoryFact {
  readonly at: string;
  readonly kind: 'execution' | 'handoff';
  readonly outcome: 'completed' | 'stopped' | 'failed' | 'accepted';
  readonly exit?: string;
  readonly message?: string;
  readonly fromColumnId?: string;
  readonly columnId: string;
  readonly errorCode?: string;
}

/** The destination a saved result names, and whether it is still the same stage. */
export interface ExecutionDestination {
  readonly columnId: string;
  readonly stageName?: string;
  /** False when the captured stage identity no longer matches the authored stage. */
  readonly resolved: boolean;
}

/** The scripted execution state one task reports to a reader. */
export interface ExecutionRead {
  readonly taskId: string;
  /** False when the host cannot run scripted steps; the stored phase is still reported. */
  readonly available: boolean;
  readonly stage: { readonly columnId: string; readonly name: string; readonly entryId: string; readonly stageIdentity: string; readonly enteredAt: string } | null;
  readonly execution: {
    readonly phase: DeterministicControl['phase'];
    readonly startedAt: string;
    readonly attempt: number;
    readonly restartCount: number;
    /** False once the stage entry was replaced; the record is then historical. */
    readonly owned: boolean;
    readonly declaredParameters: readonly string[];
    readonly missingParameters: readonly string[];
    readonly parameters?: Readonly<Record<string, string>>;
    readonly version?: { readonly fingerprint: string; readonly language: string; readonly directory: string; readonly source: 'inline' | 'file' };
    readonly result?: {
      readonly exit: string;
      readonly message: string;
      readonly at: string;
      readonly destination?: ExecutionDestination;
      readonly deliveryStatus?: 'pending' | 'accepted' | 'failed';
      readonly synthetic?: boolean;
      readonly error?: Problem;
    };
    readonly hold?: {
      readonly code: string;
      readonly at: string;
      readonly pending?: readonly string[];
      readonly background?: readonly { readonly kind: string; readonly id?: string; readonly label: string }[];
      /** The action that clears the hold, in the same words the drawer uses. */
      readonly action: string;
    };
    readonly error?: Problem;
    readonly savedVersionChanged: boolean;
  } | null;
  readonly handoff: {
    readonly id: string;
    readonly exit: string;
    readonly message: string;
    readonly at: string;
    readonly fromColumnId: string;
    readonly columnId: string;
    readonly acceptedAt?: string;
    readonly error?: Problem;
    readonly sessionId?: string;
  } | null;
  readonly history: readonly ExecutionHistoryFact[];
  readonly historyOmitted: number;
}

/** The durable facts one diagnostic read needs; nothing here is read from a live process. */
export interface ExecutionReadInput {
  readonly taskId: string;
  readonly available: boolean;
  readonly stageEntry?: TaskStageEntry;
  readonly control?: DeterministicControl;
  readonly handoff?: DeterministicHandoff;
  readonly history?: readonly TaskHistoryEntry[];
  /** The stage the task is in now, as the board authors it. */
  readonly stage?: { readonly id: string; readonly name: string; readonly identity?: string; readonly deterministic?: DeterministicDefinition };
  /** Every stage of the board, by column id, with the identity a captured target is matched against. */
  readonly destinations?: Readonly<Record<string, { readonly name: string; readonly identity: string }>>;
}

function destinationOf(control: DeterministicControl, destinations: ExecutionReadInput['destinations']): ExecutionDestination | undefined {
  const target = control.result?.target;
  if (target === undefined) return undefined;
  const stage = destinations?.[target.columnId];
  return {
    columnId: target.columnId,
    ...(stage === undefined ? {} : { stageName: stage.name }),
    resolved: stage !== undefined && stage.identity === target.stageIdentity,
  };
}

function historyFacts(rows: readonly TaskHistoryEntry[], limit: number): { facts: ExecutionHistoryFact[]; omitted: number } {
  const relevant: ExecutionHistoryFact[] = [];
  for (const row of rows) {
    if (row.kind === 'deterministic-execution') {
      relevant.push({
        at: row.at, kind: 'execution', outcome: row.outcome, columnId: row.columnId,
        ...(row.exit === undefined ? {} : { exit: row.exit }),
        ...(row.message === undefined ? {} : { message: row.message }),
        ...(row.error === undefined ? {} : { errorCode: row.error.code }),
      });
      continue;
    }
    if (row.kind === 'deterministic-handoff') {
      relevant.push({
        at: row.at, kind: 'handoff', outcome: row.outcome, columnId: row.columnId,
        fromColumnId: row.fromColumnId, exit: row.exit, message: row.message,
        ...(row.error === undefined ? {} : { errorCode: row.error.code }),
      });
    }
  }
  const newest = [...relevant].reverse();
  return { facts: newest.slice(0, limit), omitted: Math.max(0, newest.length - limit) };
}

/**
 * One task's scripted execution state as a reader sees it.
 *
 * The read describes durable state only: a live process is never inspected, and a
 * missing execution is reported as missing instead of as a failure. A host that
 * cannot run scripted steps keeps the stored phase and says so, which is why the
 * phase is reported rather than rewritten to a failure.
 */
export function readExecutionState(input: ExecutionReadInput): ExecutionRead {
  const control = input.control;
  const owned = control !== undefined && input.stageEntry?.id === control.entryId && input.stageEntry.stageIdentity === control.stageIdentity;
  const declared = control === undefined ? [] : declaredParameterNames(control.definition.params);
  const history = historyFacts(input.history ?? [], EXECUTION_HISTORY_LIMIT);
  const stage = input.stageEntry === undefined ? null : {
    columnId: input.stageEntry.columnId,
    name: input.stage?.name ?? input.stageEntry.columnId,
    entryId: input.stageEntry.id,
    stageIdentity: input.stageEntry.stageIdentity,
    enteredAt: input.stageEntry.enteredAt,
  };
  const handoff = input.handoff === undefined ? null : {
    id: input.handoff.id, exit: input.handoff.exit, message: input.handoff.message, at: input.handoff.at,
    fromColumnId: input.handoff.fromColumnId, columnId: input.handoff.columnId,
    ...(input.handoff.acceptedAt === undefined ? {} : { acceptedAt: input.handoff.acceptedAt }),
    ...(input.handoff.error === undefined ? {} : { error: input.handoff.error }),
    ...(input.handoff.sessionId === undefined ? {} : { sessionId: input.handoff.sessionId }),
  };
  if (control === undefined) return { taskId: input.taskId, available: input.available, stage, execution: null, handoff, history: history.facts, historyOmitted: history.omitted };
  const result = control.result;
  const destination = destinationOf(control, input.destinations);
  const execution = {
    phase: control.phase,
    startedAt: control.startedAt,
    attempt: control.attempt,
    restartCount: control.restartCount,
    owned,
    declaredParameters: declared,
    missingParameters: missingParameterNames(declared, control.parameters),
    ...(control.parameters === undefined ? {} : { parameters: { ...control.parameters } }),
    ...(control.capture === undefined ? {} : { version: {
      fingerprint: control.capture.fingerprint, language: control.capture.language,
      directory: control.capture.directory, source: control.capture.source.kind,
    } }),
    ...(result === undefined ? {} : { result: {
      exit: result.exit, message: result.message, at: result.at,
      ...(destination === undefined ? {} : { destination }),
      ...(result.deliveryStatus === undefined ? {} : { deliveryStatus: result.deliveryStatus }),
      ...(result.synthetic === true ? { synthetic: true } : {}),
      ...(result.error === undefined ? {} : { error: result.error }),
    } }),
    ...(control.hold === undefined ? {} : { hold: {
      code: control.hold.code, at: control.hold.at,
      ...(control.hold.pending === undefined ? {} : { pending: [...control.hold.pending] }),
      ...(control.hold.background === undefined ? {} : { background: control.hold.background.map(fact => ({ kind: fact.kind, ...(fact.id === undefined ? {} : { id: fact.id }), label: fact.label })) }),
      action: holdAction(control.hold),
    } }),
    ...(control.error === undefined ? {} : { error: control.error }),
    savedVersionChanged: input.stage?.deterministic === undefined || !deterministicEqual(input.stage.deterministic, control.definition),
  };
  return { taskId: input.taskId, available: input.available, stage, execution, handoff, history: history.facts, historyOmitted: history.omitted };
}
