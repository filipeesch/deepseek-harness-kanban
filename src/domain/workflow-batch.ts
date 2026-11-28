import { KanbanError, invariant } from '../shared/errors.js';
import { workflowProblems } from './workflow-diagnostics.js';
import {
  modelOf, record, removeAgent, setAgent, setStageAgent, setStageInstruction, setStageLayout, setStageRoutes,
} from './workflow-operations.js';

/** How many operations one batch accepts, so one call cannot become a document generator. */
export const MAX_BATCH_OPERATIONS = 50;

/** The structured edits a batch composes, each the semantics of one focused tool. */
export const BATCH_OPERATIONS = ['set_agent', 'remove_agent', 'set_stage_agent', 'set_stage_prompt', 'set_stage_routes', 'set_layout'] as const;
export type WorkflowBatchOperationKind = (typeof BATCH_OPERATIONS)[number];

/** One operation the batch applied, named by its position in the supplied order. */
export interface AppliedBatchOperation {
  readonly index: number;
  readonly operation: WorkflowBatchOperationKind;
}

/** One composed batch: the candidate document and the operations that produced it. */
export interface WorkflowBatchComposition {
  /** The exact candidate document. Nothing was persisted to produce it. */
  readonly text: string;
  readonly operations: readonly AppliedBatchOperation[];
}

export interface WorkflowBatchInput {
  /** The exact authored document the batch starts from. */
  readonly text: string;
  /** The ordered operations; each sees the result of the one before it. */
  readonly operations: readonly unknown[];
}

/** One refusal that names the operation it came from. */
function indexed(error: unknown, index: number, operation: string): KanbanError {
  const code = error instanceof KanbanError ? error.code : 'INVALID_INPUT';
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof KanbanError ? error.details : undefined;
  return new KanbanError(code, 'Operation ' + index + ' (' + operation + '): ' + message, { ...details, index, operation });
}

function unknownOperation(index: number, detail: string): KanbanError {
  return new KanbanError('INVALID_INPUT', 'Operation ' + index + ' ' + detail, { index });
}

function operationOf(raw: unknown, index: number): { kind: WorkflowBatchOperationKind; map: Record<string, unknown> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw unknownOperation(index, 'must be a mapping with an op name.');
  const map = raw as Record<string, unknown>;
  const kind = map.op;
  if (typeof kind !== 'string' || !(BATCH_OPERATIONS as readonly string[]).includes(kind)) {
    throw unknownOperation(index, 'must name one of ' + BATCH_OPERATIONS.join(', ') + '.');
  }
  return { kind: kind as WorkflowBatchOperationKind, map };
}

function requiredText(value: unknown, label: string): string {
  invariant(typeof value === 'string' && value.length > 0, 'INVALID_INPUT', label + ' must be nonempty text.');
  return value;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  invariant(typeof value === 'string', 'INVALID_INPUT', label + ' must be text.');
  return value;
}

/** Compose one validated operation onto the document the previous operation produced. */
function applyOperation(text: string, kind: WorkflowBatchOperationKind, map: Record<string, unknown>): string {
  switch (kind) {
    case 'set_agent': {
      const model = modelOf(map.model_provider, map.model_name, map.model_reasoning_effort);
      const preset = optionalText(map.preset, 'set_agent preset');
      return setAgent(text, {
        agentId: requiredText(map.agent_id, 'set_agent agent_id'),
        name: requiredText(map.name, 'set_agent name'),
        ...(preset === undefined ? {} : { preset }),
        ...(model === undefined ? {} : { model }),
      });
    }
    case 'remove_agent':
      return removeAgent(text, requiredText(map.agent_id, 'remove_agent agent_id'));
    case 'set_stage_agent': {
      const agentId = optionalText(map.agent_id, 'set_stage_agent agent_id');
      return setStageAgent(text, requiredText(map.stage_id, 'set_stage_agent stage_id'), agentId);
    }
    case 'set_stage_prompt': {
      invariant(map.prompt === null || typeof map.prompt === 'string', 'INVALID_INPUT', 'set_stage_prompt prompt must be text or null.');
      return setStageInstruction(text, requiredText(map.stage_id, 'set_stage_prompt stage_id'), map.prompt as string | null);
    }
    case 'set_stage_routes': {
      const stageId = requiredText(map.stage_id, 'set_stage_routes stage_id');
      return setStageRoutes(text, stageId, {
        ...(map.transitions === undefined ? {} : { transitions: map.transitions }),
        ...(map.permit_any === true ? { permitAny: true } : {}),
        ...(map.exits === undefined ? {} : { exits: map.exits }),
      });
    }
    case 'set_layout':
      return setStageLayout(text, {
        ...(map.positions === undefined ? {} : { positions: record(map.positions, 'set_layout positions') }),
        ...(map.sizes === undefined ? {} : { sizes: record(map.sizes, 'set_layout sizes') }),
        ...(map.connections === undefined ? {} : { connections: map.connections }),
      });
  }
}

/**
 * Compose an ordered batch of structured workflow edits onto one authored document.
 *
 * Each operation sees the result of the previous one, so an agent can be added
 * before it is bound and a binding cleared before its agent is removed. A failing
 * operation names its index and the code its focused counterpart would have raised;
 * the input document is untouched, and nothing is persisted here.
 */
export function composeWorkflowBatch(input: WorkflowBatchInput): WorkflowBatchComposition {
  invariant(Array.isArray(input.operations) && input.operations.length > 0, 'INVALID_INPUT', 'A batch requires at least one operation.');
  invariant(input.operations.length <= MAX_BATCH_OPERATIONS, 'INVALID_INPUT', 'A batch accepts at most ' + MAX_BATCH_OPERATIONS + ' operations.');
  let text = input.text;
  const applied: AppliedBatchOperation[] = [];
  for (const [index, raw] of input.operations.entries()) {
    const { kind, map } = operationOf(raw, index);
    try {
      text = applyOperation(text, kind, map);
    } catch (error) {
      throw indexed(error, index, kind);
    }
    // Validate what this operation produced, before the next one reads it. A layout or
    // any other operation that leaves an unacceptable document is attributed to the
    // operation that introduced it, with the parser's positioned problems, instead of
    // surfacing later under an operation that merely followed it.
    const problems = workflowProblems(text);
    if (problems.length > 0) {
      throw new KanbanError('INVALID_WORKFLOW', 'Operation ' + index + ' (' + kind + '): ' + problems[0]!.message, { index, operation: kind, problems });
    }
    applied.push({ index, operation: kind });
  }
  return { text, operations: applied };
}
