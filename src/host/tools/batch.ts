import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { composeWorkflowBatch, MAX_BATCH_OPERATIONS } from '../../domain/workflow-batch.js';
import { workflowCardReferences } from '../../domain/workflow-card-references.js';
import { unifiedLineDiff } from '../../domain/workflow-diff-text.js';
import { workflowImpact } from '../../domain/workflow-impact.js';
import { orphanedStageReferences } from '../../domain/workflow-orphans.js';
import { composeWorkflowReport, reviewWorkflowText, summarizeWorkflowReport, type WorkflowReportSummary, type WorkflowWriteReport } from '../../domain/workflow-report.js';
import type { WorkflowImpactReport } from '../../domain/workflow-impact.js';
import type { AppliedBatchOperation } from '../../domain/workflow-batch.js';
import type { WorkflowProblem } from '../../domain/workflow-diagnostics.js';
import type { Workflow } from '../../shared/types.js';
import type { WorkflowPreviewSnapshot } from '../workflow-preview-store.js';
import { WorkflowPreviewStore } from '../workflow-preview-store.js';
import { actorOf, digestRefusal, normal, refusal, text, written } from './support.js';
import { intent, revisionParameter, workflowWriteControls, type WorkflowAuthoringPort } from './authoring.js';
import { assertBoardWriteAllowed, resolveBoard, type ToolArgs } from './scope.js';

/** The most characters one review page carries before JSON escaping is considered. */
const PREVIEW_PAGE_CHARACTERS = 4000;
/**
 * The most escaped characters one page may render. A page is a JSON string inside the
 * tool result, so a line full of quotes or control characters costs more than its
 * length; budgeting the escaped form keeps every page reviewable.
 */
const PREVIEW_PAGE_ESCAPED = 2000;
/** How many characters the page builder grows at a time while it measures the budget. */
const PAGE_STEP = 256;
/**
 * How large one first response may render, in characters, before lists are trimmed.
 * The host prunes a tool result above 8,192 characters, and the tool result is the
 * pretty-printed JSON of this value, so a first response stays below that ceiling.
 */
const INITIAL_RENDER_BUDGET = 7600;

function digestOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The conversation that must own a preview handle. */
function conversationOf(exec: ToolRunContext): string {
  const id = exec.agent?.id;
  invariant(typeof id === 'string' && id.length > 0, 'MISSING_SESSION', 'A preview belongs to the conversation that created it.');
  return id;
}

/** The escaped length of one string as JSON, without its surrounding quotes. */
function escapedLength(value: string): number {
  return JSON.stringify(value).length - 2;
}

/** A page boundary never splits a surrogate pair, so every page is valid Unicode. */
function boundaryAt(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length) return Math.max(0, Math.min(offset, text.length));
  const unit = text.charCodeAt(offset);
  return unit >= 0xdc00 && unit <= 0xdfff ? offset - 1 : offset;
}

/**
 * One bounded page of an immutable preview artifact, addressed by character offset.
 *
 * The range is exact and resumable: concatenating each page from its `nextOffset`
 * reproduces the artifact byte for byte, including one very long authored line. The
 * escaped-size budget keeps the rendered JSON reviewable whatever the content is.
 */
function pageOf(value: string, offsetValue: number | undefined, limitValue: number | undefined, escapedBudget = PREVIEW_PAGE_ESCAPED) {
  const total = value.length;
  const requestedOffset = Number.isFinite(offsetValue) ? Math.trunc(offsetValue as number) : 0;
  const offset = boundaryAt(value, Math.min(Math.max(requestedOffset, 0), total));
  const requestedLimit = Number.isFinite(limitValue) ? Math.max(1, Math.trunc(limitValue as number)) : PREVIEW_PAGE_CHARACTERS;
  const limit = Math.min(requestedLimit, PREVIEW_PAGE_CHARACTERS);
  let end = offset;
  while (end < total && end - offset < limit) {
    const candidate = boundaryAt(value, Math.min(total, offset + limit, end + PAGE_STEP));
    if (candidate <= end) break;
    if (escapedLength(value.slice(offset, candidate)) > escapedBudget) break;
    end = candidate;
  }
  // A remainder always yields progress, even when the requested limit is one unit
  // inside a surrogate pair, so a caller can never be stuck on an offset.
  if (end === offset && offset < total) end = Math.max(boundaryAt(value, Math.min(total, offset + 2)), Math.min(total, offset + 2));
  return { offset, limit, totalCharacters: total, text: value.slice(offset, end), ...(end < total ? { nextOffset: end } : {}) };
}

