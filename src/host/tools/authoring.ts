import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration, BoardPublishingPolicy, BoardView, BoardWriteResult, ComposeBoardWorkflowInput } from '../board-administration.js';
import type { ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset, StagePatch, StagePosition, StageSize, TransitionRule, Workflow } from '../../shared/types.js';
import type { WorkflowCardReference, WorkflowWriteReport } from '../../domain/workflow-report.js';
import { composeWorkflowReport } from '../../domain/workflow-report.js';
import { invariant } from '../../shared/errors.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { updateStage } from '../../domain/stage-update.js';
import { addStage, removeStage } from '../../domain/workflow-stage-edit.js';
import { readStage } from '../../domain/workflow-stage-read.js';
import { readStagePositions, setStagePositions, type StagePositions } from '../../domain/workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from '../../domain/workflow-sizes.js';
import { readConnections, setConnections } from '../../domain/workflow-connections.js';
import { connectionKey } from '../../domain/connection-anchor.js';
import { isDomainId } from '../../domain/validation.js';
import { actorOf, flag, normal, refusal, text, written } from './support.js';
import { assertBoardWriteAllowed, resolveBoard, type ToolArgs } from './scope.js';

/** How many lines of an authored document one read returns before the caller asks for more. */
const READ_LINE_LIMIT = 400;

const intent = 'Use ONLY when the user explicitly requests this board change. ';

const preserveNote = ' Only the named fields are rewritten; comments, key order, quoting, and every other authored character stay as they are.';

const reportNote = ' The result carries the write report: the per-stage difference, the graph warnings, the board-level reviewed authorization of every deterministic stage, and the affected cards. A refused write saves nothing and returns the same report.';

/** The document, stage, and write surface the authoring tools need. */
export interface WorkflowAuthoringPort {
  read(boardId: string, hubId?: string): BoardView;
  cards(boardId: string, hubId?: string): WorkflowCardReference[];
  saveWorkflowReviewed(input: ComposeBoardWorkflowInput, policy?: BoardPublishingPolicy): Promise<BoardWriteResult & { report: WorkflowWriteReport }>;
}

interface WriteArgs extends ToolArgs { readonly board_id: string; readonly expected_revision?: number }

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_INPUT', label + ' must be a mapping.');
  return value as Record<string, unknown>;
}

function stageId(value: unknown, label: string): string {
  invariant(typeof value === 'string' && isDomainId(value), 'INVALID_INPUT', label + ' must be a safe identifier.');
  return value;
}

function point(value: unknown, label: string): { x: number; y: number } {
  const map = record(value, label);
  invariant(typeof map.x === 'number' && Number.isFinite(map.x) && typeof map.y === 'number' && Number.isFinite(map.y), 'INVALID_INPUT', label + ' requires finite x and y coordinates.');
  return { x: map.x, y: map.y };
}

function dimension(value: unknown, label: string): StageSize {
  const map = record(value, label);
  invariant(typeof map.width === 'number' && typeof map.height === 'number', 'INVALID_INPUT', label + ' requires width and height numbers.');
  return { width: map.width, height: map.height };
}

function anchorOf(value: unknown, label: string): ConnectionAnchor {
  const map = record(value, label);
  invariant(map.side === 'top' || map.side === 'right' || map.side === 'bottom' || map.side === 'left', 'INVALID_INPUT', label + ' requires a side of top, right, bottom, or left.');
  invariant(typeof map.at === 'number' && Number.isInteger(map.at) && map.at >= 0 && map.at <= 4, 'INVALID_INPUT', label + ' requires an at index from 0 to 4.');
  return { side: map.side, at: map.at };
}

function segmentsOf(value: unknown, label: string): ConnectionSegmentOffset[] {
  invariant(Array.isArray(value), 'INVALID_INPUT', label + ' must be an array of displacements.');
  return value.map((entry, index) => {
    const map = record(entry, label + ' ' + index);
    invariant(map.axis === 'x' || map.axis === 'y', 'INVALID_INPUT', label + ' ' + index + ' requires axis x or y.');
    invariant(typeof map.offset === 'number' && Number.isFinite(map.offset), 'INVALID_INPUT', label + ' ' + index + ' requires a finite offset.');
    return { axis: map.axis, offset: map.offset };
  });
}

function ruleOf(value: unknown, label: string): TransitionRule {
  if (typeof value === 'string') return { to: stageId(value, label) };
  const map = record(value, label);
  const to = stageId(map.to, label + ' destination');
  return map.when === undefined ? { to } : { to, when: typeof map.when === 'string' ? map.when : String(map.when) };
}

/** The authored document one write is composed from, as the port reports it. */
function authored(port: WorkflowAuthoringPort, args: WriteArgs): { view: BoardView; workflow: Workflow } {
  const view = port.read(args.board_id, args.hub_id);
  return { view, workflow: parseWorkflow(view.board.workflowYaml) };
}

