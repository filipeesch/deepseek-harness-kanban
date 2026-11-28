import { createHash } from 'node:crypto';
import type { Board, HubSharingView, HubState, Problem, StagePatch, Workflow } from '../shared/types.js';
import { KanbanError, invariant, problem } from '../shared/errors.js';
import type { HubRepository } from './hub-repository.js';
import type { OperationDeps } from '../domain/hub-operations.js';
import * as operations from '../domain/hub-operations.js';
import type { WorkflowTextEdit } from '../domain/workflow-edit.js';
import { DEFAULT_WORKFLOW_YAML } from '../domain/workflow.js';
import type { RevisionActor, RevisionOrigin } from '../domain/revisions/log.js';
import { composeWorkflowReport, reviewWorkflowText, summarizeWorkflowReport, withScripts, type ScriptImpact, type WorkflowCardReference, type WorkflowReportSummary, type WorkflowWriteReport } from '../domain/workflow-report.js';
import type { WorkflowProblem } from '../domain/workflow-diagnostics.js';
import { diffWorkflow } from '../domain/workflow-difference.js';
import { parseWorkflow } from '../domain/workflow.js';
import { effectiveBoardPreset } from '../domain/board-preset.js';
import { authoredMainAgent } from '../domain/agents.js';
import { workflowCardReferences } from '../domain/workflow-card-references.js';
import type { AgentAvailability } from '../domain/workflow-warnings.js';

/** The preset the authored main agent names, whichever authored field carries it. */
function mainAuthoredPreset(workflow: Workflow): string | undefined {
  const main = authoredMainAgent(workflow);
  return main === undefined ? workflow.agentPreset : main.preset;
}
import type { ScriptedImpactInput, ScriptedImpactPort } from './scripted-impact.js';
import { describeStageActivity, hasInFlightWork } from '../shared/stage-activity.js';
import { renameTaskStage } from '../domain/stage-update.js';
import { reconcileLocalStageIdentities } from '../domain/stage-identity.js';
import { boardNameKey, entryRefusal, incomingIdentities, orphanedText, replacementOutcome } from '../domain/workflow-transfer/plan.js';

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

/** The command path and the tool path both keep publishing manual; a caller may still ask for the old bound-publish behavior. */
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
  /** The write saved locally and no publishing was attempted; publishing is a manual operator action. */
  | { readonly status: 'not-published'; readonly reason: 'manual' }
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
  /**
   * The revision this write's own transaction reached. It is fixed from the enforced
   * revision, so a post-commit hook that advances the Hub cannot change it; only a
   * workflow save reports it, because only that receipt needs its own commit identity.
   */
  readonly committedRevision?: number;
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
  readonly impact?: ScriptedImpactPort;
  /** Records each accepted workflow write; absent keeps no local history. */
  readonly revisions?: BoardRevisionPort;
  /** Runs after an accepted workflow write, so board-scoped task data can follow an edit. */
  readonly onWorkflowWritten?: (hubId: string, boardId: string) => void | Promise<void>;
  /** What the running host reports about agents, for the authoring availability warnings. */
  readonly agentAvailability?: () => Promise<AgentAvailability | undefined>;
}

/** Who made a workflow write, and through which surface. */
export interface RevisionAttribution { readonly actor: RevisionActor; readonly origin: RevisionOrigin }

/** The revision log a board write records into; absent reports no history. */
export interface BoardRevisionPort {
  record(input: { hubId: string; boardId: string; previous: string | null; next: string; previousPresetMode?: 'operator' | 'host'; nextPresetMode?: 'operator' | 'host'; actor: RevisionActor; origin: RevisionOrigin }): Promise<void>;
  /** The document the most recent recorded write replaced, when the log retains it. */
  previousText?(boardId: string): Promise<string | undefined>;
  /** Append a recovery revision when the stored document no longer matches the log head. */
  reconcile?(input: { readonly hubId: string; readonly boardId: string; readonly storedText: string; readonly storedPresetMode?: 'operator' | 'host' }): Promise<void>;
  /** Drop one board's history with the board itself. */
  remove?(boardId: string): Promise<void>;
  /** Drop every board's history with the Hub itself. */
  removeHub?(hubId: string): Promise<void>;
}

export interface CreateBoardInput { hubId?: string; name: string; workflowYaml?: string; revision?: RevisionAttribution | false }
/**
 * One import application: the settled plan, the document behind it, and the Hub
 * it lands in.
 *
 * The import walks the plan inside this writer's tail, so an import can never
 * interleave with a board write from another surface. Each board is applied on
 * its own: a board that cannot be written is reported and the next one still is,
 * which is what makes an import deliberately not atomic.
 */
export interface ImportBoardInput {
  readonly hubId: string;
  readonly entries: readonly ImportEntryInput[];
}

/** One entry as the apply receives it, already settled by the surface. */
export interface ImportEntryInput {
  /** The name the document carries. */
  readonly name: string;
  /** The destination the settlement named. */
  readonly destination: 'create' | 'replace' | 'copy' | 'skip' | 'blocked';
  /** The board a replacement overwrites. */
  readonly targetBoardId: string | null;
  /** The name a copy is created under. */
  readonly copyName: string | null;
  /** The authored workflow document the entry writes. */
  readonly workflowYaml: string;
  /** The recorded default-preset choice the entry carries. */
  readonly presetMode: 'operator' | 'host' | null;
  /**
   * The project scope the entry writes, exactly as the document states it. Undefined
   * means the board accepts every project; an empty list keeps it closed. An identity
   * the Hub does not answer is materialized as a placeholder by the apply.
   */
  readonly projectScope: readonly string[] | undefined;
  /** The stable stage identities the entry carries. */
  readonly stageIdentities: Readonly<Record<string, string>> | null;
}