/** The identity a preview carries into every response about it, as it was reviewed. */
function previewHeader(preview: WorkflowPreviewSnapshot) {
  return {
    previewId: preview.id, boardId: preview.boardId, hubId: preview.hubId, hubRevision: preview.hubRevision,
    baseSha256: preview.baseSha256, sha256: preview.sha256, operations: preview.operations,
  };
}

/** The report a preview or an apply returns, in the shape the caller named. */
function reportOf(report: WorkflowWriteReport, workflow: Workflow | null, detail: 'summary' | 'full' | undefined) {
  return detail === 'full' ? report : summarizeWorkflowReport(report, workflow);
}

/** The rendered size of one tool result, as the host renders it. */
function renderedLength(value: unknown): number {
  return JSON.stringify(value, null, 2).length;
}

/**
 * The same report with every list emptied and each length moved into its omission
 * count, so the first response surfaces the scalars and the true counts while the
 * complete material stays readable from the immutable preview.
 */
function trimReport(report: WorkflowWriteReport | WorkflowReportSummary): WorkflowWriteReport | WorkflowReportSummary {
  if (report.mode === 'full') {
    return {
      ...report,
      difference: report.difference === null ? null : { workflow: [], stages: [], groups: [], connections: [] },
      differenceOmitted: report.differenceOmitted + (report.difference?.stages.length ?? 0),
      warnings: [], warningsOmitted: report.warningsOmitted + report.warnings.length,
      scripts: [], scriptsOmitted: report.scriptsOmitted + report.scripts.length,
      affectedCards: [], affectedCardsOmitted: report.affectedCardsOmitted + report.affectedCards.length,
    };
  }
  return {
    ...report,
    workflow: [], stages: [], groups: [], connections: [],
    differenceOmitted: report.differenceOmitted + report.stages.length,
    warnings: [], warningsOmitted: report.warningsOmitted + report.warnings.length,
    scripts: [], scriptsOmitted: report.scriptsOmitted + report.scripts.length,
    affectedCards: [], affectedCardsOmitted: report.affectedCardsOmitted + report.affectedCards.length,
    sizes: [],
  };
}

/** The same impact report with every list emptied and its counts kept. */
function trimImpact(impact: WorkflowImpactReport): WorkflowImpactReport {
  return {
    ...impact,
    changedStages: [], changedStagesOmitted: impact.changedStagesOmitted + impact.changedStages.length,
    changedAgents: [], changedAgentsOmitted: impact.changedAgentsOmitted + impact.changedAgents.length,
    cards: [], cardsOmitted: impact.cardsOmitted + impact.cards.length,
  };
}

/** The structured problems one composition refusal carried, when it carried any. */
function problemsOf(error: KanbanError): WorkflowProblem[] | undefined {
  const problems = error.details?.problems;
  if (!Array.isArray(problems)) return undefined;
  return problems as WorkflowProblem[];
}

/**
 * The architect-only preview and exact apply of one ordered workflow batch.
 *
 * The preview resolves one Hub snapshot, composes in memory, reviews the whole
 * candidate with the same validation, script authorization, and impact semantics a
 * save uses, and retains the exact bytes against that snapshot's revision. Apply
 * commits exactly those bytes through the existing reviewed board write, and a
 * changed Hub revision or digest is refused without saving, rebasing, or substituting
 * the live document.
 */
