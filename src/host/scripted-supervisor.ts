import { randomUUID } from 'node:crypto';
import type { ScriptedCapture, ScriptedControl, ScriptedHold, ScriptedInput, ScriptedResult, StepCompletion } from '../shared/scripted.js';
import type { HubTask, Problem } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import type { LocatedTask } from './hub-repository.js';
import { captureScriptedTargets } from '../domain/scripted-state.js';
import { boundedRedactedParameters, declaredParameterNames, declaredParameterValues, missingParameterNames, validateParameterValues } from '../domain/scripted-parameters.js';
import { recordScriptedExecution, recordScriptedHandoff } from '../domain/task-history/record.js';
import { classifyFailureCode, failureDetail, failureDetailValues } from '../domain/scripted-failure.js';
import type { FailureDetail } from '../shared/scripted-failure.js';
import { failureMessage, providerFailureMessage } from '../domain/scripted-failure-message.js';
import { settleFailureRoute } from '../domain/scripted-failure-settlement.js';
import { validateCompletion } from '../domain/scripted-completion.js';
import { PARAMETER_LIMITS } from '../domain/scripted-definition.js';
import { bounded } from '../shared/bounded.js';
import { redactExact, redactRecord } from '../shared/redact.js';
import { buildScriptedInput } from './scripted/input.js';
import { sameScriptedHold } from '../domain/scripted-hold.js';

export interface ScriptedIdentity { taskId: string; entryId: string; executionId: string; attemptId?: string }
export interface SupervisorRequest { located: LocatedTask; control: ScriptedControl; signal: AbortSignal }
export interface SupervisorExecution extends SupervisorRequest { capture: ScriptedCapture; code: string; variables: Readonly<Record<string, string>>; input: ScriptedInput }
export interface SupervisorRoute extends SupervisorRequest { capture: ScriptedCapture; result: ScriptedResult }
/** A refusal carries the bounded reason the drawer presents; absent only when the request was already stale. */
export type SupervisorRouteOutcome = { status: 'held'; hold?: ScriptedHold } | { status: 'accepted' } | { status: 'failed'; error: Problem };

/** All control changes belong to the existing durable task transaction, not a run database. */
export interface SupervisorPorts {
  locate(taskId: string): LocatedTask | undefined;
  all(): Iterable<LocatedTask>;
  transact<T>(taskId: string, change: (task: HubTask, located: LocatedTask) => T): Promise<T>;
  capture: {
    /** Write and verify immutable primary bytes before returning their reference. */
    capture(request: SupervisorRequest): Promise<ScriptedCapture>;
    /** Verify the immutable reference; never reread a captured external primary file. */
    load(capture: ScriptedCapture): Promise<string>;
    /** Remove only task-associated unreferenced blobs, after owned work is drained. */
    removeTask?(taskId: string, referencedSourceRefs: readonly string[]): Promise<void>;
    collectSources?(referencedSourceRefs: readonly string[]): Promise<void>;
    releaseSource?(sourceRef: string): void;
  };
  runtime: {
    /** Fail closed if predecessor ownership cannot be confirmed/reclaimed on recovery. */
    reclaim(request: SupervisorRequest): Promise<void>;
    reclaimTask?(located: LocatedTask): Promise<void>;
    /** Resolves/rejects only after all nested execution has stopped. */
    execute(request: SupervisorExecution): Promise<unknown>;
  };
  trust: {
    isApproved(request: SupervisorRequest & { capture: ScriptedCapture }): Promise<boolean>;
  };
  variable: {
    resolve(request: SupervisorRequest & { capture: ScriptedCapture }): Promise<Readonly<Record<string, string>>>;
    set?(located: LocatedTask, stageIdentity: string, name: string, value: string | null): Promise<void>;
  };
  /** Atomically validate current authority, consume result and place exact captured stable target.
   * Native delivery admission is entry/delivery-bound. A hold returns without waiting for user work. */
  route(request: SupervisorRoute): Promise<SupervisorRouteOutcome>;
  canStart?(taskId: string): boolean;
  /** Delay before the one coalesced re-check of a refused delivery; a test shortens it. */
  recheckMs?: number;
  report?(error: unknown): void;
  notify?(): void;
  id?(): string;
  now?(): string;
}

interface Owner { located: LocatedTask; control: ScriptedControl; abort: AbortController; done: Promise<void>; rerun: boolean; pendingAttemptId?: string }
class SupervisorPersistenceFailure extends Error { constructor(readonly cause: unknown) { super('The scripted task transaction could not be persisted.'); } }
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC = 4096;
const DEFAULT_RECHECK_MS = 5_000;

