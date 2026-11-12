import type { Board, HubSharingView, HubState, Problem, StagePatch } from '../shared/types.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import type { HubRepository } from './hub-repository.js';
import type { OperationDeps } from '../domain/hub-operations.js';
import * as operations from '../domain/hub-operations.js';
import type { WorkflowTextEdit } from '../domain/workflow-edit.js';
import { DEFAULT_WORKFLOW_YAML } from '../domain/workflow.js';
import type { RevisionActor, RevisionOrigin } from '../domain/revisions/log.js';
import { composeWorkflowReport, reviewWorkflowText, withScripts, type ScriptImpact, type WorkflowCardReference, type WorkflowWriteReport } from '../domain/workflow-report.js';
import type { DeterministicImpactPort } from './deterministic-impact.js';
import { describeStageActivity, hasInFlightWork } from '../shared/stage-activity.js';

/** The narrow publishing surface a board write needs; no dependency on the Kanban app. */
export interface BoardSharingPort {
  view(hubId: string): HubSharingView | undefined;
  isBound(hubId: string, boardId: string): boolean;
  noteLocalChange(hubId: string): void;
  removeBoard(hubId: string, boardId: string, scope: 'local' | 'team', name: string): Promise<void>;
  /** Publish one board; a board write never publishes another board's draft. */
  publishBoard(hubId: string, boardId: string): Promise<void>;
  /** Publish every board of the Hub that has local changes. */
  publishAll(hubId: string): Promise<void>;
}

/** The command path keeps the UI publishing flow; the tool path publishes automatically. */
export type BoardPublishingPolicy = 'never' | 'when-bound';

/** The one-line reason a refused write reports, counting the problems behind it. */
function refusalMessage(report: WorkflowWriteReport): string {
  const first = report.problems[0]?.message ?? 'The workflow document is invalid.';
  const rest = report.problems.length - 1;
  return rest > 0 ? first + ' (' + rest + ' more problem' + (rest === 1 ? '' : 's') + ')' : first;
}

/** The failures a composed document itself causes, which a report explains. */
const WORKFLOW_REFUSALS: ReadonlySet<string> = new Set(['INVALID_WORKFLOW', 'WORKFLOW_ORPHAN_COLUMNS']);

/** A workflow refusal that happened after the review keeps the report it was reviewed with. */
function attachReport(error: unknown, report: WorkflowWriteReport): unknown {
  return error instanceof KanbanError && WORKFLOW_REFUSALS.has(error.code)
    ? new KanbanError(error.code, error.message, { ...error.details, report })
    : error;
}

/**
 * What happened to the team document after a local board write. `blocked` means the
 * comparison refused publishing, `failed` means the publish attempt errored; both
 * leave the local change in place.
 */
export type BoardPublishingOutcome =
  | { readonly status: 'not-requested' }
  | { readonly status: 'not-bound' }
  | { readonly status: 'preview' }
  | { readonly status: 'local-only' }
  | { readonly status: 'scheduled' }
  | { readonly status: 'published' }
  | { readonly status: 'blocked'; readonly reason: string; readonly error?: Problem }
  | { readonly status: 'failed'; readonly error: Problem };

/** One board read with the Hub revision that a later write may target. */
export interface BoardView {
  readonly hubId: string;
  readonly hubRevision: number;
  readonly board: Board;
}

export interface BoardWriteResult extends BoardView {
  readonly sharing: BoardPublishingOutcome;
}

/**
 * Why a board cannot take a stage rename right now. A port so the board writer
 * stays independent of sessions: the composition root folds in the facts only the
 * host can read.
 */
export interface BoardActivityPort {
  /** The in-flight reasons for one board, empty when it is idle. */
  inFlight(hubId: string, boardId: string): Promise<readonly string[]>;
}

export interface BoardAdministrationOptions {
  readonly hubs: HubRepository;
  readonly sharing?: BoardSharingPort;
  readonly report?: (error: unknown) => void;
  readonly activity?: BoardActivityPort;
  /** Resolves the reviewed authorization of a composed document's scripts; absent reports none. */
  readonly impact?: DeterministicImpactPort;
  /** Records each accepted workflow write; absent keeps no local history. */
  readonly revisions?: BoardRevisionPort;
}

