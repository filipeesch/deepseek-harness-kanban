import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration, BoardPublishingPolicy, BoardView, BoardWriteResult, ComposeBoardWorkflowInput, WorkflowWriteDetail, WorkflowWriteOutcome } from '../board-administration.js';
import type { DecisionDefinition, Workflow } from '../../shared/types.js';
import type { ScriptedDefinition } from '../../shared/scripted.js';
import type { WorkflowCardReference, WorkflowWriteReport } from '../../domain/workflow-report.js';
import { composeWorkflowReport, summarizeWorkflowReport } from '../../domain/workflow-report.js';
import { invariant } from '../../shared/errors.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { parseDecisionDefinition } from '../../domain/decision-definition.js';
import { effectiveBoardPreset } from '../../domain/board-preset.js';
import type { AgentAvailability } from '../../domain/workflow-warnings.js';
import type { ScriptedImpactInput } from '../scripted-impact.js';
import type { ScriptAuthorization } from '../board-administration.js';
import { updateStage } from '../../domain/stage-update.js';
import { addStage, removeStage } from '../../domain/workflow-stage-edit.js';
import { readStage } from '../../domain/workflow-stage-read.js';
import { setStageInstruction, setStageLayout, setStageRoutes, stageRoutesPatch } from '../../domain/workflow-operations.js';
import { actorOf, digestRefusal, flag, normal, refusal, text, written } from './support.js';
import { assertBoardWriteAllowed, resolveBoard, type ToolArgs } from './scope.js';

/** How many lines of an authored document one read returns before the caller asks for more. */
const READ_LINE_LIMIT = 400;

export const intent = 'Use ONLY when the user explicitly requests this board change. ';

export const preserveNote = ' Only the named fields are rewritten; comments, key order, quoting, and every other authored character stay as they are.';

/** The one revision parameter every board write names, with the rebase rule it obeys. */
export const revisionParameter = { type: 'integer', description: 'Hub revision from a prior read. A composed write is reapplied to the current document when every anchor still matches; a whole-document replacement refuses a stale revision.' } as const;

export const reportNote = ' The change is local; publishing it to a team stays a manual action in the interface. The result carries the digest of the exact document stored and a write report: the changed stages and their changed field names, the graph warnings, the reviewed authorization of every scripted stage for the board, and the affected cards. The report is a summary by default and the per-field values only when detail is full. A refused write saves nothing and returns the same report.';

/** The document, stage, and write surface the authoring tools need. */
export interface WorkflowAuthoringPort {
  read(boardId: string, hubId?: string): BoardView;
  cards(boardId: string, hubId?: string): WorkflowCardReference[];
  saveWorkflowReviewed(input: ComposeBoardWorkflowInput, policy?: BoardPublishingPolicy): Promise<WorkflowWriteOutcome>;
  /** What the running host reports about presets and models; absent skips availability warnings. */
  agentAvailability?(): Promise<AgentAvailability | undefined>;
  /** The reviewed script authorization for a composed document, against one snapshot. */
  describeScriptImpact?(input: ScriptedImpactInput): Promise<ScriptAuthorization>;
}

export interface WriteArgs extends ToolArgs {
  readonly board_id: string;
  readonly expected_revision?: number;
  readonly expect_sha256?: string;
  readonly dry_run?: boolean;
  readonly detail?: WorkflowWriteDetail;
}

/**
 * The three controls every workflow write accepts. They are listed once so no
 * write tool can drift from the others in name, wording, or default.
 */
export const workflowWriteControls = {
  expect_sha256: text('The sha256 digest of the exact document this write must store. A mismatch refuses the write and saves nothing.'),
  dry_run: flag('Review exactly as a write does and persist nothing; no document, revision, or publishing change.'),
  detail: { type: 'string', enum: ['summary', 'full'], description: 'Report shape. The summary is the default and names the changed stages and fields without their text.' },
} as const;