function current(located: LocatedTask | undefined, expected: ScriptedControl): boolean {
  const task = located?.task;
  return task?.stageEntry?.id === expected.entryId && task.stageEntry.stageIdentity === expected.stageIdentity
    && task.scripted?.entryId === expected.entryId && task.scripted.executionId === expected.executionId
    && task.scripted.attemptId === expected.attemptId;
}
/** The bounded values a settled execution actually used, never a stored undeclared name. */
function historyParameters(control: Pick<ScriptedControl, 'parameters' | 'capture' | 'attempt'>): { parameters?: Record<string, string> } {
  // A superseded entry that never reached an attempt did not use its values.
  if (control.attempt === 0 || control.parameters === undefined) return {};
  const used = declaredParameterValues(control.capture?.params ?? Object.keys(control.parameters), control.parameters);
  return Object.keys(used).length === 0 ? {} : { parameters: used };
}
function safeText(value: string, secrets: Readonly<Record<string, string>>, limit: number): string {
  return bounded(redactExact(value, Object.values(secrets)), limit);
}
/** The bounded line logged when a refusal reason appears or changes; never per attempt. */
function holdDiagnostic(hold: ScriptedHold): string {
  const parts: string[] = [hold.code];
  if (hold.pending !== undefined && hold.pending.length > 0) parts.push('pending ' + hold.pending.join(', '));
  if (hold.background !== undefined && hold.background.length > 0) parts.push('background ' + hold.background.map(fact => fact.kind + (fact.id === undefined ? '' : ' ' + fact.id) + ' "' + fact.label + '"').join('; '));
  return bounded('Saved result delivery held: ' + parts.join(' · '), MAX_DIAGNOSTIC);
}
function completion(value: unknown): StepCompletion {
  const result = validateCompletion(value);
  if (!result.ok) throw new KanbanError(result.code, result.message);
  return result.completion;
}
/** Redact one sent value and keep it inside the accepted value bound. */
function safeParameter(value: string, secrets: Readonly<Record<string, string>>): string {
  const redacted = redactExact(value, Object.values(secrets));
  return redacted.length > PARAMETER_LIMITS.valueLength ? '[REDACTED]' : redacted;
}

