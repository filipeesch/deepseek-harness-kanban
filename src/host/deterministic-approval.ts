import type { Board, Column, HubState } from '../shared/types.js';
import type { DeterministicCapture, DeterministicDefinition, DeterministicStageReview } from '../shared/deterministic.js';
import type { DeterministicApprovalScope, DeterministicRuntime } from './deterministic/ports.js';
import type { LocatedTask } from './hub-repository.js';
import { KanbanError } from '../shared/errors.js';
import { normalizeCapture } from './deterministic/capture.js';
import { boardStageIdentities, directoryDependent, projectDirectory, representativeProject, stageGeneration, stageTargets } from './deterministic-version.js';

export interface DeterministicApprovalPorts {
  runtime(): DeterministicRuntime | undefined;
  findBoard(boardId: string): { hub: HubState; board: Board } | undefined;
  locate(taskId: string): LocatedTask | undefined;
  all(): Iterable<LocatedTask>;
  transact<T>(taskId: string, change: (task: LocatedTask['task'], located: LocatedTask) => T): Promise<T>;
  /** Wake the entries waiting for one approved board/stage version. */
  wake(filter: { boardId: string; stageIdentity: string; fingerprint: string }): void;
}

function requireRuntime(ports: DeterministicApprovalPorts): DeterministicRuntime {
  const runtime = ports.runtime();
  if (runtime === undefined) throw new KanbanError('DETERMINISTIC_UNAVAILABLE', 'This host does not expose isolated deterministic execution.');
  return runtime;
}

function stageOf(board: Board, stageId: string): Column {
  const column = board.workflow.columns.find(value => value.id === stageId);
  if (column === undefined) throw new KanbanError('STAGE_NOT_FOUND', 'The stage does not exist in this board.');
  return column;
}

function approvalScope(hubId: string, boardId: string, stageIdentity: string): DeterministicApprovalScope {
  return { hubId, boardId, stageIdentity };
}

/**
 * Review and approval belong to the board stage, not to one execution. This
 * service resolves the executable version from a captured entry or from the
 * authored stage, validates it at approval time, and then lets the supervisor
 * reconcile every entry waiting for the same version.
 */
export class DeterministicApprovalService {
  constructor(private readonly ports: DeterministicApprovalPorts) {}

  async review(request: { boardId: string; stageId: string; taskId?: string }): Promise<DeterministicStageReview> {
    const runtime = requireRuntime(this.ports);
    const found = this.ports.findBoard(request.boardId);
    if (found === undefined) throw new KanbanError('BOARD_NOT_FOUND', 'The board does not exist.');
    const column = stageOf(found.board, request.stageId);
    if (request.taskId !== undefined) {
      const located = this.ports.locate(request.taskId);
      const control = located?.task.deterministic;
      if (located === undefined || located.task.boardId !== found.board.id || located.task.columnId !== column.id
        || control === undefined || control.capture === undefined || control.entryId !== located.task.stageEntry?.id) {
        throw new KanbanError('STALE_VERSION', 'This card no longer waits for the stage version. Open its current script panel and review it again.');
      }
      const currentIdentity = boardStageIdentities(found.board).get(column.id) ?? column.key;
      if (currentIdentity === undefined || currentIdentity !== control.stageIdentity) {
        throw new KanbanError('STALE_VERSION', 'The stage identity changed after this card was captured. Review the current stage version again.');
      }
      return this.captured(runtime, found, column, control.stageIdentity, located, control.capture, control.definition);
    }
    const identity = boardStageIdentities(found.board).get(column.id) ?? column.key;
    if (identity === undefined) throw new KanbanError('STAGE_IDENTITY_REQUIRED', 'This stage has no stable identity yet. Save the stage once or move a card into it before reviewing the saved version.');
    return this.authored(runtime, found, column, identity);
  }

