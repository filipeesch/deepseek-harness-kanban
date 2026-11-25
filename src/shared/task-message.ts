import type { TaskActivity } from '../domain/task-activity.js';

/** One cross-card message prepared for delivery into a target task conversation. */
export interface TaskMessageDelivery {
  /** Stable delivery identity; a repeated identity is never delivered twice. */
  readonly requestId: string;
  /** The sending task's native conversation. */
  readonly senderSessionId: string;
  /** The sending task identity, so the recipient can reply. */
  readonly senderTaskId: string;
  /** Model-facing content: the sender identity header, the reply rule, and the body. */
  readonly text: string;
  /** One-line account the collapsed context row shows. */
  readonly summary: string;
}

/** The sending task fields the model-facing header names. */
export interface TaskMessageSender {
  readonly hubName: string;
  readonly boardName: string;
  readonly taskTitle: string;
  readonly taskId: string;
  /** The sending conversation's agent; absent means the sending task's main conversation. */
  readonly agent?: string;
  readonly agentName?: string;
}

/** One message held for a later stage, as the message path writes it. */
export interface HeldMessageWrite {
  readonly id: string;
  readonly fromSessionId: string;
  readonly agent?: string;
  readonly columnId: string;
  readonly body: string;
  readonly at: string;
}

/** What a prepared delivery created for a target task with no open conversation. */
export interface TaskMessagePreparation {
  readonly sessionId: string;
  readonly createdConversation: boolean;
  readonly createdWorktree?: { readonly path: string; readonly branch: string };
}

/** The observable result of one cross-card message. */
export interface TaskMessageResult {
  /** Whether the message reached a conversation now; false when it is held for a stage. */
  readonly delivered: boolean;
  /** Present when the message is held until the task enters that stage. */
  readonly held?: { readonly columnId: string };
  readonly requestId: string;
  readonly senderTaskId: string;
  readonly target: {
    readonly taskId: string;
    readonly title: string;
    /** The conversation the message was delivered to; absent while it is held. */
    readonly sessionId?: string;
    /** The target's stage at delivery, so the sender does not re-read the card to learn it. */
    readonly columnId: string;
    /** The target's activity at delivery; unavailable rather than omitted when it cannot be read. */
    readonly activity: TaskActivity;
  };
  readonly createdConversation: boolean;
  readonly createdWorktree?: { readonly path: string; readonly branch: string };
}

/** Stable delivery identity: one tool call from one sending conversation. */
export function taskMessageIdentity(senderSessionId: string, callId: string): string {
  return 'task-message:' + senderSessionId + ':' + callId;
}

/** Model-facing text: sender identity, the reply rule, then the caller's body. */
export function buildTaskMessageText(sender: TaskMessageSender, body: string): string {
  const from = sender.agent === undefined
    ? 'Message from task "' + sender.taskTitle + '" (' + sender.taskId + ')'
    : 'Message from the ' + (sender.agentName ?? sender.agent) + ' conversation of task "' + sender.taskTitle + '" (' + sender.taskId + ')';
  // The agent is the reply handle across tasks as well: a reply without it would land
  // in the main conversation and never reach the conversation that asked.
  const reply = sender.agent === undefined
    ? 'To reply, use send_task_message with task_id "' + sender.taskId + '", and only when this message asks for a reply or the user asks you to.'
    : 'To reply, use send_task_message with task_id "' + sender.taskId + '" and agent "' + sender.agent + '", and only when this message asks for a reply or the user asks you to.';
  return [
    from + ' in Hub "' + sender.hubName + '" on board "' + sender.boardName + '".',
    reply,
    '',
    body,
  ].join(String.fromCharCode(10));
}

/** The sending conversation of a message within one task. */
export interface SameTaskMessageSender {
  /** The sending conversation's agent; absent means its main conversation. */
  readonly agent?: string;
  readonly agentName?: string;
  /** The stage the message was sent from; absent when the sender is no longer in one. */
  readonly stageName?: string;
}

/**
 * Model-facing text of a message between conversations of one task: who sent it, how
 * to answer it, then the body. The agent identity is the reply handle.
 */
export function buildSameTaskMessageText(sender: SameTaskMessageSender, body: string): string {
  const who = sender.agent === undefined ? 'the main conversation of this task' : 'the ' + (sender.agentName ?? sender.agent) + ' conversation of this task';
  return [
    'Message from ' + who + (sender.stageName === undefined ? '' : ' during the ' + sender.stageName + ' stage') + '.',
    ...(sender.agent === undefined ? [] : ['To reply, use send_task_message with agent "' + sender.agent + '", and only when this message asks for a reply or the user asks you to.']),
    '',
    body,
  ].join(String.fromCharCode(10));
}

/** One-line account naming the sending task; the host bounds its own summary budget. */
export function buildTaskMessageSummary(taskTitle: string): string {
  return 'Task message from ' + taskTitle;
}

/** One-line account of a message between conversations of one task. */
export function buildSameTaskMessageSummary(agentName?: string): string {
  return 'Message from ' + (agentName === undefined ? 'the main conversation' : agentName + ' conversation');
}
