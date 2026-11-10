import type { Board, HubSharingView, Problem, StagePatch } from '../shared/types.js';
import { invariant, problem } from '../shared/errors.js';
import type { HubRepository } from './hub-repository.js';
import type { OperationDeps } from '../domain/hub-operations.js';
import * as operations from '../domain/hub-operations.js';
import type { WorkflowTextEdit } from '../domain/workflow-edit.js';
import { describeStageActivity, hasInFlightWork } from '../shared/stage-activity.js';

/** The narrow publishing surface a board write needs; no dependency on the Kanban app. */
export interface BoardSharingPort {
  view(hubId: string): HubSharingView | undefined;
  isBound(hubId: string, boardId: string): boolean;
  noteLocalChange(hubId: string): void;
  removeBoard(hubId: string, boardId: string, scope: 'local' | 'team', name: string): Promise<void>;
  publish(hubId: string): Promise<void>;
}

/** The command path keeps the UI publishing flow; the tool path publishes automatically. */
export type BoardPublishingPolicy = 'never' | 'when-bound';

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
}

export interface CreateBoardInput { hubId?: string; name: string; workflowYaml?: string }
export interface UpdateBoardInput { hubId?: string; boardId: string; name?: string; workflowYaml?: string; expectedRevision?: number }
export interface SaveBoardWorkflowInput { hubId?: string; boardId: string; yaml: string; expectedRevision?: number }
/** An absent `projectKeys` allows every project of the Hub; an empty list closes the board. */
export interface SaveBoardProjectScopeInput { hubId?: string; boardId: string; projectKeys?: string[]; expectedRevision?: number }
export interface EditBoardWorkflowInput { hubId?: string; boardId: string; edits: readonly WorkflowTextEdit[]; expectedRevision?: number }
export interface UpdateBoardStageInput { hubId?: string; boardId: string; stageId: string; patch: StagePatch; expectedRevision?: number }
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
      return this.result(hubId, board, await this.publishOutcome(hubId, board.id, policy));
    });
  }

  async update(input: UpdateBoardInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    invariant(input.name !== undefined || input.workflowYaml !== undefined, 'INVALID_EDIT', 'Provide a board name or a workflow YAML.');
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const deps = this.deps();
      const board = await this.options.hubs.hub(located.hubId).transact(draft => {
        if (input.name !== undefined) operations.renameBoard(draft, input.boardId, input.name, deps);
        if (input.workflowYaml !== undefined) operations.saveBoardWorkflow(draft, input.boardId, input.workflowYaml, deps);
        return operations.requireBoard(draft, input.boardId);
      }, input.expectedRevision);
      this.noteLocalChange(located.hubId);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  async saveWorkflow(input: SaveBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      await this.options.hubs.hub(located.hubId).saveBoardWorkflow(input.boardId, input.yaml, input.expectedRevision);
      const board = this.requireBoard(located.hubId, input.boardId);
      this.noteLocalChange(located.hubId);
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
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  async editWorkflow(input: EditBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const board = await this.options.hubs.hub(located.hubId).editBoardWorkflow(input.boardId, input.edits, input.expectedRevision);
      this.noteLocalChange(located.hubId);
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
      // A team removal notifies the sharing layer inside removeBoard; a local-only
      // removal must not schedule a synchronization that could publish other drafts.
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
        : await this.publishOutcome(located.hubId, undefined, policy);
      return this.result(located.hubId, board, sharing);
    });
  }

  /**
   * Publish after a successful local write. A refusal never rolls the local change
   * back; the caller reports the outcome instead of retrying the write.
   */
  private async publishOutcome(hubId: string, boardId: string | undefined, policy: BoardPublishingPolicy): Promise<BoardPublishingOutcome> {
    if (policy === 'never') return { status: 'not-requested' };
    const sharing = this.options.sharing;
    if (!sharing) return { status: 'not-bound' };
    let view: HubSharingView | undefined;
    try { view = sharing.view(hubId); }
    catch (error) { return { status: 'failed', error: problem(error) }; }
    if (!view || view.status === 'not-published') return { status: 'not-bound' };
    if (view.status === 'preview') return { status: 'preview' };
    if (boardId !== undefined && view.boards.find(entry => entry.boardId === boardId)?.state === 'orphan') {
      return { status: 'blocked', reason: 'The board is not bound to the team document.' };
    }
    if (view.status === 'unavailable') {
      return { status: 'blocked', reason: 'The team storage is unavailable.', ...(view.error === undefined ? {} : { error: view.error }) };
    }
    if (view.conflicts > 0) return { status: 'blocked', reason: 'The Hub has unresolved workflow conflicts.' };
    if (view.blockers.length > 0) return { status: 'blocked', reason: view.blockers[0]!.message };
    if (view.syncMode === 'continuous') return { status: 'scheduled' };
    if (view.updates > 0) return { status: 'blocked', reason: 'The Hub has team updates that have not been applied.' };
    try {
      await sharing.publish(hubId);
      return { status: 'published' };
    } catch (error) {
      const value = problem(error);
      return value.code === 'SHARING_PUBLISH_BLOCKED' || value.code === 'SHARING_NOT_PUBLISHED'
        ? { status: 'blocked', reason: value.message, error: value }
        : { status: 'failed', error: value };
    }
  }
}