  async approve(request: { boardId: string; stageId: string; fingerprint: string; stageGeneration: string; taskId?: string }): Promise<void> {
    const runtime = requireRuntime(this.ports);
    const found = this.ports.findBoard(request.boardId);
    if (found === undefined) throw new KanbanError('BOARD_NOT_FOUND', 'The board does not exist.');
    const column = stageOf(found.board, request.stageId);
    if (request.stageGeneration !== stageGeneration(found.board, column)) throw new KanbanError('STALE_VERSION', 'The saved stage changed after the review. Review the current version.');
    if (request.taskId !== undefined) {
      const located = this.ports.locate(request.taskId);
      const control = located?.task.deterministic;
      if (located === undefined || located.task.boardId !== found.board.id || located.task.columnId !== column.id
        || control === undefined || control.capture === undefined || control.entryId !== located.task.stageEntry?.id) {
        throw new KanbanError('STALE_VERSION', 'Review the current executable version before approving it.');
      }
      const normalized = await runtime.normalizeCapture(control.capture, control.definition);
      const acquired = normalized.sourceRef !== control.capture.sourceRef;
      try {
        if (normalized.fingerprint !== request.fingerprint) throw new KanbanError('STALE_VERSION', 'Review the current executable version before approving it.');
        // A stage or entry edit can land while normalization awaits; re-read both
        // before writing trust or adopting the normalized capture.
        const current = this.revalidate(request, column.id);
        const currentIdentity = boardStageIdentities(current.board).get(current.column.id) ?? current.column.key;
        if (currentIdentity === undefined || currentIdentity !== control.stageIdentity) throw new KanbanError('STALE_VERSION', 'The stage identity changed after the review. Review the current version.');
        const refreshed = this.ports.locate(located.task.id);
        if (refreshed === undefined || refreshed.task.boardId !== current.board.id || refreshed.task.columnId !== current.column.id
          || refreshed.task.stageEntry?.id !== control.entryId || refreshed.task.deterministic?.executionId !== control.executionId
          || refreshed.task.deterministic?.capture?.sourceRef !== control.capture.sourceRef) throw new KanbanError('STALE_VERSION', 'Review the current executable version before approving it.');
        await this.ports.transact(located.task.id, (task) => {
          if (task.deterministic?.entryId === control.entryId && task.deterministic.executionId === control.executionId) task.deterministic.capture = normalized;
        });
        if (this.ports.locate(located.task.id)?.task.deterministic?.capture?.sourceRef !== normalized.sourceRef) throw new KanbanError('STALE_VERSION', 'Review the current executable version before approving it.');
        await runtime.trust.approve(approvalScope(current.hub.id, current.board.id, control.stageIdentity), normalized.fingerprint);
        await this.normalizeWaiting(current.board.id, column.id, control.stageIdentity, normalized.fingerprint, runtime);
        this.ports.wake({ boardId: current.board.id, stageIdentity: control.stageIdentity, fingerprint: normalized.fingerprint });
      } finally { if (acquired) runtime.releaseCapture(normalized); }
      return;
    } else {
      const identities = boardStageIdentities(found.board);
      const stageIdentity = identities.get(column.id) ?? column.key;
      if (stageIdentity === undefined) throw new KanbanError('STAGE_IDENTITY_REQUIRED', 'This stage has no stable identity yet. Save the stage once before approving the saved version.');
      const { plan } = await this.plan(runtime, found, column, identities);
      if (plan.fingerprint !== request.fingerprint) throw new KanbanError('STALE_VERSION', 'The executable version changed after the review. Review the current version.');
      // Planning is asynchronous; reject a stage edit that lands while it runs.
      const current = this.revalidate(request, column.id);
      await runtime.trust.approve(approvalScope(current.hub.id, current.board.id, stageIdentity), request.fingerprint);
      this.ports.wake({ boardId: current.board.id, stageIdentity, fingerprint: request.fingerprint });
    }
  }