/** Who made a workflow write, and through which surface. */
export interface RevisionAttribution { readonly actor: RevisionActor; readonly origin: RevisionOrigin }

/** The revision log a board write records into; absent reports no history. */
export interface BoardRevisionPort {
  record(input: { hubId: string; boardId: string; previous: string | null; next: string; actor: RevisionActor; origin: RevisionOrigin }): Promise<void>;
  /** Drop one board's history with the board itself. */
  remove?(boardId: string): Promise<void>;
  /** Drop every board's history with the Hub itself. */
  removeHub?(hubId: string): Promise<void>;
}

export interface CreateBoardInput { hubId?: string; name: string; workflowYaml?: string; revision?: RevisionAttribution | false }
export interface UpdateBoardInput { hubId?: string; boardId: string; name?: string; workflowYaml?: string; expectedRevision?: number; revision?: RevisionAttribution | false }
export interface SaveBoardWorkflowInput { hubId?: string; boardId: string; yaml: string; expectedRevision?: number; revision?: RevisionAttribution }
/** An absent `projectKeys` allows every project of the Hub; an empty list closes the board. */
export interface SaveBoardProjectScopeInput { hubId?: string; boardId: string; projectKeys?: string[]; expectedRevision?: number }
export interface EditBoardWorkflowInput { hubId?: string; boardId: string; edits: readonly WorkflowTextEdit[]; expectedRevision?: number; revision?: RevisionAttribution }
export interface UpdateBoardStageInput { hubId?: string; boardId: string; stageId: string; patch: StagePatch; expectedRevision?: number; revision?: RevisionAttribution }
/** A workflow write composed from the document the board holds now. */
export interface ComposeBoardWorkflowInput { hubId?: string; boardId: string; compose: (current: string) => string; name?: string; expectedRevision?: number; actor?: RevisionActor; origin?: RevisionOrigin }
/** A reviewed board creation; an omitted document uses the default workflow. */
export interface CreateBoardReviewedInput extends CreateBoardInput {
  readonly actor?: RevisionActor;
  readonly origin?: RevisionOrigin;
}
export interface RemoveBoardInput { hubId?: string; boardId: string; confirmed: boolean; sharing?: 'local' | 'team'; expectedRevision?: number }

/**
 * One writer for board administration, shared by the board commands and the product
 * tools. Mutations run through one tail so two board writes cannot interleave, while
 * the repository transaction stays the authority on names, revisions, and deletion.
 */