/** One owned lifetime per task; no long-lived work runs in the application command lane. */
export class ScriptedSupervisor {
  private readonly owners = new Map<string, Owner>();
  private readonly uncertainOwners = new Map<string, Owner>();
  private disposed = false;
  private sourceTail: Promise<void> = Promise.resolve();
  private readonly id: () => string;
  private readonly now: () => string;
  private readonly recheckMs: number;
  private readonly rechecks = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ports: SupervisorPorts) {
    this.id = ports.id ?? randomUUID; this.now = ports.now ?? (() => new Date().toISOString());
    this.recheckMs = ports.recheckMs ?? DEFAULT_RECHECK_MS;
  }

  start(): void { this.sync(); }
  sync(): void {
    if (this.disposed) return;
    const tasks = new Set<string>();
    for (const located of this.ports.all()) { tasks.add(located.task.id); this.reconcile(located.task.id); }
    for (const [taskId, owner] of this.owners) if (!tasks.has(taskId)) owner.abort.abort();
    // A task removed or replaced outside this runtime must not keep a delivery timer alive.
    for (const taskId of [...this.rechecks.keys()]) if (!tasks.has(taskId)) this.clearRecheck(taskId);
  }

  /** Schedule reconciliation, including after trust changes, placement or guard release. */
  reconcile(taskId: string): void {
    if (this.disposed) return;
    const owner = this.owners.get(taskId);
    const located = this.ports.locate(taskId);
    if (owner) {
      if ((!current(located, owner.control) && !(owner.pendingAttemptId && current(located, { ...owner.control, attemptId: owner.pendingAttemptId }))) || ['stopping', 'stopped'].includes(located?.task.scripted?.phase ?? '')) {
        owner.rerun = true; owner.abort.abort();
      }
      return;
    }
    const control = located?.task.scripted;
    if (this.ports.canStart?.(taskId) === false) return;
    if (!control || !current(located, control) || ['stopped', 'failed'].includes(control.phase) || control.result?.deliveryStatus === 'accepted' || control.result?.deliveryStatus === 'failed') { this.clearRecheck(taskId); return; }
    const next: Owner = { located: located!, control: structuredClone(control), abort: new AbortController(), done: Promise.resolve(), rerun: false };
    this.owners.set(taskId, next);
    next.done = Promise.resolve().then(() => this.drive(taskId, next)).catch(error => this.ports.report?.(error)).finally(async () => {
      if (next.abort.signal.aborted && next.control.attempt > 0) {
        try {
          const value = this.ports.locate(taskId) ?? next.located;
          await this.ports.runtime.reclaim({ located: value, control: structuredClone(next.control), signal: new AbortController().signal });
        } catch (error) {
          this.ports.report?.(error);
          this.uncertainOwners.set(taskId, next);
          next.rerun = false;
          try {
            await this.ports.transact(taskId, task => {
              if (task.scripted && !['stopped', 'failed'].includes(task.scripted.phase)) {
                task.scripted.phase = 'failed';
                task.scripted.error = { code: 'EXECUTION_OWNERSHIP_UNCERTAIN', message: safeText('The previous execution could not be confirmed stopped. ' + (error instanceof Error ? error.message : String(error)), {}, MAX_DIAGNOSTIC) };
              }
            });
          } catch (error) { this.ports.report?.(error); }
        }
      }
      this.owners.delete(taskId);
      this.ports.notify?.();
      if (next.rerun && !this.disposed) this.reconcile(taskId);
    });
    this.ports.notify?.();
  }

  /**
   * Wake the entries of one board, stage, and version after approval. A waiting
   * owner whose trust check is still draining is asked to run once more; an
   * active owner is never restarted.
   */
  wakeWaiting(filter: { boardId: string; stageIdentity: string; fingerprint: string }): void {
    if (this.disposed) return;
    // A capture can exist only in the owner's in-memory control while its trust
    // check is in flight; match that owner before the task row carries it.
    for (const [taskId, owner] of this.owners) {
      if (owner.control.capture?.fingerprint !== filter.fingerprint || (owner.control.phase !== 'awaiting-trust' && owner.control.phase !== 'capture-pending')) continue;
      const located = this.ports.locate(taskId);
      if (located?.task.boardId !== filter.boardId || located.task.stageEntry?.stageIdentity !== filter.stageIdentity) continue;
      owner.rerun = true;
    }
    for (const located of this.ports.all()) {
      if (located.task.boardId !== filter.boardId || located.task.stageEntry?.stageIdentity !== filter.stageIdentity) continue;
      const control = located.task.scripted;
      if (control?.capture?.fingerprint !== filter.fingerprint || (control.phase !== 'awaiting-trust' && control.phase !== 'capture-pending')) continue;
      const owner = this.owners.get(located.task.id);
      if (owner) owner.rerun = true;
      else this.reconcile(located.task.id);
    }
  }

  /** Retry a held result after an external guard changes, even if its current drain is finishing. */
  wake(taskId: string): void {
    // A real edge supersedes the scheduled safety re-check for this task.
    this.clearRecheck(taskId);
    const owner = this.owners.get(taskId);
    if (owner) { if (this.ports.locate(taskId)?.task.scripted?.result) owner.rerun = true; }
    else this.reconcile(taskId);
  }
  isRunning(taskId: string): boolean { return this.owners.has(taskId); }
  hasContextOwner(taskId: string): boolean { return this.owners.has(taskId) || this.uncertainOwners.has(taskId); }

  async stop(identity: ScriptedIdentity): Promise<void> {
    const expected = this.require(identity);
    const revoked = await this.ports.transact(identity.taskId, (task, located) => {
      if (!current(located, expected) || task.scripted?.result?.deliveryStatus === 'accepted') return false;
      task.scripted!.phase = 'stopping';
      return true;
    });
    if (!revoked) throw new KanbanError('STALE_EXECUTION', 'This execution no longer owns the stage entry.');
    const candidate = this.owners.get(identity.taskId);
    const owner = candidate?.control.executionId === expected.executionId && candidate.control.entryId === expected.entryId ? candidate : undefined;
    owner?.abort.abort();
    if (owner) await owner.done;
    else if (expected.attempt > 0) await this.ports.runtime.reclaim({ located: this.ports.locate(identity.taskId)!, control: expected, signal: new AbortController().signal });
    const latest = this.ports.locate(identity.taskId);
    if (current(latest, expected) && latest?.task.scripted?.error?.code === 'EXECUTION_OWNERSHIP_UNCERTAIN') throw new KanbanError('EXECUTION_OWNERSHIP_UNCERTAIN', 'The previous execution has not confirmed cleanup; the context cannot be changed safely.');
    await this.ports.transact(identity.taskId, (task, located) => {
      if (current(located, expected) && task.scripted?.phase === 'stopping') {
        task.scripted.phase = 'stopped';
        recordScriptedExecution(task, { at: this.now(), executionId: expected.executionId, columnId: task.columnId, outcome: 'stopped', ...historyParameters(expected) });
      }
    });
    this.clearRecheck(identity.taskId);
    this.ports.notify?.();
  }

  async play(taskId: string, entryId: string): Promise<void> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The execution supervisor is shut down.');
    const previous = this.ports.locate(taskId);
    if (['EXECUTION_OWNERSHIP_UNCERTAIN', 'OWNERSHIP_UNCERTAIN', 'OWNERSHIP_CONFLICT'].includes(previous?.task.scripted?.error?.code ?? '') && previous?.task.scripted) {
      await this.ports.runtime.reclaim({ located: previous, control: previous.task.scripted, signal: new AbortController().signal });
    }
    await this.ports.transact(taskId, (task, located) => {
      if (this.ports.canStart?.(taskId) === false) throw new KanbanError('CONTEXT_ADMISSION_PENDING', 'A task context operation is being admitted.');
      if (task.stageEntry?.id !== entryId) throw new KanbanError('STALE_EXECUTION', 'This stage entry has been replaced.');
      const column = located.board.workflow.columns.find(column => column.id === task.columnId);
      const definition = column?.scripted;
      if (!definition || !column) throw new KanbanError('SCRIPTED_CONFIGURATION_REQUIRED', 'Configure a script or change stages before pressing Play.');
      const superseded = task.scripted;
      if (superseded && !superseded.result && !['stopped', 'failed'].includes(superseded.phase)) recordScriptedExecution(task, { at: this.now(), executionId: superseded.executionId, columnId: task.columnId, outcome: 'stopped', ...historyParameters(superseded) });
      task.scripted = { entryId, executionId: this.id(), stageIdentity: task.stageEntry.stageIdentity, definition: structuredClone(definition), targets: captureScriptedTargets(located.board, column, this.id), ...(superseded?.parameters === undefined ? {} : { parameters: { ...superseded.parameters } }), phase: 'capture-pending', startedAt: this.now(), attempt: 0, restartCount: 0 };
    });
    // A new execution supersedes any scheduled delivery re-check for this task.
    this.clearRecheck(taskId);
    // Reconciliation aborts a predecessor, but launches only after its full drain.
    this.reconcile(taskId);
  }

  /** Must finish before deleting/relocating a task directory. Refused moves do not call this. */
  async beforeContextChange(taskId: string): Promise<void> {
    this.clearRecheck(taskId);
    const predecessor = this.owners.get(taskId) ?? this.uncertainOwners.get(taskId);
    if (predecessor) {
      predecessor.abort.abort(); await predecessor.done;
      const unresolved = this.uncertainOwners.get(taskId);
      if (unresolved) {
        await this.ports.runtime.reclaim({ located: this.ports.locate(taskId) ?? unresolved.located, control: unresolved.control, signal: new AbortController().signal });
        if (this.uncertainOwners.get(taskId) === unresolved) this.uncertainOwners.delete(taskId);
      }
    }
    const located = this.ports.locate(taskId);
    const control = located?.task.scripted;
    if (located && !control) await this.ports.runtime.reclaimTask?.(located);
    if (located && control && ['EXECUTION_OWNERSHIP_UNCERTAIN', 'OWNERSHIP_UNCERTAIN', 'OWNERSHIP_CONFLICT'].includes(control.error?.code ?? '')) {
      await this.ports.runtime.reclaim({ located, control, signal: new AbortController().signal });
      const confirmed = await this.ports.transact(taskId, (task, value) => {
        if (!current(value, control) || task.scripted?.phase !== 'failed' || !['EXECUTION_OWNERSHIP_UNCERTAIN', 'OWNERSHIP_UNCERTAIN', 'OWNERSHIP_CONFLICT'].includes(task.scripted.error?.code ?? '')) return false;
        task.scripted.phase = 'stopped';
        delete task.scripted.error;
        return true;
      });
      if (!confirmed) throw new KanbanError('STALE_EXECUTION', 'The execution changed while confirming native cleanup; retry the context operation.');
    }
    const latest = this.ports.locate(taskId);
    if (latest?.task.scripted?.executionId !== control?.executionId || latest?.task.stageEntry?.id !== located?.task.stageEntry?.id) throw new KanbanError('STALE_EXECUTION', 'The execution changed while preparing its context; retry the context operation.');
    if (control && current(latest, control) && !['stopped', 'failed'].includes(control.phase) && control.result?.deliveryStatus !== 'accepted') {
      await this.stop({ taskId, entryId: control.entryId, executionId: control.executionId });
    } else {
      const owner = this.owners.get(taskId); owner?.abort.abort(); if (owner) await owner.done;
    }
  }

  async removeTask(taskId: string): Promise<void> {
    this.clearRecheck(taskId);
    await this.beforeContextChange(taskId);
    await this.withSources(async () => {
      const refs = this.sourceReferences();
      await this.ports.capture.removeTask?.(taskId, refs);
      await this.ports.capture.collectSources?.(refs);
    });
  }

  /** Run after committed deletion and owned drain. In-flight capture admission shares this short source lane. */
  async collectSources(): Promise<void> {
    await this.withSources(async () => { await this.ports.capture.collectSources?.(this.sourceReferences()); });
  }

  private sourceReferences(): string[] {
    return [...new Set([
      ...[...this.ports.all()].flatMap(value => value.task.scripted?.capture?.sourceRef ? [value.task.scripted.capture.sourceRef] : []),
      ...[...this.owners.values()].flatMap(value => value.control.capture?.sourceRef ? [value.control.capture.sourceRef] : []),
    ])];
  }

  private withSources<T>(work: () => Promise<T>): Promise<T> {
    const result = this.sourceTail.then(work);
    this.sourceTail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Shutdown cancels processes but deliberately retains recoverable active intent. */
  dispose(): void { this.disposed = true; this.clearRechecks(); for (const owner of this.owners.values()) owner.abort.abort(); }
  async settle(): Promise<void> { while (this.owners.size) await Promise.allSettled([...this.owners.values()].map(owner => owner.done)); await this.sourceTail; this.clearRechecks(); }

  async variable(taskId: string, name: string, value: string | null, expectedStageIdentity?: string): Promise<void> {
    const located = this.ports.locate(taskId);
    const column = located?.board.workflow.columns.find(item => item.id === located.task.columnId);
    const stageIdentity = located?.task.stageEntry?.stageIdentity ?? located?.board.localStageIdentities?.[located.task.columnId] ?? column?.key;
    if (!located || !stageIdentity || !this.ports.variable.set) throw new KanbanError('VARIABLE_UNAVAILABLE', 'Native local variable configuration is unavailable for this stable stage scope.');
    // A dialog can outlive a move or a stage replacement; never write the value
    // the user reviewed into whichever scope happens to be current now.
    if (expectedStageIdentity !== undefined && expectedStageIdentity !== stageIdentity) throw new KanbanError('STALE_STAGE', 'The task moved to another stage before this value could be saved.');
    await this.ports.variable.set(located, stageIdentity, name, value);
  }

  /**
   * Replace the values bound to the current entry. No trust, no code, no history:
   * a later Play admits a new execution with the saved values.
   */
  async parameters(taskId: string, entryId: string, values: unknown): Promise<void> {
    const located = this.ports.locate(taskId); const control = located?.task.scripted;
    if (!located || !control || !current(located, control) || control.entryId !== entryId || located.task.stageEntry?.id !== entryId) throw new KanbanError('STALE_EXECUTION', 'This entry no longer owns the stage entry.');
    if (['active', 'stopping'].includes(control.phase)) throw new KanbanError('EXECUTION_ACTIVE', 'Stop the execution before editing its parameters.');
    const column = located.board.workflow.columns.find(value => value.id === located.task.columnId);
    if (column?.scripted === undefined) throw new KanbanError('SCRIPTED_CONFIGURATION_REQUIRED', 'Configure a script or change stages before editing parameters.');
    const checked = validateParameterValues(declaredParameterNames(column.scripted.params), values);
    if (!checked.ok) throw new KanbanError('INVALID_PARAMETERS', checked.message);
    await this.ports.transact(taskId, (task, value) => {
      if (!current(value, control) || value.task.stageEntry?.id !== entryId || task.scripted === undefined) throw new KanbanError('STALE_EXECUTION', 'The entry was replaced before its values could be saved.');
      task.scripted.parameters = { ...checked.values };
    });
    this.ports.notify?.();
  }

  /** Explicit delivery retry retains its result/delivery identity and never runs source code. */
  async retryDelivery(identity: ScriptedIdentity): Promise<void> {
    const expected = this.require(identity);
    await this.ports.transact(identity.taskId, (task, located) => {
      const result = task.scripted?.result;
      if (!current(located, expected) || !result?.target || (result.deliveryStatus !== 'failed' && result.deliveryStatus !== 'pending')) throw new KanbanError('STALE_EXECUTION', 'No saved result delivery is available here.');
      task.scripted!.phase = 'result-ready'; task.scripted!.result!.deliveryStatus = 'pending';
      delete task.scripted!.error; delete task.scripted!.result!.error;
    });
    this.reconcile(identity.taskId);
  }

  private require(identity: ScriptedIdentity): ScriptedControl {
    const located = this.ports.locate(identity.taskId); const control = located?.task.scripted;
    if (!control || !current(located, control) || control.entryId !== identity.entryId || control.executionId !== identity.executionId || (identity.attemptId !== undefined && identity.attemptId !== control.attemptId)) throw new KanbanError('STALE_EXECUTION', 'This execution no longer owns the stage entry.');
    return structuredClone(control);
  }

  private async persist<T>(taskId: string, change: (task: HubTask, located: LocatedTask) => T): Promise<T> {
    try { return await this.ports.transact(taskId, change); }
    catch (error) { throw new SupervisorPersistenceFailure(error); }
  }

  private valid(taskId: string, owner: Owner): LocatedTask | undefined {
    const located = this.ports.locate(taskId);
    return !this.disposed && !owner.abort.signal.aborted && current(located, owner.control) ? located : undefined;
  }

  private async drive(taskId: string, owner: Owner): Promise<void> {
    let located = this.valid(taskId, owner); if (!located) return;
    if (owner.control.phase === 'stopping') {
      if (owner.control.attempt > 0) await this.ports.runtime.reclaim({ located, control: structuredClone(owner.control), signal: owner.abort.signal });
      await this.persist(taskId, (task, value) => {
        if (current(value, owner.control) && task.scripted?.phase === 'stopping') {
          task.scripted.phase = 'stopped';
          recordScriptedExecution(task, { at: this.now(), executionId: owner.control.executionId, columnId: task.columnId, outcome: 'stopped', ...historyParameters(owner.control) });
        }
      });
      return;
    }
    if (owner.control.result) { await this.deliver(taskId, owner); return; }
    if (owner.control.attempt === 0 && (located.task.operation || located.project.operation || (located.task.worktree && located.task.worktree.status !== 'ready'))) return;
    let trusted = false;
    let secrets: Readonly<Record<string, string>> = {};
    let output: StepCompletion | undefined;
    let synthetic: Problem | undefined;
    try {
      if (owner.control.phase === 'capture-pending') {
        const capture = await this.withSources(async () => {
          const latest = this.valid(taskId, owner); if (!latest) return;
          const captured = await this.ports.capture.capture({ located: latest, control: structuredClone(owner.control), signal: owner.abort.signal });
          try {
            if (!this.valid(taskId, owner)) return;
            const saved = await this.persist(taskId, (task, value) => {
              if (!current(value, owner.control) || task.scripted?.phase !== 'capture-pending') return false;
              task.scripted.capture = structuredClone(captured); task.scripted.phase = 'awaiting-trust'; return true;
            });
            return saved ? captured : undefined;
          } finally {
            this.ports.capture.releaseSource?.(captured.sourceRef);
            await this.ports.capture.collectSources?.(this.sourceReferences());
          }
        });
        if (!capture) return;
        owner.control = { ...owner.control, capture: structuredClone(capture), phase: 'awaiting-trust' };
      }
      located = this.valid(taskId, owner); if (!located) return;
      const capture = owner.control.capture;
      if (!capture) throw new KanbanError('CAPTURE_MISSING', 'The immutable executable capture is missing; use Play to capture a new version.');
      // Parameters are an entry property, so their completeness is evaluated before
      // the code review gate: both gaps can then be reported at once.
      const missing = missingParameterNames(capture.params, owner.control.parameters);
      if (missing.length > 0) throw new KanbanError('PARAMETERS_REQUIRED', 'Missing required parameter' + (missing.length === 1 ? '' : 's') + ': ' + missing.join(', ') + '. Declare them on the transition into this stage or edit the entry parameters.');
      trusted = await this.ports.trust.isApproved({ located, control: structuredClone(owner.control), capture, signal: owner.abort.signal });
      if (!this.valid(taskId, owner)) return;
      if (!trusted) {
        await this.persist(taskId, (task, value) => { if (current(value, owner.control) && task.scripted?.phase === 'active') task.scripted.phase = 'awaiting-trust'; });
        return;
      }
      const code = await this.ports.capture.load(capture);
      located = this.valid(taskId, owner); if (!located) return;
      // Recovery must confirm exclusive native ownership before replacing the attempt.
      const recovering = owner.control.attempt > 0;
      if (recovering) await this.ports.runtime.reclaim({ located, control: structuredClone(owner.control), signal: owner.abort.signal });
      located = this.valid(taskId, owner); if (!located) return;
      const selectedDirectory = capture.directory === 'project' ? located.project.projectPath : located.task.effectiveCwd;
      if (selectedDirectory !== capture.executionDirectory || located.task.operation || located.project.operation || (located.task.worktree && located.task.worktree.status !== 'ready')) throw new KanbanError('EXECUTION_CONTEXT_CHANGED', 'The captured execution directory is unavailable or changed; resolve the binding before pressing Play.');
      secrets = await this.ports.variable.resolve({ located, control: structuredClone(owner.control), capture, signal: owner.abort.signal });
      located = this.valid(taskId, owner); if (!located) return;
      if (Object.keys(secrets).some(name => !capture.env.includes(name)) || capture.env.some(name => !Object.hasOwn(secrets, name))) throw new KanbanError('VARIABLE_SCOPE_INVALID', 'Native variables do not match the approved environment names.');
      const attemptId = this.id();
      owner.pendingAttemptId = attemptId;
      const admitted = await this.persist(taskId, (task, value) => {
        if (!current(value, owner.control) || !['awaiting-trust', 'active'].includes(task.scripted!.phase)) return false;
        task.scripted!.phase = 'active'; task.scripted!.attemptId = attemptId;
        task.scripted!.attempt += 1; if (recovering) task.scripted!.restartCount += 1;
        const handoff = task.scriptedHandoff;
        if (handoff && handoff.entryId === task.stageEntry?.id && handoff.acceptedAt === undefined) {
          handoff.acceptedAt = this.now();
          recordScriptedHandoff(task, { at: handoff.acceptedAt, deliveryId: handoff.id, executionId: handoff.executionId, fromColumnId: handoff.fromColumnId, columnId: task.columnId, outcome: 'accepted', exit: handoff.exit, message: handoff.message, ...(handoff.params === undefined ? {} : { parameters: handoff.params }) });
        }
        return true;
      });
      if (!admitted) return;
      owner.control = { ...owner.control, phase: 'active', attemptId, attempt: owner.control.attempt + 1, restartCount: owner.control.restartCount + (recovering ? 1 : 0) };
      delete owner.pendingAttemptId;
      located = this.valid(taskId, owner); if (!located) return;
      const raw = await this.ports.runtime.execute({ located, control: structuredClone(owner.control), capture, code, variables: secrets, signal: owner.abort.signal,
        input: buildScriptedInput(located, owner.control, capture) });
      if (!this.valid(taskId, owner)) return;
      output = completion(raw);
      if (!Object.hasOwn(capture.exits, output.exit)) throw new KanbanError('UNMAPPED_EXIT', 'The program returned an exit that is not mapped in its approved capture.');
    } catch (error) {
      if (error instanceof SupervisorPersistenceFailure) throw error.cause;
      if (!this.valid(taskId, owner)) return;
      const errorCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'SCRIPTED_EXECUTION_FAILED';
      // The runtime already knows the origin; a code that reaches here without one is
      // classified from its code so every settled failure can be routed and presented.
      // Redact the structured detail before the codec bounds it: a value cut by that
      // bound can no longer be matched, so the order matters here too.
      const recorded = failureDetail(redactRecord(error instanceof KanbanError ? error.details : undefined, Object.values(secrets)));
      const origin = recorded?.origin ?? classifyFailureCode(errorCode);
      const raw = error instanceof Error ? error.message : String(error);
      // Redact before any bound: a truncation that cuts a known value leaves a
      // fragment that exact-value matching can no longer recognize.
      const safeRaw = redactExact(raw, Object.values(secrets));
      // A provider's own text never becomes the delivered message: it is kept as the
      // nested cause, and the public sentence comes from the code.
      const provider = origin === 'script' || origin === 'contract' ? undefined : providerFailureMessage(errorCode);
      const detail: FailureDetail = provider !== undefined && recorded?.cause === undefined
        ? { ...(recorded ?? {}), origin, cause: { code: errorCode, message: bounded(safeRaw, MAX_DIAGNOSTIC) } }
        : { ...(recorded ?? {}), origin };
      const diagnostic: Problem = {
        code: errorCode,
        message: safeText(failureMessage({ code: errorCode, origin, message: provider ?? safeRaw, details: detail }), secrets, MAX_DIAGNOSTIC),
        details: redactRecord(failureDetailValues(detail), Object.values(secrets)) ?? failureDetailValues(detail),
      };
      output = undefined;
      if (diagnostic.code === 'TRUST_REQUIRED') {
        await this.persist(taskId, (task, value) => { if (current(value, owner.control) && !['stopping', 'stopped'].includes(task.scripted!.phase)) task.scripted!.phase = 'awaiting-trust'; });
        return;
      }
      // A configuration refusal is not an execution attempt: it never follows the
      // error route, adds no history row, and leaves the entry repairable.
      if (diagnostic.code === 'PARAMETERS_REQUIRED') {
        await this.persist(taskId, (task, value) => { if (current(value, owner.control) && !['stopping', 'stopped'].includes(task.scripted!.phase)) { task.scripted!.phase = 'failed'; task.scripted!.error = diagnostic; } });
        return;
      }
      const captured = owner.control.capture;
      const route = trusted && captured !== undefined ? settleFailureRoute({ code: errorCode, origin, exits: Object.keys(captured.exits) }) : null;
      if (route !== null) {
        output = { exit: route, message: diagnostic.message }; synthetic = diagnostic;
      } else await this.persist(taskId, (task, value) => {
        if (current(value, owner.control) && !['stopping', 'stopped'].includes(task.scripted!.phase)) {
          task.scripted!.phase = 'failed'; task.scripted!.error = diagnostic;
          recordScriptedExecution(task, { at: this.now(), executionId: owner.control.executionId, columnId: task.columnId, outcome: 'failed', error: diagnostic, ...historyParameters(owner.control) });
        }
      });
    }
    // A storage failure is not an executor failure and must never fabricate a second result.
    if (output) await this.saveResult(taskId, owner, output, secrets, synthetic);
    if (this.valid(taskId, owner)?.task.scripted?.result) await this.deliver(taskId, owner);
  }

  private async saveResult(taskId: string, owner: Owner, output: StepCompletion, secrets: Readonly<Record<string, string>>, error?: Problem): Promise<void> {
    const capture = owner.control.capture!;
    const params = output.params === undefined ? undefined : boundedRedactedParameters(Object.fromEntries(Object.entries(output.params).map(([name, value]) => [name, safeParameter(value, secrets)])));
    const result: ScriptedResult = { id: this.id(), deliveryId: this.id(), at: this.now(), exit: output.exit,
      message: safeText(output.message, secrets, MAX_MESSAGE_BYTES), ...(params === undefined ? {} : { params }), target: structuredClone(capture.exits[output.exit]!), deliveryStatus: 'pending', ...(error ? { synthetic: true, error } : {}) };
    await this.ports.transact(taskId, (task, value) => {
      if (!current(value, owner.control) || !['active', 'awaiting-trust'].includes(task.scripted!.phase) || task.scripted!.result) return;
      task.scripted!.result = result; task.scripted!.phase = 'result-ready';
      if (error) task.scripted!.error = error;
      recordScriptedExecution(task, { at: result.at, executionId: owner.control.executionId, columnId: task.columnId, outcome: error ? 'failed' : 'completed', exit: result.exit, message: result.message, ...(error ? { error } : {}), ...historyParameters(owner.control) });
    });
  }

  private async deliver(taskId: string, owner: Owner): Promise<void> {
    const located = this.valid(taskId, owner); const control = located?.task.scripted;
    if (!located || !control?.capture || !control.result || control.result.deliveryStatus === 'accepted' || control.result.deliveryStatus === 'failed') return;
    const admitted = await this.ports.transact(taskId, (task, value) => {
      if (!current(value, owner.control) || !['result-ready', 'delivering'].includes(task.scripted!.phase) || task.scripted!.result?.id !== control.result!.id) return false;
      task.scripted!.phase = 'delivering'; return true;
    });
    if (!admitted || !this.valid(taskId, owner)) return;
    let outcome: SupervisorRouteOutcome;
    try { outcome = await this.ports.route({ located: this.ports.locate(taskId)!, control: structuredClone(control), capture: structuredClone(control.capture), result: structuredClone(control.result), signal: owner.abort.signal }); }
    catch { outcome = { status: 'failed', error: { code: 'SCRIPTED_DELIVERY_FAILED', message: 'The saved result could not be delivered. Retry delivery explicitly; the source program will not run again.' } }; }
    // A refusal is durable state on the entry, replaced only when the reason changes and
    // never appended as a history row. The attempt itself keeps the previous observation
    // visible, so a re-check of an unchanged reason reports nothing.
    let changed: ScriptedHold | undefined;
    // Placement may already have replaced the source control. Never write into its destination.
    await this.ports.transact(taskId, (task, value) => {
      if (!current(value, owner.control) || task.scripted!.phase !== 'delivering' || task.scripted!.result?.id !== control.result!.id) return;
      if (outcome.status === 'held') {
        task.scripted!.phase = 'result-ready';
        if (outcome.hold === undefined || sameScriptedHold(task.scripted!.hold, outcome.hold)) return;
        task.scripted!.hold = outcome.hold;
        changed = outcome.hold;
      } else if (outcome.status === 'accepted') {
        task.scripted!.result!.deliveryStatus = 'accepted'; delete task.scripted!.hold;
      } else {
        task.scripted!.phase = 'failed'; task.scripted!.result!.deliveryStatus = 'failed'; task.scripted!.result!.error = outcome.error; task.scripted!.error = outcome.error;
        delete task.scripted!.hold;
        recordScriptedHandoff(task, { at: this.now(), deliveryId: control.result!.deliveryId ?? control.result!.id, executionId: control.executionId, fromColumnId: task.columnId, columnId: control.result!.target?.columnId ?? task.columnId, outcome: 'failed', exit: control.result!.exit, message: control.result!.message, ...(control.result!.params === undefined ? {} : { parameters: control.result!.params }), error: outcome.error });
      }
    });
    if (changed !== undefined) this.ports.report?.(new KanbanError('SCRIPTED_DELIVERY_HELD', holdDiagnostic(changed)));
    // One safety re-check per observation, never a poll: a refusal that reveals the same
    // reason waits for a real edge instead of re-reading the conversation on a timer.
    if (outcome.status !== 'held') this.clearRecheck(taskId);
    else if (changed !== undefined) this.scheduleRecheck(taskId);
  }

  /** One coalesced safety re-check per refused result: it closes the race where the clearing edge arrived mid-attempt. */
  private scheduleRecheck(taskId: string): void {
    this.clearRecheck(taskId);
    if (this.disposed || this.recheckMs <= 0) return;
    const timer = setTimeout(() => {
      this.rechecks.delete(taskId);
      if (!this.disposed) this.reconcile(taskId);
    }, this.recheckMs);
    timer.unref?.();
    this.rechecks.set(taskId, timer);
  }

  private clearRecheck(taskId: string): void {
    const timer = this.rechecks.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.rechecks.delete(taskId);
  }

  private clearRechecks(): void { for (const taskId of [...this.rechecks.keys()]) this.clearRecheck(taskId); }


}
