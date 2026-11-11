import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { TaskMessageDelivery } from '../shared/task-message.js';

/** Durable source kind that marks a cross-card message delivered as conversation context. */
export const TASK_MESSAGE_SOURCE_KIND = 'task-message';

/** Producer marker of the model-facing cross-card message delivered to the target task. */
export interface KanbanTaskMessageSource {
  readonly kind: 'task-message';
  /** One-off account the host shows on the collapsed context row. */
  readonly form: 'notice';
  readonly summary: string;
  /** Delivery identity; a repeated identity is never delivered twice. */
  readonly requestId: string;
  /** Sending task identity, so the recipient can reply with the same tool. */
  readonly senderTaskId: string;
  /** Sending conversation identity. */
  readonly senderSessionId: string;
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'task-message': KanbanTaskMessageSource;
  }
}

/** Wrap a prepared delivery as the durable, plugin-sourced native message the target receives. */
export function createTaskMessage(delivery: TaskMessageDelivery): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: delivery.text }],
    source: {
      kind: TASK_MESSAGE_SOURCE_KIND,
      form: 'notice',
      summary: boundContextSummary(delivery.summary),
      requestId: delivery.requestId,
      senderTaskId: delivery.senderTaskId,
      senderSessionId: delivery.senderSessionId,
    },
  });
}