export class BoardAdministration {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: BoardAdministrationOptions) {}

  private deps(): OperationDeps { return this.options.hubs.operationDeps(); }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private locate(boardId: string, hubId?: string): { hubId: string; board: Board; hubRevision: number } {
    if (hubId !== undefined) this.options.hubs.requireHub(hubId);
    const located = this.options.hubs.findBoard(boardId);
    invariant(located, 'BOARD_NOT_FOUND', 'Board does not exist.');
    if (hubId !== undefined) invariant(hubId === located.hubId, 'BOARD_NOT_FOUND', 'Board does not exist in the selected Hub.');
    return { hubId: located.hubId, board: located.board, hubRevision: located.hub.revision };
  }

  /** The task references a report needs; identities only, never card text. */
  private cardsOf(hub: HubState, boardId: string): WorkflowCardReference[] {
    return hub.tasks.filter(task => task.boardId === boardId).map(task => ({
      id: task.id,
      columnId: task.columnId,
      ...(task.recordedTransition === undefined ? {} : { recordedTransition: { columnId: task.recordedTransition.columnId } }),
      ...(task.pendingTransition === undefined ? {} : { pendingTransition: { fromColumnId: task.pendingTransition.fromColumnId, columnId: task.pendingTransition.columnId } }),
    }));
  }

  /** Review one composed document against the board it will replace. */
  private async review(input: { hub: HubState; board: Board | undefined; boardId: string; previousText: string | null; nextText: string }): Promise<WorkflowWriteReport> {
    const review = reviewWorkflowText({ text: input.nextText, previousText: input.previousText, cards: this.cardsOf(input.hub, input.boardId) });
    let scripts: ScriptImpact[] = [];
    if (review.valid && review.workflow !== null && input.board !== undefined && this.options.impact !== undefined) {
      scripts = await this.options.impact.describe({ hub: input.hub, board: input.board, before: review.previous, after: review.workflow });
    }
    return composeWorkflowReport(review, scripts);
  }

  private requireBoard(hubId: string, boardId: string): Board {
    const board = this.options.hubs.requireHub(hubId).boards.find(value => value.id === boardId);
    invariant(board, 'BOARD_NOT_FOUND', 'Board does not exist.');
    return structuredClone(board);
  }

  private result(hubId: string, board: Board, sharing: BoardPublishingOutcome): BoardWriteResult {
    return { hubId, hubRevision: this.options.hubs.requireHub(hubId).revision, board, sharing };
  }

  private noteLocalChange(hubId: string): void {
    try { this.options.sharing?.noteLocalChange(hubId); }
    catch (error) { this.options.report?.(error); }
  }

  /** The board read the tools use for both the summary and the exact authored YAML. */
  read(boardId: string, hubId?: string): BoardView {
    return this.locate(boardId, hubId);
  }

  /** The card references one board's write report names, without any card text. */
  cards(boardId: string, hubId?: string): WorkflowCardReference[] {
    const located = this.locate(boardId, hubId);
    return this.cardsOf(this.options.hubs.requireHub(located.hubId), boardId);
  }

  /** The Hub's publishing view without cloning the board; undefined when unbound. */
  sharingView(hubId: string): HubSharingView | undefined {
    return this.options.sharing?.view(hubId);
  }

  async create(input: CreateBoardInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const hubId = this.options.hubs.resolveHubId(input.hubId);
      const deps = this.deps();
      const board = await this.options.hubs.hub(hubId).transact(draft => {
        const created = operations.addBoard(draft, input.name, deps);
        if (input.workflowYaml !== undefined) operations.saveBoardWorkflow(draft, created.id, input.workflowYaml, deps);
        return operations.requireBoard(draft, created.id);
      });
      this.noteLocalChange(hubId);
      if (input.revision !== false) await this.noteRevision(hubId, board.id, null, board.workflowYaml, input.revision);
      return this.result(hubId, board, await this.publishOutcome(hubId, board.id, policy));
    });
  }

  async update(input: UpdateBoardInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    invariant(input.name !== undefined || input.workflowYaml !== undefined, 'INVALID_EDIT', 'Provide a board name or a workflow YAML.');
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const previous = located.board.workflowYaml;
      const deps = this.deps();
      const board = await this.options.hubs.hub(located.hubId).transact(draft => {
        if (input.name !== undefined) operations.renameBoard(draft, input.boardId, input.name, deps);
        if (input.workflowYaml !== undefined) operations.saveBoardWorkflow(draft, input.boardId, input.workflowYaml, deps);
        return operations.requireBoard(draft, input.boardId);
      }, input.expectedRevision);
      this.noteLocalChange(located.hubId);
      if (input.workflowYaml !== undefined && input.revision !== false) await this.noteRevision(located.hubId, board.id, previous, board.workflowYaml, input.revision);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  async saveWorkflow(input: SaveBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      await this.options.hubs.hub(located.hubId).saveBoardWorkflow(input.boardId, input.yaml, input.expectedRevision);
      const board = this.requireBoard(located.hubId, input.boardId);
      this.noteLocalChange(located.hubId);
      await this.noteRevision(located.hubId, input.boardId, located.board.workflowYaml, board.workflowYaml, input.revision);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  /** Replace one board's project scope through the same write path and publishing policy. */
  async saveProjectScope(input: SaveBoardProjectScopeInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const board = await this.options.hubs.hub(located.hubId).setBoardProjectScope(input.boardId, input.projectKeys, input.expectedRevision);
      this.noteLocalChange(located.hubId);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  /** Edit one stage through the authored workflow text and the one board write path. */
  async updateStage(input: UpdateBoardStageInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const previous = located.board.workflowYaml;
      const renaming = input.patch.id !== undefined && input.patch.id !== input.stageId;
      if (renaming) {
        const reasons = (await this.options.activity?.inFlight(located.hubId, input.boardId)) ?? [];
        invariant(!hasInFlightWork(reasons), 'STAGE_RENAME_IN_FLIGHT', 'The board has work in flight (' + describeStageActivity(reasons) + '). Finish it before renaming a stage.');
      }
      const deps = this.deps();
      await this.options.hubs.hub(located.hubId).transact(
        draft => operations.updateBoardStage(draft, input.boardId, { stageId: input.stageId, patch: input.patch }, deps),
        input.expectedRevision,
      );
      const board = this.requireBoard(located.hubId, input.boardId);
      this.noteLocalChange(located.hubId);
      await this.noteRevision(located.hubId, input.boardId, previous, board.workflowYaml, input.revision);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  /** Record one accepted workflow write, reporting a log failure without undoing the write. */
  private async noteRevision(hubId: string, boardId: string, previous: string | null, next: string, attribution: RevisionAttribution | undefined): Promise<void> {
    const revisions = this.options.revisions;
    if (revisions === undefined) return;
    try { await revisions.record({ hubId, boardId, previous, next, actor: attribution?.actor ?? { kind: 'operator' }, origin: attribution?.origin ?? 'editor' }); }
    catch (error) { this.options.report?.(error); }
  }

  /**
   * Write one board's workflow composed from the document it holds now, after
   * reviewing the composed document. The report describes exactly the text that
   * is saved: the write pins the revision the review read, so a concurrent change
   * surfaces as a conflict instead of saving a document nobody reported.
   */
  async saveWorkflowReviewed(input: ComposeBoardWorkflowInput, policy: BoardPublishingPolicy = 'when-bound'): Promise<BoardWriteResult & { report: WorkflowWriteReport }> {
    const located = this.locate(input.boardId, input.hubId);
    let nextText: string;
    try {
      nextText = input.compose(located.board.workflowYaml);
    } catch (error) {
      // A composition that refuses its own edit (an invalid document, a missing
      // initial stage, a malformed stage snippet) is a refusal like any other, and
      // the caller gets the report instead of a bare failure.
      if (error instanceof KanbanError) {
        const report = composeWorkflowReport({ valid: false, problems: [{ message: error.message }], difference: null, warnings: [], affectedCards: [], workflow: null, previous: null });
        throw new KanbanError(error.code, error.message, { ...error.details, report });
      }
      throw error;
    }
    const hub = this.options.hubs.requireHub(located.hubId);
    const report = await this.review({ hub, board: located.board, boardId: input.boardId, previousText: located.board.workflowYaml, nextText });
    if (!report.valid) throw new KanbanError('INVALID_WORKFLOW', refusalMessage(report), { report });
    // The revision is recorded by the write itself, before it publishes: a
    // publishing pass may rewrite the document to seed stage identities, and the
    // tool's revision must describe the text the tool actually saved.
    const attribution: RevisionAttribution = { actor: input.actor ?? { kind: 'operator' }, origin: input.origin ?? 'editor' };
    try {
      const written = await this.update({ boardId: input.boardId, ...(input.hubId === undefined ? {} : { hubId: input.hubId }), ...(input.name === undefined ? {} : { name: input.name }), workflowYaml: nextText, expectedRevision: input.expectedRevision ?? located.hubRevision, revision: attribution }, policy);
      return { ...written, report };
    } catch (error) {
      throw attachReport(error, report);
    }
  }

  /**
   * Create one board and report what its supplied document requires. A creation
   * reports no script impact: there is no board yet whose reviewed approvals
   * could be evaluated, and a new board starts without any.
   */
  async createReviewed(input: CreateBoardReviewedInput, policy: BoardPublishingPolicy = 'when-bound'): Promise<BoardWriteResult & { report: WorkflowWriteReport }> {
    const hubId = this.options.hubs.resolveHubId(input.hubId);
    const hub = this.options.hubs.requireHub(hubId);
    const workflowYaml = input.workflowYaml ?? DEFAULT_WORKFLOW_YAML;
    const report = await this.review({ hub, board: undefined, boardId: '', previousText: null, nextText: workflowYaml });
    if (!report.valid) throw new KanbanError('INVALID_WORKFLOW', refusalMessage(report), { report });
    try {
      const created = await this.create({ ...input, workflowYaml, revision: { actor: input.actor ?? { kind: 'operator' }, origin: input.origin ?? 'editor' } }, policy);
      if (this.options.impact === undefined) return { ...created, report };
      // A creation has no evaluated approvals yet, which is exactly the answer an
      // author needs: every deterministic stage of the new board is unreviewed.
      try {
        const scripts = await this.options.impact.describe({ hub: this.options.hubs.requireHub(hubId), board: created.board, before: null, after: created.board.workflow });
        return { ...created, report: withScripts(report, scripts) };
      } catch (error) {
        this.options.report?.(error);
        return { ...created, report };
      }
    } catch (error) {
      throw attachReport(error, report);
    }
  }

  async editWorkflow(input: EditBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const previous = located.board.workflowYaml;
      const board = await this.options.hubs.hub(located.hubId).editBoardWorkflow(input.boardId, input.edits, input.expectedRevision);
      this.noteLocalChange(located.hubId);
      await this.noteRevision(located.hubId, input.boardId, previous, board.workflowYaml, input.revision);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  async remove(input: RemoveBoardInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    invariant(input.confirmed, 'CONFIRMATION_REQUIRED', 'Confirm deleting the board.');
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const bound = this.options.sharing?.isBound(located.hubId, input.boardId) === true;
      if (bound) invariant(input.sharing === 'local' || input.sharing === 'team', 'SHARING_SCOPE_REQUIRED', 'Choose whether this board removal applies only here or to the team.');
      const board = await this.options.hubs.hub(located.hubId).deleteBoard(input.boardId, input.expectedRevision);
      try { await this.options.revisions?.remove?.(input.boardId); }
      catch (error) { this.options.report?.(error); }
      // A team removal appends its removal event inside the sharing layer; a local-only
      // removal must not publish anything, and neither may publish another board.
      if (this.options.sharing) {
        try { await this.options.sharing.removeBoard(located.hubId, input.boardId, input.sharing === 'team' ? 'team' : 'local', board.name); }
        catch (error) {
          // The board is already deleted; surface the bookkeeping failure instead of
          // pretending the removal failed or leaving the caller to retry a missing board.
          this.options.report?.(error);
          return this.result(located.hubId, board, { status: 'failed', error: problem(error) });
        }
      }
      const sharing: BoardPublishingOutcome = !bound || input.sharing === 'local'
        ? { status: 'local-only' }
        : { status: 'published' };
      return this.result(located.hubId, board, sharing);
    });
  }

  /**
   * Publish after a successful local write. A refusal never rolls the local change
   * back; the caller reports the outcome instead of retrying the write.
   */
  private async publishOutcome(hubId: string, boardId: string, policy: BoardPublishingPolicy): Promise<BoardPublishingOutcome> {
    if (policy === 'never') return { status: 'not-requested' };
    const sharing = this.options.sharing;
    if (!sharing) return { status: 'not-bound' };
    let view: HubSharingView | undefined;
    try { view = sharing.view(hubId); }
    catch (error) { return { status: 'failed', error: problem(error) }; }
    if (!view || view.status === 'not-published') return { status: 'not-bound' };
    if (view.status === 'preview') return { status: 'preview' };
    if (view.boards.find(entry => entry.boardId === boardId)?.state === 'orphan') {
      return { status: 'blocked', reason: 'The board is not bound to the team document.' };
    }
    if (view.status === 'unavailable') {
      return { status: 'blocked', reason: 'The team storage is unavailable.', ...(view.error === undefined ? {} : { error: view.error }) };
    }
    if (view.blockers.length > 0) return { status: 'blocked', reason: view.blockers[0]!.message };
    const state = view.boards.find(entry => entry.boardId === boardId)?.state;
    if (state === 'updates-available') return { status: 'blocked', reason: 'This board has team updates that have not been applied.' };
    if (state === 'needs-review') return { status: 'blocked', reason: 'This board needs a review before it can be published.' };
    if (state === 'update-required') return { status: 'blocked', reason: 'Update the plugin to publish this board.' };
    if (state === 'orphan') return { status: 'blocked', reason: 'The board was removed by the team. Publish it as a new board instead.' };
    try {
      await sharing.publishBoard(hubId, boardId);
      return { status: 'published' };
    } catch (error) {
      const value = problem(error);
      return value.code === 'SHARING_PUBLISH_BLOCKED' || value.code === 'SHARING_NOT_PUBLISHED'
        ? { status: 'blocked', reason: value.message, error: value }
        : { status: 'failed', error: value };
    }
  }
}