  /** Re-read the board and reject an approval whose stage changed while it awaited. */
  private revalidate(request: { boardId: string; stageId: string; stageGeneration: string }, stageId: string): { hub: HubState; board: Board; column: Column } {
    const found = this.ports.findBoard(request.boardId);
    if (found === undefined) throw new KanbanError('STALE_VERSION', 'The board changed after the review. Review the current version.');
    let column: Column;
    try { column = stageOf(found.board, request.stageId); }
    catch { throw new KanbanError('STALE_VERSION', 'The stage changed after the review. Review the current version.'); }
    if (column.id !== stageId || stageGeneration(found.board, column) !== request.stageGeneration) throw new KanbanError('STALE_VERSION', 'The saved stage changed after the review. Review the current version.');
    return { hub: found.hub, board: found.board, column };
  }

  /** Normalize every equivalent legacy capture so one approval wakes them all. */
  private async normalizeWaiting(boardId: string, stageId: string, stageIdentity: string, fingerprint: string, runtime: DeterministicRuntime): Promise<void> {
    for (const located of this.ports.all()) {
      const control = located.task.deterministic;
      if (located.task.boardId !== boardId || located.task.columnId !== stageId || located.task.stageEntry?.stageIdentity !== stageIdentity) continue;
      if (control?.phase !== 'awaiting-trust' || control.capture === undefined) continue;
      try {
        const normalized = await runtime.normalizeCapture(control.capture, control.definition);
        const acquired = normalized.sourceRef !== control.capture.sourceRef;
        try {
          if (normalized.fingerprint !== fingerprint || !acquired) continue;
          await this.ports.transact(located.task.id, (task) => {
            if (task.deterministic?.entryId === control.entryId && task.deterministic.executionId === control.executionId) task.deterministic.capture = normalized;
          });
        } finally { if (acquired) runtime.releaseCapture(normalized); }
      } catch { /* A corrupt or unreadable capture stays waiting for its own review. */ }
    }
  }

  /** Authorized names and configured state for one task's project and stable stage. No values. */
  async variables(taskId: string): Promise<{ env: string[]; variables: Array<{ name: string; configured: boolean }> }> {
    const runtime = requireRuntime(this.ports);
    const located = this.ports.locate(taskId);
    if (located === undefined) throw new KanbanError('TASK_NOT_FOUND', 'The task does not exist.');
    const column = located.board.workflow.columns.find(value => value.id === located.task.columnId);
    const identity = located.task.stageEntry?.stageIdentity ?? locateIdentity(located);
    if (column?.deterministic === undefined || identity === undefined) throw new KanbanError('CAPTURE_NOT_READY', 'Configure a deterministic script and stable local stage scope before configuring its variables.');
    const env = [...new Set(column.deterministic.env ?? [])].sort();
    const scope = { hubId: located.hubId, boardId: located.board.id, projectId: located.project.id, stageIdentity: identity };
    const variables = await runtime.variables.status(scope, env);
    return { env, variables };
  }

  private async captured(runtime: DeterministicRuntime, found: { hub: HubState; board: Board }, column: Column, stageIdentity: string, located: LocatedTask, capture: DeterministicCapture, definition: DeterministicDefinition): Promise<DeterministicStageReview> {
    const control = located.task.deterministic!;
    const code = await runtime.loadCapture(capture);
    // A pre-upgrade capture keeps its bytes but is shown under the current
    // content-addressed authority. Approving it normalizes the stored record.
    const normalized = normalizeCapture(capture, definition, code);
    return {
      stage: { boardId: found.board.id, stageId: column.id, stageIdentity, name: column.name },
      version: { fingerprint: normalized.fingerprint, stageGeneration: stageGeneration(found.board, column), captured: true, directoryDependent: directoryDependent(definition) },
      code,
      language: normalized.language,
      directory: normalized.directory,
      source: normalized.source.kind === 'file' ? { kind: 'file', ...(normalized.source.reference === undefined && normalized.source.path === undefined ? {} : { reference: normalized.source.reference ?? normalized.source.path }) } : { kind: 'inline' },
      exits: Object.fromEntries(Object.entries(normalized.exits).map(([exit, target]) => [exit, target.columnId])),
      env: [...normalized.env],
      // The captured declaration is the authority; a later saved edit cannot add
      // or remove a name from this review.
      params: normalized.params.map(name => structuredClone(definition.params ?? []).find(parameter => parameter.name === name) ?? { name }),
      approval: await runtime.trust.isApproved(approvalScope(found.hub.id, found.board.id, stageIdentity), normalized.fingerprint) ? 'approved' : 'required',
      waitingCards: this.waiting(found.board.id, column.id, stageIdentity, normalized.fingerprint),
      captured: { taskId: located.task.id, entryId: control.entryId, executionDirectory: normalized.executionDirectory },
    };
  }

