import { firstOpenSessionId } from '../shared/conversations.js';
import { invariant } from '../shared/errors.js';
import type { TaskMessageDeliveryPort } from '../shared/ports.js';
import {
  buildTaskMessageSummary,
  buildTaskMessageText,
  taskMessageIdentity,
  type TaskMessageDelivery,
  type TaskMessagePreparation,
  type TaskMessageResult,
} from '../shared/task-message.js';
import type { LocatedTask } from './hub-repository.js';

/** The host reads and preparation one cross-card message needs, injected by composition. */
export interface InterCardMessagingDeps {
  locateBySession(sessionId: string): LocatedTask | undefined;
  locate(taskId: string): LocatedTask | undefined;
  prepare(taskId: string): Promise<TaskMessagePreparation>;
  delivery: TaskMessageDeliveryPort;
}

export interface SendTaskMessageInput {
  /** The calling native conversation; it must belong to a task. */
  readonly senderSessionId: string;
  readonly targetTaskId: string;
  readonly body: string;
  /** The model tool call identity, which makes delivery idempotent across retries. */
  readonly callId: string;
}

/**
 * The one policy for a cross-card message: a task-owned sender, a different task in
 * the same Hub, a non-empty body, the first open target conversation (preparing one
 * when none is open), and at-most-once delivery through the injected port.
 */
export class InterCardMessaging {
  constructor(private readonly deps: InterCardMessagingDeps) {}

  async send(input: SendTaskMessageInput): Promise<TaskMessageResult> {
    const sender = this.deps.locateBySession(input.senderSessionId);
    invariant(sender, 'MISSING_TASK_CONTEXT', 'Cross-card messages are available only inside a task conversation.');
    const body = input.body.trim();
    invariant(body.length > 0, 'EMPTY_MESSAGE', 'A cross-card message requires a non-empty body.');
    const target = this.deps.locate(input.targetTaskId);
    invariant(target, 'TASK_NOT_FOUND', 'The target task does not exist.');
    invariant(target.hubId === sender.hubId, 'CROSS_HUB_MESSAGE', 'A cross-card message must target a task in the same Hub.');
    invariant(target.task.id !== sender.task.id, 'SELF_MESSAGE', 'A task cannot send a message to itself.');

    const text = buildTaskMessageText({
      hubName: sender.hub.name,
      boardName: sender.board.name,
      taskTitle: sender.task.title,
      taskId: sender.task.id,
    }, body);
    const summary = buildTaskMessageSummary(sender.task.title);

    const open = firstOpenSessionId(target.task);
    const prepared = open === undefined
      ? await this.deps.prepare(target.task.id)
      : { sessionId: open, createdConversation: false } satisfies TaskMessagePreparation;

    // Re-resolve immediately before delivery: a conversation created while the
    // preparation ran is the one the target would read, and the delivery identity
    // still makes a repeated call harmless.
    const current = this.deps.locate(target.task.id);
    invariant(current, 'TASK_NOT_FOUND', 'The target task no longer exists.');
    const sessionId = firstOpenSessionId(current.task) ?? prepared.sessionId;
    // Report only what this delivery actually used; a conversation that appeared
    // concurrently is the target, while a created worktree still exists.
    const createdConversation = prepared.createdConversation && sessionId === prepared.sessionId;
    const delivery: TaskMessageDelivery = {
      requestId: taskMessageIdentity(input.senderSessionId, input.callId),
      senderSessionId: input.senderSessionId,
      senderTaskId: sender.task.id,
      text,
      summary,
    };
    await this.deps.delivery.deliver(sessionId, delivery);
    return {
      delivered: true,
      requestId: delivery.requestId,
      senderTaskId: sender.task.id,
      target: { taskId: current.task.id, title: current.task.title, sessionId },
      createdConversation,
      ...(prepared.createdWorktree === undefined ? {} : { createdWorktree: prepared.createdWorktree }),
    };
  }
}
