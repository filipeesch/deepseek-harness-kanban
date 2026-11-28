import type { HeldMessage, HubTask, Workflow } from '../shared/types.js';
import { buildSameTaskMessageText, buildTaskMessageSummary, type TaskMessageDelivery } from '../shared/task-message.js';
import { agentFor } from '../domain/agents.js';
import { conversationAgent } from '../domain/conversation-role.js';

/**
 * Compose one held message as the model-facing delivery its target conversation reads.
 * The stage-entry batch admission and the separate release path share this composition,
 * so the same held record reaches its conversation the same way whichever path sends it.
 */
export function composeHeldMessageDelivery(task: HubTask, workflow: Workflow, message: HeldMessage): TaskMessageDelivery {
  const sender = conversationAgent(task, message.fromSessionId);
  const stageName = workflow.columns.find(column => column.id === message.columnId)?.name;
  const text = buildSameTaskMessageText({
    ...(sender === undefined ? {} : { agent: sender, agentName: agentFor(workflow, sender)?.name }),
    ...(stageName === undefined ? {} : { stageName }),
  }, message.body);
  return {
    requestId: message.id,
    senderSessionId: message.fromSessionId,
    senderTaskId: task.id,
    text,
    summary: buildTaskMessageSummary(task.title),
  };
}