/** The parts of one stage's scripted configuration a patch may name. */
interface ScriptPatch {
  readonly language?: 'bash' | 'typescript';
  readonly code?: string;
  readonly file?: string;
  readonly directory?: 'task' | 'project';
  readonly env?: readonly string[];
  readonly params?: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
  readonly exits?: Readonly<Record<string, string>>;
}

/**
 * One stage's scripted configuration after a partial write: the named parts
 * replaced, every other part kept as authored, and a source swap never leaving two.
 */
function mergeScriptPatch(current: ScriptedDefinition | undefined, patch: ScriptPatch): ScriptedDefinition {
  invariant(current !== undefined || patch.language !== undefined, 'INVALID_INPUT', 'A stage with no script requires a language.');
  invariant(!(patch.code !== undefined && patch.file !== undefined), 'INVALID_INPUT', 'Name one source: inline code or an external file, not both.');
  invariant(current !== undefined || (patch.code === undefined) !== (patch.file === undefined), 'INVALID_INPUT', 'A stage with no script requires exactly one of code or file.');
  invariant(current !== undefined || patch.exits !== undefined, 'INVALID_INPUT', 'A stage with no script requires its named exits.');
  const next: ScriptedDefinition = current === undefined
    ? { language: patch.language!, directory: patch.directory ?? 'task', exits: {} }
    : structuredClone(current);
  if (patch.language !== undefined) next.language = patch.language;
  if (patch.code !== undefined) { next.code = patch.code; delete next.file; }
  if (patch.file !== undefined) { next.file = patch.file; delete next.code; }
  if (patch.directory !== undefined) next.directory = patch.directory;
  if (patch.env !== undefined) { if (patch.env.length === 0) delete next.env; else next.env = [...patch.env]; }
  if (patch.params !== undefined) {
    if (patch.params.length === 0) delete next.params;
    else next.params = patch.params.map(parameter => ({ name: parameter.name, ...(parameter.description === undefined ? {} : { description: parameter.description }) }));
  }
  if (patch.exits !== undefined) next.exits = { ...patch.exits };
  return next;
}


/** The parts of one stage's decision configuration a patch may name. */
interface DecisionPatch {
  readonly question?: string;
  readonly context?: string | null;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly title: string; readonly description?: string; readonly to: string }>;
}

/**
 * One stage's decision configuration after a partial write: the named parts
 * replaced, every other part kept as authored, and a first write required to be
 * complete. Destinations are checked against the workflow before composition.
 */
function mergeDecisionPatch(current: DecisionDefinition | undefined, patch: DecisionPatch, workflow: Workflow, stageId: string): DecisionDefinition {
  const question = patch.question ?? current?.question;
  invariant(question !== undefined, 'INVALID_INPUT', 'A stage with no decision configuration requires a question.');
  const context = patch.context === null ? undefined : (patch.context ?? current?.context);
  const options = patch.options ?? current?.options;
  invariant(options !== undefined && options.length > 0, 'INVALID_INPUT', 'A decision configuration requires at least one option.');
  for (const option of options) {
    invariant(workflow.columns.some(column => column.id === option.to), 'INVALID_TARGET', 'Option ' + option.id + ' names a destination the workflow does not define.');
    invariant(option.to !== stageId, 'INVALID_TARGET', 'A decision option cannot target its own stage.');
  }
  const definition: DecisionDefinition = {
    question,
    ...(context === undefined || context.trim().length === 0 ? {} : { context }),
    options: options.map(option => ({ id: option.id, title: option.title, ...(option.description === undefined || option.description.trim().length === 0 ? {} : { description: option.description }), to: option.to })),
  };
  // The same codec the parser uses rejects a partial or oversized definition here.
  return parseDecisionDefinition(definition);
}

/** The authored document one write is composed from, as the port reports it. */
export function authored(port: WorkflowAuthoringPort, args: WriteArgs): { view: BoardView; workflow: Workflow } {
  const view = port.read(args.board_id, args.hub_id);
  return { view, workflow: parseWorkflow(view.board.workflowYaml) };
}

