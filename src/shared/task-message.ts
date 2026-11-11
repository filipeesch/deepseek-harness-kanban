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
}

/** What a prepared delivery created for a target task with no open conversation. */
export interface TaskMessagePreparation {
  readonly sessionId: string;
  readonly createdConversation: boolean;
  readonly createdWorktree?: { readonly path: string; readonly branch: string };
}

/** The observable result of one cross-card message. */
export interface TaskMessageResult {
  readonly delivered: true;
  readonly requestId: string;
  readonly senderTaskId: string;
  readonly target: { readonly taskId: string; readonly title: string; readonly sessionId: string };
  readonly createdConversation: boolean;
  readonly createdWorktree?: { readonly path: string; readonly branch: string };
}

/** Stable delivery identity: one tool call from one sending conversation. */
export function taskMessageIdentity(senderSessionId: string, callId: string): string {
  return 'task-message:' + senderSessionId + ':' + callId;
}

/** Model-facing text: sender identity, the reply rule, then the caller's body. */
export function buildTaskMessageText(sender: TaskMessageSender, body: string): string {
  return [
    'Message from task "' + sender.taskTitle + '" (' + sender.taskId + ') in Hub "' + sender.hubName + '" on board "' + sender.boardName + '".',
    'To reply, use send_task_message with task_id "' + sender.taskId + '", and only when this message asks for a reply or the user asks you to.',
    '',
    body,
  ].join(String.fromCharCode(10));
}

/** One-line account naming the sending task; the host bounds its own summary budget. */
export function buildTaskMessageSummary(taskTitle: string): string {
  return 'Task message from ' + taskTitle;
}