/** Run one reviewed write, returning the report on success and on refusal alike. */
async function write(port: WorkflowAuthoringPort, args: WriteArgs, exec: ToolRunContext, compose: (current: string) => string): Promise<unknown> {
  try {
    const value = await port.saveWorkflowReviewed({ boardId: args.board_id, ...(args.hub_id === undefined ? {} : { hubId: args.hub_id }), ...(args.expected_revision === undefined ? {} : { expectedRevision: args.expected_revision }), actor: actorOf(exec), origin: 'tool', compose });
    return written(value);
  } catch (error) {
    const refused = refusal(error);
    if (refused !== undefined) return refused;
    throw error;
  }
}

/** Write the exact authored document where ordinary file reading and searching can reach it. */
async function exactDocument(boardId: string, yaml: string): Promise<string> {
  const directory = join(tmpdir(), 'dsh-kanban-workflow');
  await mkdir(directory, { recursive: true });
  const path = join(directory, boardId + '.yaml');
  await writeFile(path, yaml, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function mergePositions(workflow: Workflow, value: unknown): StagePositions {
  const positions: Record<string, StagePosition | undefined> = Object.create(null) as Record<string, StagePosition | undefined>;
  for (const [id, position] of Object.entries(readStagePositions(workflow))) positions[id] = position;
  for (const [id, position] of Object.entries(record(value, 'positions'))) {
    invariant(workflow.columns.some(column => column.id === id), 'INVALID_INPUT', 'The workflow has no stage ' + id + '.');
    positions[id] = position === null ? undefined : point(position, 'Stage ' + id + ' position');
  }
  return positions;
}

function mergeSizes(workflow: Workflow, value: unknown): StageSizes {
  const sizes: Record<string, StageSize | undefined> = Object.create(null) as Record<string, StageSize | undefined>;
  for (const [id, size] of Object.entries(readStageSizes(workflow))) sizes[id] = size;
  for (const [id, size] of Object.entries(record(value, 'sizes'))) {
    invariant(workflow.columns.some(column => column.id === id), 'INVALID_INPUT', 'The workflow has no stage ' + id + '.');
    sizes[id] = size === null ? undefined : dimension(size, 'Stage ' + id + ' size');
  }
  return sizes;
}

function mergeConnections(workflow: Workflow, value: unknown): Record<string, ConnectionLayout | undefined> {
  invariant(Array.isArray(value), 'INVALID_INPUT', 'connections must be an array of connection layouts.');
  const layouts: Record<string, ConnectionLayout | undefined> = Object.create(null) as Record<string, ConnectionLayout | undefined>;
  for (const [key, layout] of Object.entries(readConnections(workflow))) layouts[key] = layout;
  for (const [index, entry] of value.entries()) {
    const map = record(entry, 'Connection ' + index);
    const from = stageId(map.from, 'Connection ' + index + ' source');
    const to = stageId(map.to, 'Connection ' + index + ' target');
    const key = connectionKey(from, to);
    if (map.remove === true) { layouts[key] = undefined; continue; }
    const layout: ConnectionLayout = { from, to };
    if (map.source !== undefined) layout.source = anchorOf(map.source, 'Connection ' + index + ' source anchor');
    if (map.target !== undefined) layout.target = anchorOf(map.target, 'Connection ' + index + ' target anchor');
    if (map.segments !== undefined) layout.segments = segmentsOf(map.segments, 'Connection ' + index + ' segments');
    layouts[key] = layout;
  }
  return layouts;
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
        boardId: board.id, hubId, hubRevision: hub.revision, totalLines: lines.length,
        offset, limit, yaml: lines.slice(offset, end).join('\n'),
        path: await exactDocument(board.id, board.workflowYaml),
        ...(end < lines.length ? { nextOffset: end } : {}),
      };
    }, true),

    normal('get_stage', 'Read the authored block of one stage exactly as written, including its instruction, transitions, script configuration, placement, and size. Inline script source is withheld by default and represented by its digest and byte length; ask for it explicitly when the source itself matters.', {
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
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const prompt = args.prompt ?? null;
      return write(port, args as WriteArgs, exec, current => updateStage({ text: current, stageId: args.stage_id, patch: { onEnterPrompt: prompt } }).text);
    }),

    normal('set_stage_routes', intent + 'Replace the routes one stage authors. A stage without a script takes transitions, an authored list of destinations with an optional condition, or permit_any to author no restriction. A deterministic stage takes exits, a mapping from each named exit to its destination. An empty transition list means the stage permits no destination.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_id: text('Stage ID.', true),
      transitions: { type: 'array', description: 'Destinations the stage permits, each a stage id or an object with to and an optional when condition. An empty list permits none.', items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: false, properties: { to: { type: 'string', required: true }, when: { type: 'string' } } }] } },
      permit_any: flag('Author no transition list, so the stage permits any other stage.'),
      exits: { type: 'object', additionalProperties: true, description: 'Named exits mapped to destination stage ids, for a deterministic stage. Every exit must name a destination.' },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      const { workflow } = authored(port, args as WriteArgs);
      const stage = workflow.columns.find(column => column.id === args.stage_id);
      invariant(stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + args.stage_id + '.');
      const provided = [args.transitions !== undefined, args.permit_any === true, args.exits !== undefined].filter(Boolean).length;
      invariant(provided === 1, 'INVALID_INPUT', 'Provide exactly one of transitions, permit_any, or exits.');
      let patch: StagePatch;
      if (stage.deterministic !== undefined) {
        invariant(args.exits !== undefined, 'INVALID_ROUTES', 'Stage ' + stage.id + ' runs a deterministic script; set its named exits instead of transitions.');
        const exits = Object.fromEntries(Object.entries(record(args.exits, 'exits')).map(([name, destination]) => [name, stageId(destination, 'Exit ' + name + ' destination')]));
        invariant(Object.keys(exits).length > 0, 'INVALID_ROUTES', 'A deterministic stage requires at least one named exit.');
        patch = { deterministic: { ...stage.deterministic, exits } };
      } else {
        invariant(args.exits === undefined, 'INVALID_ROUTES', 'Stage ' + stage.id + ' authors no script; set transitions or permit_any instead.');
        if (args.permit_any === true) patch = { allowedTransitions: null };
        else {
          invariant(Array.isArray(args.transitions), 'INVALID_INPUT', 'transitions must be an array of destinations.');
          patch = { allowedTransitions: args.transitions.map((value, index) => ruleOf(value, 'Transition ' + index)) };
        }
      }
      return write(port, args as WriteArgs, exec, current => updateStage({ text: current, stageId: args.stage_id, patch }).text);
    }),

    normal('set_layout', intent + 'Set stage placements, stage sizes, and connection layouts. Each named value is written and each value set to null or removed clears its entry; everything not named keeps its authored value.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      positions: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {x, y}, or to null to clear its placement.' },
      sizes: { type: 'object', additionalProperties: true, description: 'Stage id mapped to {width, height}, or to null to clear its size.' },
      connections: { type: 'array', description: 'Connection layouts to write or remove, each with from and to, optional source and target anchors, optional segments, and remove to clear the entry.', items: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, source: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, target: { type: 'object', additionalProperties: false, properties: { side: { type: 'string', enum: ['top', 'right', 'bottom', 'left'], required: true }, at: { type: 'integer', required: true } } }, segments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { axis: { type: 'string', enum: ['x', 'y'], required: true }, offset: { type: 'number', required: true } } } }, remove: { type: 'boolean' } } } },
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      invariant(args.positions !== undefined || args.sizes !== undefined || args.connections !== undefined, 'INVALID_INPUT', 'Provide positions, sizes, or connections.');
      return write(port, args as WriteArgs, exec, current => {
        const workflow = parseWorkflow(current);
        let next = current;
        if (args.positions !== undefined) next = setStagePositions(next, mergePositions(workflow, args.positions));
        if (args.sizes !== undefined) next = setStageSizes(next, mergeSizes(workflow, args.sizes));
        if (args.connections !== undefined) next = setConnections(next, mergeConnections(workflow, args.connections));
        return next;
      });
    }),

    normal('add_stage', intent + 'Insert one stage into the workflow after a named stage, or at the end of the stage sequence. The stage is given as YAML mapping lines; its id, label, instruction, transitions, and script configuration are authored like any other stage.' + preserveNote + reportNote, {
      board_id: text('Board ID.', true),
      stage_yaml: text('The stage definition as YAML mapping lines, beginning with its id.', true),
      after: text('The stage the new one follows. Omit to append it at the end.'),
      hub_id: text('Hub ID. Optional when the board identifier is enough.'),
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
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
      expected_revision: { type: 'integer', description: 'Hub revision from a prior read; stale values are rejected.' },
    }, async (args, exec) => {
      await assertBoardWriteAllowed(app, exec);
      invariant(args.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm removing the stage.');
      const cards = port.cards(args.board_id, args.hub_id).filter(card => card.columnId === args.stage_id || card.pendingTransition?.columnId === args.stage_id);
      if (cards.length > 0) {
        const message = 'Stage ' + args.stage_id + ' still holds ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '; move or delete them first.';
        return { saved: false, error: { code: 'STAGE_HAS_CARDS', message }, report: composeWorkflowReport({ valid: false, problems: [{ message }], difference: null, warnings: [], affectedCards: cards.map(card => ({ taskId: card.id, stage: args.stage_id, reason: 'stage-removed' as const })), workflow: null, previous: null }) };
      }
      return write(port, args as WriteArgs, exec, current => removeStage({ text: current, stageId: args.stage_id, ...(args.replacement_initial === undefined ? {} : { replacementInitial: args.replacement_initial }) }).text);
    }),
  ];
}