/** Run one reviewed write, returning the report on success and on refusal alike. */
export async function write(port: WorkflowAuthoringPort, args: WriteArgs, exec: ToolRunContext, compose: (current: string) => string): Promise<unknown> {
  try {
    const value = await port.saveWorkflowReviewed({
      boardId: args.board_id,
      ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }),
      ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }),
      ...(args.expect_sha256 === undefined ? {} : { expectSha256: args.expect_sha256 }),
      ...(args.dry_run === true ? { dryRun: true } : {}),
      ...(args.detail === undefined ? {} : { detail: args.detail }),
      actor: actorOf(exec), origin: 'tool', compose,
    });
    return written(value);
  } catch (error) {
    const refused = refusal(error);
    if (refused !== undefined) return refused;
    const digest = digestRefusal(error);
    if (digest !== undefined) return digest;
    throw error;
  }
}

/** Write the exact authored document where ordinary file reading and searching can reach it. */
async function exactDocument(boardId: string, yaml: string): Promise<string> {
  const directory = join(tmpdir(), 'dsh-kanban-workflow');
  await mkdir(directory, { recursive: true });
  // A fixture's board ids repeat across test files, and workers share one temporary
  // directory: the name carries the document's digest so two different boards cannot
  // overwrite each other's file, while an unchanged board keeps one stable path.
  const path = join(directory, boardId + '-' + createHash('sha256').update(yaml, 'utf8').digest('hex').slice(0, 16) + '.yaml');
  await writeFile(path, yaml, { encoding: 'utf8', mode: 0o600 });
  return path;
}

