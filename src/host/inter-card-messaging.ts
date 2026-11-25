import { MAIN_AGENT_ID } from '../shared/types.js';
import { agentFor } from '../domain/agents.js';
import { mainConversationId } from '../domain/conversation-role.js';
import { invariant } from '../shared/errors.js';
import type { TaskMessageDeliveryPort } from '../shared/ports.js';
import {
  buildSameTaskMessageSummary,
  buildSameTaskMessageText,
  buildTaskMessageSummary,
  buildTaskMessageText,
  taskMessageIdentity,
  type HeldMessageWrite,
  type TaskMessageDelivery,
  type TaskMessagePreparation,
  type TaskMessageResult,
} from '../shared/task-message.js';
import type { LocatedTask } from './hub-repository.js';
import { UNAVAILABLE_TASK_ACTIVITY, type TaskActivity, type TaskActivityScope } from '../domain/task-activity.js';

/** The host reads, preparation, and delivery one task message needs, injected by composition. */
export interface InterCardMessagingDeps {
  locateBySession(sessionId: string): LocatedTask | undefined;
  locate(taskId: string): LocatedTask | undefined;
  /** Prepare a target task's main conversation, creating a worktree when the rules require one. */
  prepare(taskId: string): Promise<TaskMessagePreparation>;
  /** Write one message held for a later stage of the sending task. */
  hold(taskId: string, message: HeldMessageWrite): Promise<void>;
  /** The sending task's agent conversation, created with its preset and model when missing. */
  agentConversation(taskId: string, agent: string): Promise<string>;
  delivery: TaskMessageDeliveryPort;
  /** The target's activity at delivery; absent reports it as unavailable. */
  activity?(task: TaskActivityScope): Promise<TaskActivity>;
}

export interface SendTaskMessageInput {
  /** The calling native conversation; it must belong to a task. */
  readonly senderSessionId: string;
  /** The target task; omitted means the sending task. */
  readonly targetTaskId?: string;
  /** An agent of the target task; a reply to a specialist addresses it across tasks too. */
  readonly agent?: string;
  /** A stage of the sending task's workflow; holds the message until the task enters it. */
  readonly deliverAt?: string;
  readonly body: string;
  /** The model tool call identity, which makes delivery idempotent across retries. */
  readonly callId: string;
}

/**
 * The one policy for a task message: a task-owned sender, a non-empty body, the target
 * the call addresses, and at-most-once delivery through the injected port. A message
 * to another task keeps the cross-card contract; a message within the sending task may
 * address an agent conversation or a stage the host holds until the task enters it.
 */
export class InterCardMessaging {
  constructor(private readonly deps: InterCardMessagingDeps) {}

  async send(input: SendTaskMessageInput): Promise<TaskMessageResult> {
    const sender = this.deps.locateBySession(input.senderSessionId);
    invariant(sender, 'MISSING_TASK_CONTEXT', 'Task messages are available only inside a task conversation.');
    const body = input.body.trim();
    invariant(body.length > 0, 'EMPTY_MESSAGE', 'A task message requires a non-empty body.');
    const sameTask = input.targetTaskId === undefined || input.targetTaskId === sender.task.id;
    if (sameTask) return this.sendWithinTask(sender, input, body);

    invariant(input.deliverAt === undefined, 'CROSS_TASK_ADDRESS', 'A destination stage addresses the sending task only.');
    const target = this.deps.locate(input.targetTaskId!);
    invariant(target, 'TASK_NOT_FOUND', 'The target task does not exist.');
    invariant(target.hubId === sender.hubId, 'CROSS_HUB_MESSAGE', 'A task message must target a task in the same Hub.');
    // A reply to a specialist addresses the agent of the target task, so it reaches
    // the conversation that asked; a bare target still lands in its main conversation.
    const targetAgent = input.agent === undefined ? undefined : agentFor(target.board.workflow, input.agent);
    invariant(input.agent === undefined || targetAgent !== undefined, 'AGENT_NOT_FOUND', 'The target workflow does not declare that agent.');
    const targetAgentId = targetAgent === undefined || targetAgent.id === MAIN_AGENT_ID ? undefined : targetAgent.id;
    const senderAgentId = sender.task.sessionRoles?.[input.senderSessionId]?.agent;
    const senderAgent = senderAgentId === undefined ? undefined : agentFor(sender.board.workflow, senderAgentId);
    const text = buildTaskMessageText({
      hubName: sender.hub.name,
      boardName: sender.board.name,
      taskTitle: sender.task.title,
      taskId: sender.task.id,
      ...(senderAgentId === undefined ? {} : { agent: senderAgentId }),
      ...(senderAgent === undefined ? {} : { agentName: senderAgent.name }),
    }, body);
    const summary = buildTaskMessageSummary(sender.task.title);
    const requestId = taskMessageIdentity(input.senderSessionId, input.callId);
    const delivery: TaskMessageDelivery = { requestId, senderSessionId: input.senderSessionId, senderTaskId: sender.task.id, text, summary };

    // Prepare the addressed conversation of the target task, then re-read the target
    // so the receipt reports the conversation and stage it actually reached.
    const prepared = targetAgentId === undefined
      ? (mainConversationId(target.task) === undefined ? await this.deps.prepare(target.task.id) : undefined)
      : undefined;
    const sessionId = targetAgentId === undefined
      ? mainConversationId(this.deps.locate(target.task.id)!.task) ?? prepared!.sessionId
      : await this.deps.agentConversation(target.task.id, targetAgentId);
    const current = this.deps.locate(target.task.id);
    invariant(current, 'TASK_NOT_FOUND', 'The target task no longer exists.');
    await this.deps.delivery.deliver(sessionId, delivery);
    const deliveredActivity = await this.activityOf(current.task);
    return {
      delivered: true,
      requestId,
      senderTaskId: sender.task.id,
      target: { taskId: current.task.id, title: current.task.title, sessionId, columnId: current.task.columnId, activity: deliveredActivity },
      createdConversation: prepared?.createdConversation === true && prepared.sessionId === sessionId,
      ...(prepared?.createdWorktree === undefined ? {} : { createdWorktree: prepared.createdWorktree }),
    };
  }