/** One entry as applying it ended, which the result enumerates. */
export type ImportEntryOutcome =
  | { readonly name: string; readonly status: 'created'; readonly boardId: string }
  | { readonly name: string; readonly status: 'replaced'; readonly boardId: string }
  | { readonly name: string; readonly status: 'skipped' }
  | { readonly name: string; readonly status: 'failed'; readonly reason: string; readonly code: string };

/** The result of one applied import. */
export interface ImportResult {
  readonly hubId: string;
  readonly outcomes: readonly ImportEntryOutcome[];
  /** Present when the boards landed but the cleanup of unused projects could not finish. */
  readonly cleanupFailure?: Problem;
}

export interface UpdateBoardInput { hubId?: string; boardId: string; name?: string; workflowYaml?: string; expectedRevision?: number; revision?: RevisionAttribution | false; presetChoice?: 'host' | 'named'; restorePresetMode?: { value: 'operator' | 'host' | undefined } }
export interface SaveBoardWorkflowInput { hubId?: string; boardId: string; yaml: string; expectedRevision?: number; revision?: RevisionAttribution; presetChoice?: 'host' | 'named' }
/** An absent `projectKeys` allows every project of the Hub; an empty list closes the board. */
export interface SaveBoardProjectScopeInput { hubId?: string; boardId: string; projectKeys?: string[]; expectedRevision?: number }
export interface EditBoardWorkflowInput { hubId?: string; boardId: string; edits: readonly WorkflowTextEdit[]; expectedRevision?: number; revision?: RevisionAttribution }
export interface UpdateBoardStageInput { hubId?: string; boardId: string; stageId: string; patch: StagePatch; expectedRevision?: number; revision?: RevisionAttribution }
/** The response shape a workflow write reports. */
export type WorkflowWriteDetail = 'summary' | 'full';

/** One accepted workflow write, with the digest of the exact document it stored. */
export interface WorkflowWriteResult extends BoardWriteResult {
  readonly saved: true;
  readonly sha256: string;
  readonly report: WorkflowWriteReport | WorkflowReportSummary;
  /** The revision the workflow transaction committed, not a later read of the Hub. */
  readonly committedRevision: number;
}

/** The reviewed script authorization for one composed document. */
export interface ScriptAuthorization {
  /** Whether the running host could project authorization at all; false is never "no impact". */
  readonly inspected: boolean;
  readonly impacts: readonly ScriptImpact[];
}

/** One reviewed workflow write that persisted nothing. */
export interface WorkflowDryRunResult {
  readonly saved: false;
  readonly dryRun: true;
  readonly hubId: string;
  readonly boardId: string;
  readonly name: string;
  readonly hubRevision: number;
  readonly sha256: string;
  readonly report: WorkflowWriteReport | WorkflowReportSummary;
}

export type WorkflowWriteOutcome = WorkflowWriteResult | WorkflowDryRunResult;

/** A workflow write composed from the document the board holds now. */
export interface ComposeBoardWorkflowInput {
  hubId?: string; boardId: string; compose: (current: string) => string; name?: string; expectedRevision?: number; actor?: RevisionActor; origin?: RevisionOrigin;
  /** The digest of the exact document the caller expects to store; a mismatch refuses the write. */
  expectSha256?: string;
  /** Review exactly as a write does and persist nothing. */
  dryRun?: boolean;
  /** The report shape; the summary is the default. */
  detail?: WorkflowWriteDetail;
  /** The write replaces the whole document, so it cannot be rebased onto a concurrent change. */
  replace?: boolean;
  /** An explicit settings selection, applied atomically with the reviewed text. */
  presetChoice?: 'host' | 'named';
  /** Restore an exact historical selection, including legacy absence. */
  restorePresetMode?: { value: 'operator' | 'host' | undefined };
}
/** A reviewed board creation; an omitted document uses the default workflow. */
export interface CreateBoardReviewedInput extends CreateBoardInput {
  readonly actor?: RevisionActor;
  readonly origin?: RevisionOrigin;
  readonly expectSha256?: string;
  readonly dryRun?: boolean;
  readonly detail?: WorkflowWriteDetail;
}

/** What one board change would alter on the target board, named without any field text. */
export interface BoardChangeSummary {
  readonly stages: ReadonlyArray<{ readonly stage: string; readonly change: 'added' | 'removed' | 'changed'; readonly fields?: readonly string[] }>;
  readonly workflow: readonly string[];
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

  /** The task references a report needs; identities and routing facts only, never card text. */
  private cardsOf(hub: HubState, boardId: string): WorkflowCardReference[] {
    return workflowCardReferences(hub, boardId);
  }