export function authoringTools(app: KanbanApp, port: WorkflowAuthoringPort = app.boards as BoardAdministration): ToolDefinition[] {
  return [
    normal('get_board_yaml', 'Read one board exact authored workflow document, character for character, together with the Hub revision a write must quote. Returns a line range, the total line count, the offset that continues the read while lines remain, and a path holding the whole document for ordinary file reading and searching. Reading changes nothing.', {
      board_id: text('Board ID.', true),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      offset: { type: 'integer', description: 'Zero-based line to start from. Defaults to the first line.' },
      limit: { type: 'integer', description: 'How many lines to return. Defaults to ' + READ_LINE_LIMIT + '.' },
    }, async (args, exec) => {
      const { board, hub, hubId } = resolveBoard(app, args as ToolArgs, exec);
      const lines = board.workflowYaml.split('\n');
      const offset = Math.min(Math.max(args.offset ?? 0, 0), lines.length);
      const limit = Math.max(1, args.limit ?? READ_LINE_LIMIT);
      const end = Math.min(lines.length, offset + limit);
      return {
        boardId: board.id, hubId, hubRevision: hub.revision, effectiveDefaultPreset: effectiveBoardPreset(board), totalLines: lines.length,
        offset, limit, yaml: lines.slice(offset, end).join('\n'),
        path: await exactDocument(board.id, board.workflowYaml),
        ...(end < lines.length ? { nextOffset: end } : {}),
      };
    }, true),

    normal('get_stage', 'Read the authored block of one stage exactly as written, including its instruction, transitions, decision or script configuration, placement, and size. Inline script source is withheld by default and represented by its digest and byte length; ask for it explicitly when the source itself matters.', {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      include_code: flag('Return the authored inline script source instead of its digest and byte length.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
    }, async (args, exec) => {
      const { board, hub, hubId } = resolveBoard(app, args as ToolArgs, exec);
      const stage = readStage({ text: board.workflowYaml, stageId: args.stage_id, includeSource: args.include_code === true });
      return { boardId: board.id, hubId, hubRevision: hub.revision, stageId: stage.stageId, yaml: stage.text, ...(stage.source === undefined ? {} : { source: stage.source }) };
    }, true),

    normal('set_stage_prompt', intent + 'Set or clear one stage entry instruction.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      prompt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'The entry instruction; null or an empty string clears it.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const prompt = args.prompt ?? null;
      return write(port, args as WriteArgs, exec, current => setStageInstruction(current, args.stage_id, prompt));
    }),

    normal('set_stage_routes', intent + 'Replace the routes one stage authors. A stage without a script takes transitions, an authored list of destinations with an optional condition, or permit_any to author no restriction. A scripted stage takes exits, a mapping from each named exit to its destination. An empty transition list means the stage permits no destination.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      transitions: { type: 'array', description: 'Destinations the stage permits, each a stage id or an object with to and an optional when condition. An empty list permits none.', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, properties: { to: { type: 'string', required: true }, when: { type: 'string' } } }] } },
      permit_any: flag('Author no transition list, so the stage permits any other stage.'),
      exits: { type: 'object', additionalProperties: true, description: 'Named exits mapped to destination stage ids, for a scripted stage. Every exit must name a destination.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const route = {
        ...(args.transitions === undefined ? {} : { transitions: args.transitions }),
        ...(args.permit_any === true ? { permitAny: true } : {}),
        ...(args.exits === undefined ? {} : { exits: args.exits }),
      };
      // A wrong-kind edit is an input refusal before any write is composed, exactly
      // as it was before the operation was shared with the batch tool.
      stageRoutesPatch(authored(port, args as WriteArgs).workflow, args.stage_id, route);
      return write(port, args as WriteArgs, exec, current => setStageRoutes(current, args.stage_id, route));
    }),

    normal('set_stage_script', intent + 'Write one stage scripted configuration in parts. Only the parts the call names are rewritten; every other authored character of the stage, including comments beside the script, stays as written. A stage that authors no script needs the language, one source, and its named exits; a stage that already runs a script accepts any subset.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      language: { type: 'string', enum: ['bash', 'typescript'], description: 'Program language.' },
      code: text('Inline program source. Naming it removes an authored file reference.'),
      file: text('External program file, resolved inside the directory choice. Naming it removes authored inline code.'),
      directory: { type: 'string', enum: ['task', 'project'], description: 'Directory the program runs in: the task directory, including a bound worktree, or the base project directory.' },
      env: { type: 'array', items: { type: 'string' }, description: 'Authorized local variable names, never values. An empty list clears them.' },
      params: { type: 'array', description: 'Declared parameters the origin stage must supply, in authored order. An empty list clears them.', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, description: { type: 'string' } } } },
      exits: { type: 'object', additionalProperties: true, description: 'Named exits mapped to destination stage ids. Replaces the whole mapping; every exit must name a destination.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      return write(port, args as WriteArgs, exec, current => {
        const workflow = parseWorkflow(current);
        const stage = workflow.columns.find(column => column.id === args.stage_id);
        invariant(stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + args.stage_id + '.');
        const next = mergeScriptPatch(stage.scripted, args as unknown as ScriptPatch);
        return updateStage({ text: current, stageId: args.stage_id, patch: { scripted: next } }).text;
      });
    }),


    normal('set_stage_decision', intent + 'Write one stage decision configuration in parts. Only the parts the call names are rewritten; every other authored character of the stage stays as written. A stage that authors no decision configuration needs the question and its options; a stage that already authors one accepts any subset. Setting a decision configuration replaces the stage entry instruction, allowed-transition list, or scripted configuration, so the stage never authors two modes. Pass clear to remove it.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      question: text('The decision question. Required when the stage authors no decision configuration.'),
      context: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional Markdown context; null clears it.' },
      options: { type: 'array', description: 'Ordered options the person chooses from. Replaces the whole list; every option needs an id, a title, and a destination stage.', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, description: { type: 'string' }, to: { type: 'string', required: true } } } },
      clear: flag('Remove the stage decision configuration.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      invariant(!(args.clear === true && (args.question !== undefined || args.context !== undefined || args.options !== undefined)), 'INVALID_INPUT', 'Clear the decision configuration or write it, not both.');
      return write(port, args as WriteArgs, exec, current => {
        const workflow = parseWorkflow(current);
        const stage = workflow.columns.find(column => column.id === args.stage_id);
        invariant(stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + args.stage_id + '.');
        if (args.clear === true) return updateStage({ text: current, stageId: stage.id, patch: { decision: null } }).text;
        const options = args.options as ReadonlyArray<{ id: string; title: string; description?: string; to: string }> | undefined;
        const definition = mergeDecisionPatch(stage.decision, {
          ...(args.question === undefined ? {} : { question: args.question as string }),
          ...(args.context === undefined ? {} : { context: args.context as string | null }),
          ...(options === undefined ? {} : { options }),
        }, workflow, stage.id);
        return updateStage({ text: current, stageId: stage.id, patch: { decision: definition } }).text;
      });
    }),

    normal('set_layout', intent + 'Set stage placements, stage sizes, and connection layouts. Each named value is written and each value set to null or removed clears its entry; everything not named keeps its authored value.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      positions: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {x, y}, or to null to clear its placement.' },
      sizes: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {width, height}, or to null to clear its size.' },
      connections: { type: 'array', description: 'Connection layouts to write or remove, each with from and to, optional source and target anchors, optional segments, and remove to clear the entry.', items: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, source: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, target: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, segments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { axis: { type: 'string', enum: ['x', 'y'], required: true }, offset: { type: 'number', required: true } } } }, remove: { type: 'boolean' } } } },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      invariant(args.positions !== undefined || args.sizes !== undefined || args.connections !== undefined, 'INVALID_INPUT', 'Provide positions, sizes, or connections.');
      return write(port, args as WriteArgs, exec, current => setStageLayout(current, {
        ...(args.positions === undefined ? {} : { positions: args.positions }),
        ...(args.sizes === undefined ? {} : { sizes: args.sizes }),
        ...(args.connections === undefined ? {} : { connections: args.connections }),
      }));
    }),

    normal('add_stage', intent + 'Insert one stage into the workflow after a named stage, or at the end of the stage sequence. The stage is given as YAML mapping lines; its id, label, instruction, transitions, decision or script configuration are authored like any other stage.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_yaml: text('The stage definition as YAML mapping lines, beginning with its id.', true),
      after: text('The stage the new one follows. Omit to append it at the end.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      return write(port, args as WriteArgs, exec, current => addStage({ text: current, stageYaml: args.stage_yaml, ...(args.after === undefined ? {} : { after: args.after }) }));
    }),

    normal('remove_stage', intent + 'Remove one stage and every authored reference to it: transitions that named it, its membership in groups, connection layouts that drew it, and its own stage entry. Refuses while the stage still holds cards, and refuses to remove the initial stage unless another stage is named as the initial one. Pass confirmed true only after the user explicitly confirmed the removal.' + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      confirmed: flag('Explicit confirmation of the removal; the removal is refused without it.'),
      replacement_initial: text('Stage that becomes the initial stage, required when the removed stage is the initial one.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: revisionParameter,
      ...workflowWriteControls,
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      invariant(args.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm removing the stage.');
      const cards = port.cards(args.board_id, args.hub_id).filter(card => card.columnId === args.stage_id || card.pendingTransition?.columnId === args.stage_id);
      if (cards.length > 0) {
        const message = 'Stage ' + args.stage_id + ' still holds ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '; move or delete them first.';
        const full = composeWorkflowReport({ valid: false, problems: [{ message }], difference: null, warnings: [], affectedCards: cards.map(card => ({ taskId: card.id, stage: args.stage_id, reason: 'stage-removed' as const })), workflow: null, previous: null });
        // The one refusal an author most often hits keeps the documented report shape.
        return { saved: false, error: { code: 'STAGE_HAS_CARDS', message }, report: args.detail === 'full' ? full : summarizeWorkflowReport(full, null) };
      }
      return write(port, args as WriteArgs, exec, current => removeStage({ text: current, stageId: args.stage_id, ...(args.replacement_initial === undefined ? {} : { replacementInitial: args.replacement_initial }) }).text);
    }),
  ];
}