import type {
  ConnectionAnchor, ConnectionLayout, ConnectionSegmentOffset, ModelSelection, StagePatch, StagePosition, StageSize, TransitionRule, Workflow, WorkflowAgent,
} from '../shared/types.js';
import { MAIN_AGENT_ID } from '../shared/types.js';
import { invariant } from '../shared/errors.js';
import { agentFor, declaredAgents } from './agents.js';
import { agentModel, removeAgentEntry, writeAgentEntry, writeStageAgentField } from './board-agents-field.js';
import { connectionKey } from './connection-anchor.js';
import { updateStage } from './stage-update.js';
import { isDomainId } from './validation.js';
import { parseWorkflow } from './workflow.js';
import { readConnections, setConnections } from './workflow-connections.js';
import { readStagePositions, setStagePositions, type StagePositions } from './workflow-positions.js';
import { readStageSizes, setStageSizes, type StageSizes } from './workflow-sizes.js';

/**
 * The side-effect-free workflow edits the focused authoring tools perform, stated
 * once. A focused tool validates its call into one of these inputs and applies it;
 * the batch tool composes the same operations in order, so a batch can never save a
 * document a focused edit would have refused.
 */

export function record(value: unknown, label: string): Record<string, unknown> {
  invariant(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_INPUT', label + ' must be a mapping.');
  return value as Record<string, unknown>;
}

export function stageIdOf(value: unknown, label: string): string {
  invariant(typeof value === 'string' && isDomainId(value), 'INVALID_INPUT', label + ' must be a safe identifier.');
  return value;
}

export function pointOf(value: unknown, label: string): { x: number; y: number } {
  const map = record(value, label);
  invariant(typeof map.x === 'number' && Number.isFinite(map.x) && typeof map.y === 'number' && Number.isFinite(map.y), 'INVALID_INPUT', label + ' requires finite x and y coordinates.');
  return { x: map.x, y: map.y };
}

export function dimensionOf(value: unknown, label: string): StageSize {
  const map = record(value, label);
  invariant(typeof map.width === 'number' && typeof map.height === 'number', 'INVALID_INPUT', label + ' requires width and height numbers.');
  return { width: map.width, height: map.height };
}

export function anchorOf(value: unknown, label: string): ConnectionAnchor {
  const map = record(value, label);
  invariant(map.side === 'top' || map.side === 'right' || map.side === 'bottom' || map.side === 'left', 'INVALID_INPUT', label + ' requires a side of top, right, bottom, or left.');
  invariant(typeof map.at === 'number' && Number.isInteger(map.at) && map.at >= 0 && map.at <= 4, 'INVALID_INPUT', label + ' requires an at index from 0 to 4.');
  return { side: map.side, at: map.at };
}

export function segmentsOf(value: unknown, label: string): ConnectionSegmentOffset[] {
  invariant(Array.isArray(value), 'INVALID_INPUT', label + ' must be an array of displacements.');
  return value.map((entry, index) => {
    const map = record(entry, label + ' ' + index);
    invariant(map.axis === 'x' || map.axis === 'y', 'INVALID_INPUT', label + ' ' + index + ' requires axis x or y.');
    invariant(typeof map.offset === 'number' && Number.isFinite(map.offset), 'INVALID_INPUT', label + ' ' + index + ' requires a finite offset.');
    return { axis: map.axis, offset: map.offset };
  });
}

export function ruleOf(value: unknown, label: string): TransitionRule {
  if (typeof value === 'string') return { to: stageIdOf(value, label) };
  const map = record(value, label);
  const to = stageIdOf(map.to, label + ' destination');
  return map.when === undefined ? { to } : { to, when: typeof map.when === 'string' ? map.when : String(map.when) };
}

/** The model a call names, or undefined when it names none. */
export function modelOf(provider: unknown, model: unknown, reasoningEffort: unknown): ModelSelection | undefined {
  return agentModel(provider, model, reasoningEffort);
}

/** One agent definition a write replaces or adds. */
export interface AgentWriteInput {
  readonly agentId: string;
  readonly name: string;
  /** An empty string keeps the host default preset for this agent. */
  readonly preset?: string;
  readonly model?: ModelSelection;
}

/** Create or replace one agent, rewriting only the entry it names. */
export function setAgent(text: string, input: AgentWriteInput): string {
  const id = stageIdOf(input.agentId, 'agent_id');
  const preset = input.preset === undefined || input.preset.trim().length === 0 ? undefined : input.preset.trim();
  const agent: WorkflowAgent = {
    id,
    name: input.name.trim(),
    ...(preset === undefined ? {} : { preset }),
    ...(input.model === undefined ? {} : { model: input.model }),
  };
  return writeAgentEntry(text, agent);
}

/** Remove one agent, refusing a stage that still names it and the reserved main agent. */
export function removeAgent(text: string, agentIdValue: string): string {
  const id = stageIdOf(agentIdValue, 'agent_id');
  const workflow = parseWorkflow(text);
  invariant(id !== MAIN_AGENT_ID, 'INVALID_INPUT', 'The main agent cannot be removed.');
  invariant(declaredAgents(workflow).some(agent => agent.id === id), 'INVALID_INPUT', 'The workflow does not declare that agent.');
  invariant(!workflow.columns.some(column => column.agent === id), 'INVALID_INPUT', 'A stage still names that agent. Clear the stage before removing it.');
  return removeAgentEntry(text, id);
}

/** Bind one stage to an agent, or return it to the main conversation. */
export function setStageAgent(text: string, stageIdValue: string, agentIdValue: string | undefined): string {
  const id = stageIdOf(stageIdValue, 'stage_id');
  const workflow = parseWorkflow(text);
  invariant(workflow.columns.some(column => column.id === id), 'INVALID_TARGET', 'The workflow has no stage ' + id + '.');
  const agent = agentIdValue === undefined || agentIdValue.trim().length === 0 ? undefined : agentIdValue.trim();
  if (agent !== undefined) invariant(agentFor(workflow, agent) !== undefined, 'INVALID_INPUT', 'The workflow does not declare that agent.');
  return writeStageAgentField(text, id, agent === MAIN_AGENT_ID ? undefined : agent);
}

/** Set, replace, or clear one stage entry instruction. */
export function setStageInstruction(text: string, stageIdValue: string, instruction: string | null): string {
  const id = stageIdOf(stageIdValue, 'stage_id');
  return updateStage({ text, stageId: id, patch: { onEnterPrompt: instruction } }).text;
}

/** The routes one stage authors: a transition list, no restriction, or a scripted stage's named exits. */
export interface RouteWriteInput {
  readonly transitions?: unknown;
  readonly permitAny?: boolean;
  readonly exits?: unknown;
}

/** One validated route edit for one stage. */
export interface StageRoutePatch {
  readonly stageId: string;
  readonly patch: StagePatch;
}

/**
 * Validate one route edit against the workflow it will be applied to, so a focused
 * tool can refuse a wrong-kind or unknown-stage edit before it composes a write.
 */
export function stageRoutesPatch(workflow: Workflow, stageIdValue: string, route: RouteWriteInput): StageRoutePatch {
  const stageId = stageIdOf(stageIdValue, 'stage_id');
  const stage = workflow.columns.find(column => column.id === stageId);
  invariant(stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + stageId + '.');
  const provided = [route.transitions !== undefined, route.permitAny === true, route.exits !== undefined].filter(Boolean).length;
  invariant(provided === 1, 'INVALID_INPUT', 'Provide exactly one of transitions, permit_any, or exits.');
  let patch: StagePatch;
  if (stage.scripted !== undefined) {
    invariant(route.exits !== undefined, 'INVALID_ROUTES', 'Stage ' + stage.id + ' runs a script; set its named exits instead of transitions.');
    const exits = Object.fromEntries(Object.entries(record(route.exits, 'exits')).map(([name, destination]) => [name, stageIdOf(destination, 'Exit ' + name + ' destination')]));
    invariant(Object.keys(exits).length > 0, 'INVALID_ROUTES', 'A scripted stage requires at least one named exit.');
    patch = { scripted: { ...stage.scripted, exits } };
  } else {
    invariant(route.exits === undefined, 'INVALID_ROUTES', 'Stage ' + stage.id + ' authors no script; set transitions or permit_any instead.');
    if (route.permitAny === true) patch = { allowedTransitions: null };
    else {
      invariant(Array.isArray(route.transitions), 'INVALID_INPUT', 'transitions must be an array of destinations.');
      patch = { allowedTransitions: route.transitions.map((value, index) => ruleOf(value, 'Transition ' + index)) };
    }
  }
  return { stageId, patch };
}

/** Replace the routes one stage authors, keeping the focused tool's rules for each stage kind. */
export function setStageRoutes(text: string, stageIdValue: string, route: RouteWriteInput): string {
  const { stageId, patch } = stageRoutesPatch(parseWorkflow(text), stageIdValue, route);
  return updateStage({ text, stageId, patch }).text;
}

/** The layout values one write names; a named null clears the entry. */
export interface LayoutWriteInput {
  readonly positions?: unknown;
  readonly sizes?: unknown;
  readonly connections?: unknown;
}

function mergePositions(workflow: Workflow, value: unknown): StagePositions {
  const positions: Record<string, StagePosition | undefined> = Object.create(null) as Record<string, StagePosition | undefined>;
  for (const [id, position] of Object.entries(readStagePositions(workflow))) positions[id] = position;
  for (const [id, position] of Object.entries(record(value, 'positions'))) {
    invariant(workflow.columns.some(column => column.id === id), 'INVALID_INPUT', 'The workflow has no stage ' + id + '.');
    positions[id] = position === null ? undefined : pointOf(position, 'Stage ' + id + ' position');
  }
  return positions;
}

function mergeSizes(workflow: Workflow, value: unknown): StageSizes {
  const sizes: Record<string, StageSize | undefined> = Object.create(null) as Record<string, StageSize | undefined>;
  for (const [id, size] of Object.entries(readStageSizes(workflow))) sizes[id] = size;
  for (const [id, size] of Object.entries(record(value, 'sizes'))) {
    invariant(workflow.columns.some(column => column.id === id), 'INVALID_INPUT', 'The workflow has no stage ' + id + '.');
    sizes[id] = size === null ? undefined : dimensionOf(size, 'Stage ' + id + ' size');
  }
  return sizes;
}

function mergeConnections(workflow: Workflow, value: unknown): Record<string, ConnectionLayout | undefined> {
  invariant(Array.isArray(value), 'INVALID_INPUT', 'connections must be an array of connection layouts.');
  const layouts: Record<string, ConnectionLayout | undefined> = Object.create(null) as Record<string, ConnectionLayout | undefined>;
  for (const [key, layout] of Object.entries(readConnections(workflow))) layouts[key] = layout;
  for (const [index, entry] of value.entries()) {
    const map = record(entry, 'Connection ' + index);
    const from = stageIdOf(map.from, 'Connection ' + index + ' source');
    const to = stageIdOf(map.to, 'Connection ' + index + ' target');
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

/**
 * Set named placements, sizes, and connection layouts. Only the sub-collections the
 * call names are touched, and inside each only the values it names: an unnamed stage
 * keeps its authored dimension and an unnamed layout entry is not re-emitted.
 */
export function setStageLayout(text: string, layout: LayoutWriteInput): string {
  invariant(layout.positions !== undefined || layout.sizes !== undefined || layout.connections !== undefined, 'INVALID_INPUT', 'Provide positions, sizes, or connections.');
  const workflow = parseWorkflow(text);
  let next = text;
  if (layout.positions !== undefined) next = setStagePositions(next, mergePositions(workflow, layout.positions));
  if (layout.sizes !== undefined) next = setStageSizes(next, mergeSizes(workflow, layout.sizes));
  if (layout.connections !== undefined) next = setConnections(next, mergeConnections(workflow, layout.connections));
  return next;
}