  /** Review one composed document against the board it will replace. */
  private async review(input: { hub: HubState; board: Board | undefined; boardId: string; previousText: string | null; nextText: string }): Promise<WorkflowWriteReport> {
    let availability: AgentAvailability | undefined;
    try { availability = await this.options.agentAvailability?.(); }
    catch (error) { this.options.report?.(error); }
    const review = reviewWorkflowText({ text: input.nextText, previousText: input.previousText, cards: this.cardsOf(input.hub, input.boardId), ...(availability === undefined ? {} : { availability }) });
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

  /** What the running host reports about agent presets and models, for an authoring review. */
  async agentAvailability(): Promise<AgentAvailability | undefined> {
    try { return await this.options.agentAvailability?.(); }
    catch (error) { this.options.report?.(error); return undefined; }
  }

  /**
   * The reviewed script authorization for one composed document, against the same Hub
   * snapshot a review read. A host without the projection, or one that fails, reports
   * `inspected: false` rather than an empty list that would read as "no impact".
   */
  async describeScriptImpact(input: ScriptedImpactInput): Promise<ScriptAuthorization> {
    if (this.options.impact === undefined) return { inspected: false, impacts: [] };
    // An installed port without a runtime answers `available: false`, so the caller
    // reports that the authorization could not be inspected rather than an empty pass.
    const inspected = this.options.impact.available === undefined ? true : this.options.impact.available();
    try { return { inspected, impacts: await this.options.impact.describe(input) }; }
    catch (error) { this.options.report?.(error); return { inspected: false, impacts: [] }; }
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
      if (input.revision !== false) await this.noteRevision(hubId, board.id, null, board.workflowYaml, undefined, board.defaultPresetMode, input.revision);
      return this.result(hubId, board, await this.publishOutcome(hubId, board.id, policy));
    });
  }

  async update(input: UpdateBoardInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(() => this.saveBoardWorkflowNow(input, policy));
  }

  /** One board save, run inside the caller's lane so a compose can be rebased. */
  private async saveBoardWorkflowNow(input: UpdateBoardInput, policy: BoardPublishingPolicy): Promise<BoardWriteResult> {
    invariant(input.name !== undefined || input.workflowYaml !== undefined, 'INVALID_EDIT', 'Provide a board name or a workflow YAML.');
    const located = this.locate(input.boardId, input.hubId);
    const previous = located.board.workflowYaml;
    const previousPresetMode = located.board.defaultPresetMode;
    const deps = this.deps();
    const board = await this.options.hubs.hub(located.hubId).transact(draft => {
      if (input.name !== undefined) operations.renameBoard(draft, input.boardId, input.name, deps);
      if (input.workflowYaml !== undefined) operations.saveBoardWorkflow(draft, input.boardId, input.workflowYaml, deps);
      const board = operations.requireBoard(draft, input.boardId);
      if (input.presetChoice === 'host') {
        invariant(mainAuthoredPreset(board.workflow) === undefined, 'INVALID_INPUT', 'Host default requires no authored agent preset.');
        board.defaultPresetMode = 'host';
      } else if (input.presetChoice === 'named') {
        invariant(mainAuthoredPreset(board.workflow) !== undefined, 'INVALID_INPUT', 'A named preset requires an authored agent preset.');
        delete board.defaultPresetMode;
      }
      if (input.restorePresetMode !== undefined) {
        invariant(input.presetChoice === undefined, 'INVALID_INPUT', 'A restore cannot also select a preset.');
        if (input.restorePresetMode.value === undefined) delete board.defaultPresetMode;
        else board.defaultPresetMode = input.restorePresetMode.value;
      }
      // Authoring the main agent makes the document the one source of its preset and
      // model, so the legacy metadata stops deciding even without an explicit choice.
      if (authoredMainAgent(board.workflow) !== undefined) delete board.defaultPresetMode;
      return board;
    }, input.expectedRevision);
    // The revision this write committed. A transaction refuses a revision mismatch and
    // increments by exactly one, so the enforced revision names the commit even if a
    // post-commit hook later advances the Hub.
    const committedRevision = input.expectedRevision === undefined
      ? this.options.hubs.requireHub(located.hubId).revision
      : input.expectedRevision + 1;
    this.noteLocalChange(located.hubId);
    if ((input.workflowYaml !== undefined || input.restorePresetMode !== undefined || input.presetChoice !== undefined) && input.revision !== false) await this.noteRevision(located.hubId, board.id, previous, board.workflowYaml, previousPresetMode, board.defaultPresetMode, input.revision);
    // The workflow-written reconciliation (held messages, detached bindings) completes
    // before the save reports success, so a reported save has nothing left pending.
    if (input.workflowYaml !== undefined) await this.workflowWritten(located.hubId, board.id);
    const outcome = this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    return { ...outcome, committedRevision };
  }

  async saveWorkflow(input: SaveBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    const result = await this.saveWorkflowReviewed({
      boardId: input.boardId, ...(input.hubId === undefined ? {} : { hubId: input.hubId }),
      compose: () => input.yaml, replace: true,
      ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
      ...(input.presetChoice === undefined ? {} : { presetChoice: input.presetChoice }),
      ...(input.revision === undefined ? {} : { actor: input.revision.actor, origin: input.revision.origin }),
    }, policy);
    invariant(result.saved, 'INVALID_INPUT', 'The workflow was not saved.');
    return result;
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
      const previousPresetMode = located.board.defaultPresetMode;
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
      await this.noteRevision(located.hubId, input.boardId, previous, board.workflowYaml, previousPresetMode, board.defaultPresetMode, input.revision);
      return this.result(located.hubId, board, await this.publishOutcome(located.hubId, board.id, policy));
    });
  }

  /** Tell the host that a board's document changed; a listener failure never fails the write. */
  private async workflowWritten(hubId: string, boardId: string): Promise<void> {
    try { await this.options.onWorkflowWritten?.(hubId, boardId); }
    catch (error) { this.options.report?.(error); }
  }

  /** Record one accepted workflow write, reporting a log failure without undoing the write. */
  private async noteRevision(hubId: string, boardId: string, previous: string | null, next: string, previousPresetMode: 'operator' | 'host' | undefined, nextPresetMode: 'operator' | 'host' | undefined, attribution: RevisionAttribution | undefined): Promise<void> {
    const revisions = this.options.revisions;
    if (revisions === undefined) return;
    try { await revisions.record({ hubId, boardId, previous, next, previousPresetMode, nextPresetMode, actor: attribution?.actor ?? { kind: 'operator' }, origin: attribution?.origin ?? 'editor' }); }
    catch (error) { this.options.report?.(error); }
  }

  /** The digest of the exact bytes a write would store. */
  private digestOf(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }

  /** The board changes a rebase conflict reports, named without any field text. */
  private boardChange(previousText: string, currentText: string): BoardChangeSummary {
    try {
      const difference = diffWorkflow(parseWorkflow(previousText), parseWorkflow(currentText));
      return {
        stages: difference.stages.map(stage => ({ stage: stage.stage, change: stage.change, ...(stage.fields === undefined ? {} : { fields: stage.fields.map(field => field.field) }) })),
        workflow: difference.workflow.map(field => field.field),
      };
    } catch { return { stages: [], workflow: [] }; }
  }

  /** The parsed document a summary measures, or null when it does not parse. */
  private workflowOf(text: string): Workflow | null { try { return parseWorkflow(text); } catch { return null; } }

  /** What the most recent recorded write changed, when the installation retains it. */
  private async previousBoardChange(boardId: string, currentText: string): Promise<BoardChangeSummary | undefined> {
    const port = this.options.revisions;
    if (port?.previousText === undefined) return undefined;
    try {
      const previous = await port.previousText(boardId);
      return previous === undefined ? undefined : this.boardChange(previous, currentText);
    } catch { return undefined; }
  }

  /** The bounded problems one failed composition contributes to its report. */
  private editProblems(error: KanbanError): WorkflowProblem[] {
    const problems: WorkflowProblem[] = [{ message: error.message }];
    const details = error.details as { lineNumbers?: unknown; stages?: unknown; closest?: { line?: unknown; text?: unknown } } | undefined;
    const closest = details?.closest;
    if (typeof closest?.line === 'number' && typeof closest.text === 'string') {
      problems.push({ message: 'Closest authored line ' + closest.line + ': ' + closest.text, line: closest.line });
    }
    if (Array.isArray(details?.lineNumbers)) {
      const lines = details.lineNumbers.filter((value): value is number => typeof value === 'number').slice(0, 20);
      const stages = Array.isArray(details.stages) ? details.stages.map(value => typeof value === 'string' ? value : 'unknown').slice(0, 20) : [];
      if (lines.length > 0) problems.push({ message: 'Occurrences at lines ' + lines.join(', ') + (stages.length === 0 ? '.' : ' in stages ' + stages.join(', ') + '.') });
    }
    return problems;
  }

  /**
   * The conflict both a failed composition and a failed save report: the current
   * revision, the revision the caller supplied, what changed, and the report.
   */
  private async conflict(
    input: ComposeBoardWorkflowInput,
    located: { readonly hubRevision: number; readonly board: { readonly workflowYaml: string } },
    report: WorkflowWriteReport,
    context: { readonly rebased: boolean; readonly initialText: string },
  ): Promise<KanbanError> {
    const changes = context.rebased
      ? this.boardChange(context.initialText, located.board.workflowYaml)
      : await this.previousBoardChange(input.boardId, located.board.workflowYaml);
    return new KanbanError('REVISION_CONFLICT', 'The board changed before this write could be applied to its current document.', {
      hubRevision: located.hubRevision,
      ...(input.expectedRevision === undefined ? {} : { staleRevision: input.expectedRevision }),
      boardId: input.boardId,
      ...(changes === undefined ? {} : { changes }),
      report: this.shaped(report, this.workflowOf(located.board.workflowYaml), input.detail ?? 'summary'),
    });
  }

  /** Shape one report for the response mode the caller named. */
  private shaped(report: WorkflowWriteReport, workflow: Workflow | null, detail: WorkflowWriteDetail): WorkflowWriteReport | WorkflowReportSummary {
    return detail === 'full' ? report : summarizeWorkflowReport(report, workflow);
  }

  /**
   * Write one board's workflow composed from the document it holds now, after
   * reviewing the composed document. The report describes exactly the text that
   * is saved: the write pins the revision it read, and a concurrent change is
   * either rebased onto the fresh document or refused with what changed, so a
   * document nobody reported is never saved.
   */
  async saveWorkflowReviewed(input: ComposeBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<WorkflowWriteOutcome> {
    return this.enqueue(async () => {
      const initial = this.locate(input.boardId, input.hubId);
      const initialText = initial.board.workflowYaml;
      let rebased = false;
      for (;;) {
        const located = this.locate(input.boardId, input.hubId);
        // A rebase pins the revision of the read that composed the document, never the
        // stale one the caller supplied or the one read before a conflict.
        const expectedRevision = rebased ? located.hubRevision : input.expectedRevision ?? located.hubRevision;
        let nextText: string;
        try {
          nextText = input.compose(located.board.workflowYaml);
        } catch (error) {
          // A composition that refuses its own edit (an invalid document, a missing
          // initial stage, a malformed stage snippet) is a refusal like any other,
          // and the caller gets the report instead of a bare failure.
          if (!(error instanceof KanbanError)) throw error;
          const report = composeWorkflowReport({ valid: false, problems: this.editProblems(error), difference: null, warnings: [], affectedCards: [], workflow: null, previous: null });
          const stale = input.expectedRevision !== undefined && input.expectedRevision !== located.hubRevision;
          const shaped = this.shaped(report, this.workflowOf(located.board.workflowYaml), input.detail ?? 'summary');
          if (rebased || stale) throw await this.conflict(input, located, report, { rebased, initialText });
          // A failed composition stored no document, so no digest describes it.
          throw new KanbanError(error.code, error.message, { ...error.details, report: shaped });
        }
        const sha256 = this.digestOf(nextText);
        const hub = this.options.hubs.requireHub(located.hubId);
        const report = await this.review({ hub, board: located.board, boardId: input.boardId, previousText: located.board.workflowYaml, nextText });
        if (!report.valid) throw new KanbanError('INVALID_WORKFLOW', refusalMessage(report), { report, sha256 });
        // The expectation is checked against the validated document, before persistence.
        if (input.expectSha256 !== undefined && input.expectSha256 !== sha256) {
          throw new KanbanError('EXPECTED_SHA256_MISMATCH', 'The composed document does not match the expected digest; nothing was saved.', {
            expected: input.expectSha256, actual: sha256, sha256,
          });
        }
        const nextWorkflow = this.workflowOf(nextText)!;
        invariant(input.restorePresetMode === undefined || input.presetChoice === undefined, 'INVALID_INPUT', 'A restore cannot also select a preset.');
        if (input.presetChoice === 'host') invariant(mainAuthoredPreset(nextWorkflow) === undefined, 'INVALID_INPUT', 'Host default requires no authored agent preset.');
        if (input.presetChoice === 'named') invariant(mainAuthoredPreset(nextWorkflow) !== undefined, 'INVALID_INPUT', 'A named preset requires an authored agent preset.');
        const beforeMode = located.board.defaultPresetMode;
        const afterMode = input.restorePresetMode !== undefined ? input.restorePresetMode.value
          : input.presetChoice === 'host' ? 'host' : input.presetChoice === 'named' ? undefined
          : authoredMainAgent(nextWorkflow) !== undefined ? undefined : beforeMode;
        const baseReport = this.shaped(report, nextWorkflow, input.detail ?? 'summary');
        // The document digest does not cover board-owned metadata. Report its change
        // separately, even when an authored preset keeps the effective choice unchanged.
        const shaped = beforeMode === afterMode ? baseReport : {
          ...baseReport,
          boardDefaultPreset: input.detail === 'full' ? {
            before: { mode: beforeMode ?? null, ...effectiveBoardPreset(located.board) },
            after: { mode: afterMode ?? null, ...effectiveBoardPreset({ workflow: nextWorkflow, defaultPresetMode: afterMode }) },
          } : { changed: true },
          sha256Scope: 'workflow-yaml-only' as const,
        };
        // A composed YAML anchor cannot prove the caller observed board metadata.
        // Refuse stale preset writes and previews rather than rebasing them silently.
        const writesPresetMetadata = input.presetChoice !== undefined || input.restorePresetMode !== undefined;
        if (writesPresetMetadata) {
          const current = this.locate(input.boardId, input.hubId);
          if (current.hubRevision !== expectedRevision) throw await this.conflict(input, current, report, { rebased, initialText });
        }
        if (input.dryRun === true) {
          return { saved: false, dryRun: true, hubId: located.hubId, boardId: input.boardId, name: located.board.name, hubRevision: located.hubRevision, sha256, report: shaped };
        }
        // The revision is recorded by the write itself, before it publishes: a
        // publishing pass may rewrite the document to seed stage identities, and
        // the tool's revision must describe the text the tool actually saved.
        const attribution: RevisionAttribution = { actor: input.actor ?? { kind: 'operator' }, origin: input.origin ?? 'editor' };
        try {
          const saved = await this.saveBoardWorkflowNow({ boardId: input.boardId, ...(input.hubId === undefined ? {} : { hubId: input.hubId }), ...(input.name === undefined ? {} : { name: input.name }), workflowYaml: nextText, expectedRevision, revision: attribution, ...(input.presetChoice === undefined ? {} : { presetChoice: input.presetChoice }), ...(input.restorePresetMode === undefined ? {} : { restorePresetMode: input.restorePresetMode }) }, policy);
          return { ...saved, saved: true, sha256, report: shaped, committedRevision: saved.committedRevision ?? saved.hubRevision };
        } catch (error) {
          if (!(error instanceof KanbanError) || error.code !== 'REVISION_CONFLICT') throw attachReport(error, report);
          if (rebased || input.replace === true || writesPresetMetadata) throw await this.conflict(input, this.locate(input.boardId, input.hubId), report, { rebased, initialText });
          // One rebase attempt: re-read the board and compose again. The composition
          // succeeding again is the proof that every anchor still matched.
          rebased = true;
        }
      }
    });
  }

  /**
   * Create one board and report what its supplied document requires. A creation
   * reports no script impact: there is no board yet whose reviewed approvals
   * could be evaluated, and a new board starts without any.
   */
  async createReviewed(input: CreateBoardReviewedInput, policy: BoardPublishingPolicy = 'never'): Promise<WorkflowWriteOutcome> {
    const hubId = this.options.hubs.resolveHubId(input.hubId);
    const hub = this.options.hubs.requireHub(hubId);
    const workflowYaml = input.workflowYaml ?? DEFAULT_WORKFLOW_YAML;
    const sha256 = this.digestOf(workflowYaml);
    const report = await this.review({ hub, board: undefined, boardId: '', previousText: null, nextText: workflowYaml });
    if (!report.valid) throw new KanbanError('INVALID_WORKFLOW', refusalMessage(report), { report, sha256 });
    if (input.expectSha256 !== undefined && input.expectSha256 !== sha256) {
      throw new KanbanError('EXPECTED_SHA256_MISMATCH', 'The supplied document does not match the expected digest; the board was not created.', { expected: input.expectSha256, actual: sha256, sha256 });
    }
    const detail = input.detail ?? 'summary';
    if (input.dryRun === true) {
      return { saved: false, dryRun: true, hubId, boardId: '', name: input.name, hubRevision: hub.revision, sha256, report: this.shaped(report, this.workflowOf(workflowYaml), detail) };
    }
    try {
      const created = await this.create({ ...input, workflowYaml, revision: { actor: input.actor ?? { kind: 'operator' }, origin: input.origin ?? 'editor' } }, policy);
      if (this.options.impact === undefined) return { ...created, saved: true, sha256, report: this.shaped(report, this.workflowOf(workflowYaml), detail), committedRevision: created.committedRevision ?? created.hubRevision };
      // A creation has no evaluated approvals yet, which is exactly the answer an
      // author needs: every scripted stage of the new board is unreviewed.
      try {
        const scripts = await this.options.impact.describe({ hub: this.options.hubs.requireHub(hubId), board: created.board, before: null, after: created.board.workflow });
        return { ...created, saved: true, sha256, report: this.shaped(withScripts(report, scripts), this.workflowOf(workflowYaml), detail), committedRevision: created.committedRevision ?? created.hubRevision };
      } catch (error) {
        this.options.report?.(error);
        return { ...created, saved: true, sha256, report: this.shaped(report, this.workflowOf(workflowYaml), detail), committedRevision: created.committedRevision ?? created.hubRevision };
      }
    } catch (error) {
      throw attachReport(error, report);
    }
  }


  /**
   * Apply one settled import.
   *
   * Every entry is written through the same enqueue the other board writes use,
   * so an import cannot interleave with a board write from another surface. Each
   * entry is applied on its own and a failure is collected rather than thrown: a
   * document that partly applies must report exactly which boards landed.
   *
   * A replacement first realigns the cards whose stage was renamed while keeping
   * its identity, then stores the workflow. The existing orphan refusal still
   * governs the result, so a card that would truly be stranded refuses that board
   * and leaves every other board alone.
   */
  async importBoards(input: ImportBoardInput): Promise<ImportResult> {
    return this.enqueue(async () => {
      const hubId = this.options.hubs.resolveHubId(input.hubId);
      const outcomes: ImportEntryOutcome[] = [];
      for (const entry of input.entries) {
        try { outcomes.push(await this.applyImportEntry(hubId, entry)); }
        catch (error) {
          const refused = problem(error);
          outcomes.push({ name: entry.name, status: 'failed', reason: refused.message, code: refused.code });
        }
      }
      // Pruning waits for the whole document: an identity one entry stops naming may be the
      // one another entry of the same document starts naming. It runs after the entries
      // committed, so a failure here is reported beside the outcomes instead of replacing
      // them with an error that would hide which boards landed.
      let cleanupFailure: Problem | undefined;
      if (outcomes.some(outcome => outcome.status === 'created' || outcome.status === 'replaced')) {
        try { await this.options.hubs.pruneUncitedPlaceholders(hubId); }
        catch (error) {
          this.options.report?.(error);
          cleanupFailure = problem(error);
        }
      }
      return { hubId, outcomes, ...(cleanupFailure === undefined ? {} : { cleanupFailure }) };
    });
  }

  /** One entry of an import, applied on its own. */
  private async applyImportEntry(hubId: string, entry: ImportEntryInput): Promise<ImportEntryOutcome> {
    if (entry.destination === 'skip') return { name: entry.name, status: 'skipped' };
    // A blocked entry is reported rather than written. Its reason is derived from
    // this Hub's own state, so a surface cannot describe a refusal it invented.
    if (entry.destination === 'blocked') {
      return { name: entry.name, status: 'failed', reason: this.importBlockReason(hubId, entry), code: 'TRANSFER_ENTRY_BLOCKED' };
    }
    if (entry.destination === 'replace') {
      invariant(entry.targetBoardId !== null, 'TRANSFER_UNKNOWN_ENTRY', 'A replacement must name the board it overwrites.');
      // The approved target must still be the board this name resolves to. When it
      // is not, the entry is reported rather than redirected to whatever board now
      // holds the name, which would be a write the person never approved.
      const current = this.options.hubs.requireHub(hubId);
      const target = current.boards.find(board => board.id === entry.targetBoardId);
      if (target === undefined) throw new KanbanError('TRANSFER_TARGET_CHANGED', 'Board "' + entry.name + '" was not replaced: the board it would overwrite was removed or renamed while the import was being prepared.');
      if (boardNameKey(target.name) !== boardNameKey(entry.name)) throw new KanbanError('TRANSFER_TARGET_CHANGED', 'Board "' + entry.name + '" was not replaced: the board it would overwrite is now named "' + target.name + '". Read the file again to choose its destination.');
      return { name: entry.name, status: 'replaced', boardId: await this.replaceImported(hubId, entry.targetBoardId, entry) };
    }
    const name = entry.destination === 'copy' ? entry.copyName ?? entry.name : entry.name;
    // A creation whose name a board now holds is refused rather than guessed at, so
    // the plan the person saw is the plan that is applied.
    if (this.options.hubs.requireHub(hubId).boards.some(board => boardNameKey(board.name) === boardNameKey(name))) {
      throw new KanbanError('TRANSFER_TARGET_CHANGED', 'Board "' + name + '" was not created: a board with that name exists now. Read the file again to choose its destination.');
    }
    return { name, status: 'created', boardId: await this.createImported(hubId, name, entry) };
  }

  /**
   * Why one entry cannot be applied, read from this Hub rather than from the caller.
   *
   * A replacement whose incoming document loses a stage names that stage and the
   * cards it holds, which is what the person must move before importing again.
   */
  private importBlockReason(hubId: string, entry: ImportEntryInput): string {
    const readable = entryRefusal({ name: entry.name, workflowYaml: entry.workflowYaml, presetMode: entry.presetMode, projectKeys: null, stageIdentities: entry.stageIdentities });
    if (readable !== null) return '"' + entry.name + '" cannot be applied: ' + readable;
    const target = entry.targetBoardId === null ? undefined : this.options.hubs.requireHub(hubId).boards.find(board => board.id === entry.targetBoardId);
    if (target === undefined) return '"' + entry.name + '" cannot be applied: the board it would replace no longer exists.';
    const hub = this.options.hubs.requireHub(hubId);
    const cards = new Map<string, number>();
    for (const task of hub.tasks) {
      if (task.boardId !== target.id) continue;
      cards.set(task.columnId, (cards.get(task.columnId) ?? 0) + 1);
    }
    const outcome = replacementOutcome({ stored: target, incoming: entry.workflowYaml, cards, associations: entry.stageIdentities });
    // A blocked entry has to say something; an empty outcome means the workflow
    // itself was unreadable, which the plan already reported.
    if (outcome.stranded.length === 0) return 'Board "' + target.name + '" was not replaced: it changed while the import was being prepared.';
    return 'Board "' + target.name + '" was not replaced: ' + orphanedText(outcome.stranded) + ' in a stage the imported workflow does not define. Move those cards, then import again.';
  }

  /** Create one board from an imported entry, with its document, preset, scope, and identities. */
  private async createImported(hubId: string, name: string, entry: ImportEntryInput): Promise<string> {
    const deps = this.deps();
    const boardId = await this.options.hubs.hub(hubId).transact(draft => {
      const created = operations.addBoard(draft, name, deps);
      // The imported associations are written before the save, so the save treats them as
      // the board's own: it reconciles and then freezes only what the document still
      // lacks. Merging afterwards would collide with an identity the save just reserved.
      // Seeded before the save so it never reserves an identity the document names, and
      // restored after it because the save reconciles the map against the board it found,
      // and a freshly created board has none: that would drop every imported association.
      if (entry.stageIdentities !== null) created.localStageIdentities = { ...entry.stageIdentities };
      operations.saveBoardWorkflow(draft, created.id, entry.workflowYaml, deps);
      const board = operations.requireBoard(draft, created.id);
      // An absent import choice stays absent, so the board keeps the host default.
      if (entry.presetMode === null) delete board.defaultPresetMode;
      else board.defaultPresetMode = entry.presetMode;
      operations.ensurePublishedProjects(draft, entry.projectScope ?? [], deps);
      operations.setBoardProjectScope(draft, created.id, entry.projectScope, deps, { prune: false });
      // The document associations are restored over the save result, which reconciled
      // against an empty board and would otherwise drop them, and the resulting map is
      // what the board keeps.
      if (entry.stageIdentities !== null) board.localStageIdentities = { ...board.localStageIdentities, ...entry.stageIdentities };
      incomingIdentities(board.workflow, board.localStageIdentities ?? null);
      return created.id;
    });
    const board = this.requireBoard(hubId, boardId);
    this.noteLocalChange(hubId);
    await this.noteRevision(hubId, boardId, null, board.workflowYaml, undefined, board.defaultPresetMode, { actor: { kind: 'operator' }, origin: 'editor' });
    return boardId;
  }

  /**
   * Replace one board's workflow from an imported entry.
   *
   * The realignment runs inside the same transaction that stores the document, so
   * the Hub never observes a card in a stage its board does not define. A card
   * whose stage identity no incoming stage carries is left alone and the existing
   * orphan refusal reports it, refusing only this board.
   */
  private async replaceImported(hubId: string, boardId: string, entry: ImportEntryInput): Promise<string> {
    const located = this.locate(boardId, hubId);
    const previous = located.board.workflowYaml;
    const previousPresetMode = located.board.defaultPresetMode;
    const deps = this.deps();
    const incoming = parseWorkflow(entry.workflowYaml);
    const incomingById = new Set(incoming.columns.map(column => column.id));
    // The identities the board will hold, resolved BEFORE any card moves: the imported
    // associations merged with what the stored board already associates. A rename must
    // resolve against this final map, otherwise a card could follow an identity the
    // merge then changes, landing it in a stage that no longer carries it.
    // The identities the board will hold, computed with the SAME rule the save applies:
    // `reconcileLocalStageIdentities` carries a stored association across a rename by
    // the authored `key`, and `ensureLocalStageIdentity` then freezes one for every
    // stage a script or decision names. Using a different rule here would move a card
    // to a stage whose persisted identity is not the one that chose it.
    const projected = structuredClone(located.board);
    reconcileLocalStageIdentities(projected, incoming);
    // The imported association wins over the projected one, matching the order the
    // board associations are written below; reading them in the opposite order would
    // resolve a card through an identity the commit then replaces.
    const finalAssociations: Record<string, string> = { ...(projected.localStageIdentities ?? {}), ...(entry.stageIdentities ?? {}) };
    for (const column of incoming.columns) if (column.key !== undefined) finalAssociations[column.id] = finalAssociations[column.id] ?? column.key;
    const incomingByIdentity = new Map<string, string>();
    for (const [columnId, identity] of incomingIdentities(incoming, finalAssociations)) incomingByIdentity.set(identity, columnId);
    await this.options.hubs.hub(hubId).transact(draft => {
      const stored = operations.requireBoard(draft, boardId);
      // One rename per removed stage, resolved once from the identities the stored
      // board held and the ones the document brings, then carried into every card
      // of the board: a card in another stage still names the old identifier in its
      // own history, pending transition, instruction marker, and scripted handoff.
      const renames = new Map<string, string>();
      for (const column of stored.workflow.columns) {
        if (incomingById.has(column.id)) continue;
        const identity = stored.localStageIdentities?.[column.id] ?? column.key;
        const target = identity === undefined ? undefined : incomingByIdentity.get(identity);
        if (target !== undefined) renames.set(column.id, target);
      }
      for (const task of draft.tasks) {
        if (task.boardId !== boardId || renames.size === 0) continue;
        for (const [from, to] of renames) renameTaskStage(task, from, to);
      }
      // The board takes the map the plan already resolved, not a merge over the OLD one.
      // Seeding the old map would let reconcile drop an imported association and carry the
      // previous stage identity onto the renamed stage, which is the collision that used to
      // refuse a legitimate replacement. Seeding the final map also makes the save see every
      // imported association as the board own, so it never freezes over one.
      stored.localStageIdentities = { ...finalAssociations };
      operations.saveBoardWorkflow(draft, boardId, entry.workflowYaml, deps);
      const board = operations.requireBoard(draft, boardId);
      // The imported name is the board's name, so a difference in capitalisation
      // still lands under the name the document carries.
      if (entry.name !== stored.name) operations.renameBoard(draft, boardId, entry.name, deps);
      if (entry.presetMode === null) delete board.defaultPresetMode;
      else board.defaultPresetMode = entry.presetMode;
      operations.ensurePublishedProjects(draft, entry.projectScope ?? [], deps);
      operations.setBoardProjectScope(draft, boardId, entry.projectScope, deps, { prune: false });
      // The save reconciles the map from the authored keys, which would drop the
      // associations the resolution above relied on. The resolved map is restored over the
      // save result, so the persisted identities are exactly the ones that chose where each
      // card went, and only then validated.
      board.localStageIdentities = { ...finalAssociations };
      incomingIdentities(board.workflow, board.localStageIdentities);
    });
    const board = this.requireBoard(hubId, boardId);
    this.noteLocalChange(hubId);
    await this.noteRevision(hubId, boardId, previous, board.workflowYaml, previousPresetMode, board.defaultPresetMode, { actor: { kind: 'operator' }, origin: 'editor' });
    return boardId;
  }

  async editWorkflow(input: EditBoardWorkflowInput, policy: BoardPublishingPolicy = 'never'): Promise<BoardWriteResult> {
    return this.enqueue(async () => {
      const located = this.locate(input.boardId, input.hubId);
      const previous = located.board.workflowYaml;
      const previousPresetMode = located.board.defaultPresetMode;
      const board = await this.options.hubs.hub(located.hubId).editBoardWorkflow(input.boardId, input.edits, input.expectedRevision);
      this.noteLocalChange(located.hubId);
      await this.noteRevision(located.hubId, input.boardId, previous, board.workflowYaml, previousPresetMode, board.defaultPresetMode, input.revision);
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
        ? { status: 'not-published', reason: 'manual' }
        : { status: 'published' };
      return this.result(located.hubId, board, sharing);
    });
  }

  /**
   * Publish after a successful local write. A refusal never rolls the local change
   * back; the caller reports the outcome instead of retrying the write.
   */
  private async publishOutcome(hubId: string, boardId: string, policy: BoardPublishingPolicy): Promise<BoardPublishingOutcome> {
    if (policy === 'never') return { status: 'not-published', reason: 'manual' };
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