import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { StageInstructionDelivery } from '../shared/ports.js';
import type { Task, Workflow } from '../shared/types.js';
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

export interface StageInstructionInput {
  /** The entry instruction exactly as admitted. */
  readonly instruction: string;
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

/** Compose the model-facing delivery: the instruction, then the briefing when one applies. */
export function buildStageInstructionDelivery(input: StageInstructionInput): StageInstructionDelivery {
  return {
    requestId: input.requestId,
    text: input.briefing === undefined ? input.instruction : `${input.instruction}\n\n${input.briefing}`,
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