  private async authored(runtime: DeterministicRuntime, found: { hub: HubState; board: Board }, column: Column, stageIdentity: string): Promise<DeterministicStageReview> {
    const definition = column.deterministic;
    if (definition === undefined) throw new KanbanError('DETERMINISTIC_CONFIGURATION_REQUIRED', 'Configure a deterministic script before reviewing it.');
    const resolved = await this.plan(runtime, found, column, boardStageIdentities(found.board));
    const { plan, project, directory } = resolved;
    return {
      stage: { boardId: found.board.id, stageId: column.id, stageIdentity, name: column.name },
      version: { fingerprint: plan.fingerprint, stageGeneration: stageGeneration(found.board, column), captured: false, directoryDependent: directoryDependent(definition), representative: { projectId: project.id, projectName: project.name, directory } },
      code: plan.code,
      language: plan.content.language,
      directory: plan.content.directory,
      source: definition.file === undefined ? { kind: 'inline' } : { kind: 'file', reference: definition.file },
      exits: Object.fromEntries(Object.entries(plan.content.exits).map(([exit, target]) => [exit, target.columnId])),
      env: [...plan.content.env],
      params: structuredClone(definition.params ?? []),
      approval: await runtime.trust.isApproved(approvalScope(found.hub.id, found.board.id, stageIdentity), plan.fingerprint) ? 'approved' : 'required',
      waitingCards: this.waiting(found.board.id, column.id, stageIdentity, plan.fingerprint),
    };
  }

  private waiting(boardId: string, stageId: string, stageIdentity: string, fingerprint: string): number {
    let count = 0;
    for (const located of this.ports.all()) {
      const control = located.task.deterministic;
      if (located.task.boardId !== boardId || located.task.columnId !== stageId || located.task.stageEntry?.stageIdentity !== stageIdentity) continue;
      if (control?.phase === 'awaiting-trust' && control.capture?.fingerprint === fingerprint) count += 1;
    }
    return count;
  }

  private async plan(runtime: DeterministicRuntime, found: { hub: HubState; board: Board }, column: Column, identities: ReadonlyMap<string, string | undefined>) {
    const definition = column.deterministic;
    if (definition === undefined) throw new KanbanError('DETERMINISTIC_CONFIGURATION_REQUIRED', 'Configure a deterministic script before reviewing it.');
    const targets = stageTargets(identities, column);
    if (targets === null) throw new KanbanError('ROUTES_INVALID', 'A named exit does not resolve to a stage with a stable identity.');
    const project = representativeProject(found.board, found.hub);
    const directory = projectDirectory(project);
    return { plan: await runtime.plan({ definition, projectDirectory: directory, taskDirectory: directory, exits: targets }), project, directory };
  }
}

function locateIdentity(located: LocatedTask): string | undefined {
  const column = located.board.workflow.columns.find(value => value.id === located.task.columnId);
  return located.board.localStageIdentities?.[located.task.columnId] ?? column?.key;
}