export function batchTools(
  app: KanbanApp,
  port: WorkflowAuthoringPort = app.boards as BoardAdministration,
  store: WorkflowPreviewStore = new WorkflowPreviewStore(),
): ToolDefinition[] {
  return [
    normal('preview_workflow_batch',
      'Review an ordered batch of structured workflow edits on one board without saving anything. The operations compose in order — set_agent, remove_agent, set_stage_agent, set_stage_prompt, set_stage_routes, and set_layout — and each uses the same rules and destination checks as its focused tool. Returns the exact candidate YAML, its textual diff, the SHA-256 of the candidate bytes, the reviewed base revision, the validation report with errors separated from warnings, the reviewed script authorization, and the cards and routes the candidate would affect. The report and the card references come from the same Hub snapshot as the quoted revision. A failing operation names its index and no preview handle is issued. Nothing is stored: the board, its revision history, its tasks, and its publication are unchanged. When a first response cannot carry the whole report or impact under the tool-result budget, it trims the listed material, keeps the true counts, and sets reportTruncated or impactTruncated; the complete reviewed report and impact are always readable from the same preview through part report or part impact. Pass preview_id with part, offset, and limit to read the candidate, diff, report, or impact again in order, by character offset. The returned YAML can still be measured with layout_metrics, including synthetic card counts.',
      {
        board_id: text('Board ID the batch edits. Required for a new preview and refused on a continued read.'),
        expected_revision: revisionParameter,
        operations: {
          type: 'array',
          description: 'The ordered structured operations. Each sees the result of the previous one, so add an agent before binding it and clear a binding before removing its agent. ' + MAX_BATCH_OPERATIONS + ' operations at most.',
          items: {
            oneOf: [
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['set_agent'], required: true },
                  agent_id: text('Agent identity; an existing entry is replaced.', true),
                  name: text('Agent display name.', true),
                  preset: text('Agent preset identity. An empty string keeps the host default.'),
                  model_provider: text('Model provider identity, together with model_name.'),
                  model_name: text('Model identity, together with model_provider.'),
                  model_reasoning_effort: text('Reasoning effort for the agent model, when the provider offers efforts.'),
                },
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['remove_agent'], required: true },
                  agent_id: text('Agent identity to remove.', true),
                },
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['set_stage_agent'], required: true },
                  stage_id: text('Stage ID to bind.', true),
                  agent_id: text('Agent identity the stage runs with. An empty string returns it to the main conversation.'),
                },
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['set_stage_prompt'], required: true },
                  stage_id: text('Stage ID whose entry instruction changes.', true),
                  prompt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'The entry instruction; null or an empty string clears it.' },
                },
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['set_stage_routes'], required: true },
                  stage_id: text('Stage ID whose routes change.', true),
                  transitions: { type: 'array', description: 'Destinations the stage permits, each a stage id or an object with to and an optional when condition. An empty list permits none.', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, properties: { to: { type: 'string', required: true }, when: { type: 'string' } } }] } },
                  permit_any: { type: 'boolean', description: 'Author no transition list, so the stage permits any other stage.' },
                  exits: { type: 'object', additionalProperties: true, description: 'Named exits mapped to destination stage ids, for a scripted stage.' },
                },
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  op: { type: 'string', enum: ['set_layout'], required: true },
                  positions: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {x, y}, or to null to clear its placement.' },
                  sizes: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {width, height}, or to null to clear its size.' },
                  connections: { type: 'array', description: 'Connection layouts to write or remove, each with from, to, optional source and target anchors, optional segments, and remove to clear the entry.', items: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, source: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, target: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, segments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { axis: { type: 'string', enum: ['x', 'y'], required: true }, offset: { type: 'number', required: true } } } }, remove: { type: 'boolean' } } } },
                },
              },
            ],
          },
        },
        preview_id: text('Opaque preview ID to read again instead of creating a preview.'),
        part: { type: 'string', enum: ['yaml', 'diff', 'report', 'impact'], description: 'The part a continued read returns: the candidate, its diff, the reviewed report, or its impact report. Defaults to yaml.' },
        offset: { type: 'integer', description: 'Zero-based character offset a continued read starts at. Defaults to the first character.' },
        limit: { type: 'integer', description: 'How many characters a continued read may return. Defaults to ' + PREVIEW_PAGE_CHARACTERS + ' and is capped at that.' },
        hub_id: text('Hub ID. Optional when the board identifier is enough.'),
        detail: workflowWriteControls.detail,
      },
      async (args, exec) => {
        await assertBoardWriteAllowed(app, exec);
        const conversationId = conversationOf(exec);
        if (args.preview_id !== undefined) {
          invariant(args.board_id === undefined && args.expected_revision === undefined && args.operations === undefined && args.hub_id === undefined,
            'INVALID_INPUT', 'A continued read names only preview_id, part, offset, and limit.');
          const preview = store.get(args.preview_id, conversationId);
          const part = args.part ?? 'yaml';
          // The reviewed report and impact are retained as their exact rendered text,
          // so a first response that had to trim them can be completed from the same
          // immutable snapshot, never from live board state.
          const source = part === 'diff' ? preview.diff
            : part === 'report' ? preview.reportText
            : part === 'impact' ? preview.impactText
            : preview.candidate;
          const page = pageOf(source, args.offset, args.limit);
          return {
            previewed: true as const, ...previewHeader(preview), part,
            offset: page.offset, limit: page.limit, totalCharacters: page.totalCharacters,
            ...(part === 'yaml' ? { yaml: page.text } : part === 'diff' ? { diff: page.text } : { text: page.text }),
            ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
          };
        }
        invariant(args.board_id !== undefined, 'INVALID_INPUT', 'A new preview requires board_id, expected_revision, and operations.');
        invariant(args.expected_revision !== undefined, 'INVALID_INPUT', 'A new preview requires expected_revision from the exact board read it composes against.');
        invariant(args.operations !== undefined, 'INVALID_INPUT', 'A new preview requires at least one operation.');
        const located = resolveBoard(app, args as ToolArgs, exec);
        const { board, hub, hubId } = located;
        // One snapshot: the base document, the revision, and the card references all
        // come from this Hub state, so a commit during a later await cannot mix a
        // newer card into a report that quotes an older revision.
        const base = board.workflowYaml;
        const hubRevision = hub.revision;
        const cards = workflowCardReferences(hub, board.id);
        const refused = (error: KanbanError, extra: Record<string, unknown> = {}) => ({
          previewed: false as const, boardId: board.id, hubId, hubRevision,
          error: {
            code: error.code, message: error.message,
            ...(typeof error.details?.index === 'number' ? { operationIndex: error.details.index } : {}),
            ...(typeof error.details?.operation === 'string' ? { operation: error.details.operation } : {}),
          },
          ...extra,
        });
        if (args.expected_revision !== hubRevision) {
          return refused(new KanbanError('REVISION_CONFLICT', 'The Hub revision changed since the read this batch quotes; nothing was previewed. Read the board again and quote revision ' + hubRevision + '.', { hubRevision, staleRevision: args.expected_revision }));
        }
        let composition;
        try {
          composition = composeWorkflowBatch({ text: base, operations: args.operations as readonly unknown[] });
        } catch (error) {
          if (!(error instanceof KanbanError)) throw error;
          const problems = problemsOf(error);
          if (problems === undefined) return refused(error);
          // The operation that introduced an invalid document reports its index and
          // the positioned problems, and the same whole-document report a save gives.
          const invalid = composeWorkflowReport({ valid: false, problems, difference: null, warnings: [], affectedCards: [], workflow: null, previous: null });
          return refused(error, { problems, report: reportOf(invalid, null, args.detail) });
        }
        const availability = await port.agentAvailability?.();
        const review = reviewWorkflowText({ text: composition.text, previousText: base, cards, ...(availability === undefined ? {} : { availability }) });
        if (!review.valid || review.workflow === null) {
          const invalid = composeWorkflowReport(review);
          return refused(new KanbanError('INVALID_WORKFLOW', 'The composed document is not a valid workflow; nothing was previewed.'),
            { problems: review.problems, report: reportOf(invalid, review.workflow, args.detail) });
        }
        const orphaned = orphanedStageReferences(review.workflow, cards);
        const scripts = port.describeScriptImpact === undefined
          ? { inspected: false, impacts: [] }
          : await port.describeScriptImpact({ hub, board, before: review.previous, after: review.workflow });
        const report = composeWorkflowReport(review, scripts.impacts);
        const shaped = reportOf(report, review.workflow, args.detail);
        if (orphaned.length > 0) {
          return refused(new KanbanError('WORKFLOW_ORPHAN_COLUMNS', 'The candidate would orphan existing task columns: ' + orphaned.join(', ') + '.'), { report: shaped });
        }
        const candidate = composition.text;
        const impact = workflowImpact(review.previous, review.workflow, cards);
        const reportText = JSON.stringify(shaped, null, 2);
        const impactText = JSON.stringify(impact, null, 2);
        const preview = store.keep({
          conversationId, hubId, boardId: board.id, hubRevision,
          baseSha256: digestOf(base), sha256: digestOf(candidate), candidate,
          diff: unifiedLineDiff(base, candidate), operations: composition.operations.length,
          reportText, impactText,
        });
        // A first response stays below the host's pruning ceiling. The pages are bounded,
        // and when the reviewed material still does not fit the lists are trimmed with
        // their true counts; the complete report and impact stay readable from the same
        // immutable preview through part: report or part: impact.
        const firstResponse = (input: {
          report: WorkflowWriteReport | WorkflowReportSummary;
          impact: WorkflowImpactReport;
          truncated: boolean;
          yamlBudget: number;
          diffBudget: number;
          appliedOperations?: readonly AppliedBatchOperation[];
        }) => {
          const yamlPage = pageOf(preview.candidate, 0, undefined, input.yamlBudget);
          const diffPage = pageOf(preview.diff, 0, undefined, input.diffBudget);
          return {
            previewed: true as const,
            ...previewHeader(preview),
            ...(input.appliedOperations === undefined ? {} : { appliedOperations: input.appliedOperations }),
            yaml: yamlPage.text, yamlOffset: yamlPage.offset, yamlTotalCharacters: yamlPage.totalCharacters,
            ...(yamlPage.nextOffset === undefined ? {} : { yamlNextOffset: yamlPage.nextOffset }),
            diff: diffPage.text, diffOffset: diffPage.offset, diffTotalCharacters: diffPage.totalCharacters,
            ...(diffPage.nextOffset === undefined ? {} : { diffNextOffset: diffPage.nextOffset }),
            report: input.report,
            reportTruncated: input.truncated,
            reportCharacters: reportText.length,
            scriptAuthorizationInspected: scripts.inspected,
            impact: input.impact,
            impactTruncated: input.truncated,
            impactCharacters: impactText.length,
          };
        };
        const variants = [
          firstResponse({ report: shaped, impact, truncated: false, yamlBudget: PREVIEW_PAGE_ESCAPED, diffBudget: PREVIEW_PAGE_ESCAPED, appliedOperations: composition.operations }),
          firstResponse({ report: trimReport(shaped), impact: trimImpact(impact), truncated: true, yamlBudget: PREVIEW_PAGE_ESCAPED, diffBudget: PREVIEW_PAGE_ESCAPED, appliedOperations: composition.operations }),
          firstResponse({ report: trimReport(shaped), impact: trimImpact(impact), truncated: true, yamlBudget: 600, diffBudget: 600, appliedOperations: composition.operations }),
          firstResponse({ report: trimReport(shaped), impact: trimImpact(impact), truncated: true, yamlBudget: 200, diffBudget: 200 }),
        ];
        let response = variants[variants.length - 1]!;
        for (const variant of variants) {
          response = variant;
          if (renderedLength(variant) <= INITIAL_RENDER_BUDGET) break;
        }
        return response;
      }),

    normal('apply_workflow_batch',
      intent + 'Save exactly the workflow document a preview_workflow_batch preview returned. It names only the preview handle and its expected candidate digest; it accepts no operations, document, revision, or publishing choice. Review the exact candidate and its impacts with the user and obtain explicit approval first: a preview handle is not approval. The write stores the previewed bytes in one local change, refuses a stale Hub revision or a changed digest without saving anything or rebasing, returns the stored digest and the revision its own write committed, and keeps publishing separate.',
      {
        preview_id: text('The preview handle to apply.', true),
        expect_sha256: text('The candidate digest the preview reported; a mismatch refuses the apply.', true),
        detail: workflowWriteControls.detail,
      },
      async (args, exec) => {
        await assertBoardWriteAllowed(app, exec);
        const conversationId = conversationOf(exec);
        const preview = store.get(args.preview_id, conversationId);
        const header = { previewId: preview.id, boardId: preview.boardId, hubId: preview.hubId };
        if (args.expect_sha256 !== preview.sha256) {
          return {
            saved: false as const, ...header,
            error: { code: 'EXPECTED_SHA256_MISMATCH', message: 'The digest does not match the previewed candidate; nothing was saved.' },
            expected: args.expect_sha256, actual: preview.sha256,
          };
        }
        try {
          const value = await port.saveWorkflowReviewed({
            boardId: preview.boardId,
            hubId: preview.hubId,
            compose: () => preview.candidate,
            replace: true,
            expectedRevision: preview.hubRevision,
            expectSha256: preview.sha256,
            ...(args.detail === undefined ? {} : { detail: args.detail }),
            actor: actorOf(exec), origin: 'tool',
          }, 'never');
          invariant(value.saved, 'INVALID_INPUT', 'The workflow was not saved.');
          // The receipt describes this write: the bytes its transaction committed and
          // the revision that transaction reached, never a later read of the board.
          const storedSha256 = digestOf(value.board.workflowYaml);
          return {
            ...written(value),
            ...header,
            hubRevision: value.committedRevision,
            committedRevision: value.committedRevision,
            currentHubRevision: value.hubRevision,
            storedSha256,
            verified: storedSha256 === preview.sha256,
          };
        } catch (error) {
          const refused = refusal(error);
          const digest = digestRefusal(error);
          if (error instanceof KanbanError && error.code === 'REVISION_CONFLICT') {
            // The Hub moved after the review. A changed revision is refused even when
            // it left the workflow text identical, because the impacts were reviewed
            // against the revision the preview captured.
            return {
              ...(refused ?? { saved: false as const, error: { code: error.code, message: error.message } }),
              ...header, stalePreview: true,
            };
          }
          if (refused !== undefined) return { ...refused, ...header };
          if (digest !== undefined) return { ...digest, ...header };
          throw error;
        }
      }),
  ];
}