  /** A message within the sending task: an agent conversation, the main one, or a held stage. */
  private async sendWithinTask(sender: LocatedTask, input: SendTaskMessageInput, body: string): Promise<TaskMessageResult> {
    const workflow = sender.board.workflow;
    const agent = input.agent === undefined ? undefined : agentFor(workflow, input.agent);
    invariant(input.agent === undefined || agent !== undefined, 'AGENT_NOT_FOUND', 'The workflow does not declare that agent.');
    const targetAgent = agent === undefined || agent.id === MAIN_AGENT_ID ? undefined : agent.id;
    const stage = input.deliverAt === undefined ? undefined : workflow.columns.find(column => column.id === input.deliverAt);
    invariant(input.deliverAt === undefined || stage !== undefined, 'STAGE_NOT_FOUND', 'The workflow does not define that stage.');
    const senderAgentId = sender.task.sessionRoles?.[input.senderSessionId]?.agent;
    const senderAgent = senderAgentId === undefined ? undefined : agentFor(workflow, senderAgentId);
    const stageName = workflow.columns.find(column => column.id === sender.task.columnId)?.name ?? sender.task.columnId;
    const text = buildSameTaskMessageText({
      ...(senderAgentId === undefined ? {} : { agent: senderAgentId }),
      ...(senderAgent === undefined ? {} : { agentName: senderAgent.name }),
      stageName,
    }, body);
    const summary = buildSameTaskMessageSummary(senderAgent?.name);
    const requestId = taskMessageIdentity(input.senderSessionId, input.callId);
    const heldActivity = await this.activityOf(sender.task);
    const target = { taskId: sender.task.id, title: sender.task.title, columnId: sender.task.columnId, activity: heldActivity };

    if (stage !== undefined) {
      await this.deps.hold(sender.task.id, {
        id: requestId,
        fromSessionId: input.senderSessionId,
        ...(targetAgent === undefined ? {} : { agent: targetAgent }),
        columnId: stage.id,
        body,
        at: new Date().toISOString(),
      });
      return { delivered: false, held: { columnId: stage.id }, requestId, senderTaskId: sender.task.id, target, createdConversation: false };
    }
    // A message to the main conversation creates it through the same preparation as
    // any other message, so the receipt reports the conversation and worktree it made.
    const prepared = targetAgent === undefined && mainConversationId(sender.task) === undefined
      ? await this.deps.prepare(sender.task.id)
      : undefined;
    const sessionId = targetAgent === undefined
      ? mainConversationId(this.deps.locate(sender.task.id)!.task) ?? prepared!.sessionId
      : await this.deps.agentConversation(sender.task.id, targetAgent);
    const current = this.deps.locate(sender.task.id);
    invariant(current, 'TASK_NOT_FOUND', 'The task no longer exists.');
    const delivery: TaskMessageDelivery = { requestId, senderSessionId: input.senderSessionId, senderTaskId: sender.task.id, text, summary };
    await this.deps.delivery.deliver(sessionId, delivery);
    const activity = await this.activityOf(current.task);
    return {
      delivered: true,
      requestId,
      senderTaskId: sender.task.id,
      target: { taskId: current.task.id, title: current.task.title, sessionId, columnId: current.task.columnId, activity },
      createdConversation: prepared?.createdConversation === true && prepared.sessionId === sessionId,
      ...(prepared?.createdWorktree === undefined ? {} : { createdWorktree: prepared.createdWorktree }),
    };
  }

  private async activityOf(task: TaskActivityScope): Promise<TaskActivity> {
    if (this.deps.activity === undefined) return UNAVAILABLE_TASK_ACTIVITY;
    try { return await this.deps.activity(task); }
    catch { return UNAVAILABLE_TASK_ACTIVITY; }
  }
}
