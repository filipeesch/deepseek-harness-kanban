import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { StageInstructionDelivery } from '../shared/ports.js';
import type { Task, Workflow } from '../shared/types.js';
import type { DeterministicHandoff } from '../shared/deterministic.js';
import { defaultDestination } from '../domain/transitions.js';
import { recordedTransition } from '../domain/transition-route.js';

/** Durable source kind that marks a stage instruction delivered as conversation context. */
export const STAGE_INSTRUCTION_SOURCE_KIND = 'stage-instruction';

/** Producer marker of the model-facing stage instruction delivered on a stage entry. */
export interface KanbanStageInstructionSource {
  readonly kind: 'stage-instruction';
  /** One-off account the host shows on the collapsed context row. */
  readonly form: 'notice';
  readonly summary: string;
  /** Delivery identity; a repeated identity is never delivered twice. */
  readonly requestId: string;
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'stage-instruction': KanbanStageInstructionSource;
  }
}

/** The task fields the collapsed summary reads. */
export type SummarizedTask = Pick<Task, 'columnId' | 'recordedTransition'>;

/** The reason the agent declared for the transition that moved the task into this stage. */
export interface DeclaredTransitionNote {
  /** The stage the task left. */
  readonly fromStageName: string;
  readonly reason: string;
}

export interface StageInstructionInput {
  /** The entry instruction exactly as admitted. */
  readonly instruction: string;
  /** The reason the declared transition carried, when this delivery follows one. */
  readonly transition?: DeclaredTransitionNote;
  /** A program result is evidence, not a reason declared by the destination agent. */
  readonly handoff?: DeterministicHandoff;
  /** The host-generated transition briefing, when the stage configures two or more targets. */
  readonly briefing?: string;
  /** The name of the stage being entered. */
  readonly stageName: string;
  readonly task: SummarizedTask;
  readonly workflow: Workflow;
  /** Delivery identity; repeated deliveries of the same identity are skipped. */
  readonly requestId: string;
}

/**
 * The transition target the collapsed row names: the recorded transition while it
 * resolves, otherwise the target the host uses when nothing is recorded.
 */
export function stageInstructionTarget(workflow: Workflow, task: SummarizedTask): string | undefined {
  const recorded = recordedTransition(workflow, task);
  return recorded.kind === 'resolved' ? recorded.column.name : defaultDestination(workflow, task.columnId)?.name;
}

/**
 * The one-line account of the collapsed row. It names the stage and, when a target
 * applies, that target. The host bounds its own notice summary, so the value is
 * bounded here as well and never depends on the length of caller text.
 */
export function buildStageInstructionSummary(stageName: string, targetName?: string): string {
  return boundContextSummary(targetName === undefined ? `Stage: ${stageName}` : `Stage: ${stageName} - next: ${targetName}`);
}

/**
 * The reason block quoted after the instruction. It names the stage the task came
 * from, because the destination instruction alone never says why the task is there.
 */
export function transitionNoteBlock(note: DeclaredTransitionNote): string {
  return 'Transition reason (from ' + note.fromStageName + '):\n' + note.reason;
}

/**
 * Compose the model-facing delivery: the instruction, then the declared reason
 * when this delivery follows one, then the briefing when one applies.
 */
export function deterministicHandoffBlock(handoff: DeterministicHandoff): string {
  return `Deterministic result (from ${handoff.fromColumnId}; exit: ${handoff.exit}; execution: ${handoff.executionId}):\n${handoff.message}`;
}

export function buildStageInstructionDelivery(input: StageInstructionInput): StageInstructionDelivery {
  const blocks = [input.instruction];
  if (input.transition !== undefined) blocks.push(transitionNoteBlock(input.transition));
  if (input.handoff !== undefined) blocks.push(deterministicHandoffBlock(input.handoff));
  if (input.briefing !== undefined) blocks.push(input.briefing);
  return {
    requestId: input.requestId,
    text: blocks.join('\n\n'),
    summary: buildStageInstructionSummary(input.stageName, stageInstructionTarget(input.workflow, input.task)),
  };
}

/** Wrap a delivery as the durable, plugin-sourced native message that starts the turn. */
export function createStageInstructionMessage(delivery: StageInstructionDelivery): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: delivery.text }],
    source: {
      kind: STAGE_INSTRUCTION_SOURCE_KIND,
      form: 'notice',
      summary: delivery.summary,
      requestId: delivery.requestId,
    },
  });
}
