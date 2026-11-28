import type { Task, Workflow } from '../shared/types.js';
import { openSessionIds } from '../shared/conversations.js';
import { stageAgentId } from './agents.js';

/** The fields every conversation-role question reads. */
export type ConversationScope = Pick<Task, 'sessionIds' | 'closedSessionIds' | 'sessionRoles'>;

/** The agent a conversation was created for; absent means the main conversation. */
export function conversationAgent(scope: Pick<Task, 'sessionRoles'>, sessionId: string): string | undefined {
  return scope.sessionRoles?.[sessionId]?.agent;
}

/** The main conversation: the first open conversation that carries no agent binding. */
export function mainConversationId(scope: ConversationScope): string | undefined {
  return openSessionIds(scope).find(sessionId => conversationAgent(scope, sessionId) === undefined);
}

/** One agent's open conversation in the task. */
export function agentConversationId(scope: ConversationScope, agent: string): string | undefined {
  return openSessionIds(scope).find(sessionId => conversationAgent(scope, sessionId) === agent);
}

/**
 * The open conversation a message addressed to one agent, or to the main conversation
 * when no agent is named, lands in. It resolves only through open conversations, so a
 * reader that must not create one can still answer which conversation a target owns.
 */
export function addressedConversationId(scope: ConversationScope, agent: string | undefined): string | undefined {
  return agent === undefined ? mainConversationId(scope) : agentConversationId(scope, agent);
}

/**
 * The open conversation that owns one stage: the declared agent's conversation when the
 * stage names an agent, and the main conversation otherwise. Closing a conversation
 * removes it from the answer without removing its binding, so a reopen returns it.
 */
export function stageConversationId(scope: ConversationScope, workflow: Pick<Workflow, 'columns'>, columnId: string): string | undefined {
  const agent = stageAgentId(workflow.columns.find(column => column.id === columnId));
  return agent === undefined ? mainConversationId(scope) : agentConversationId(scope, agent);
}

/** The open conversation that owns the task's current stage. */
export function ownerConversationId(task: ConversationScope & Pick<Task, 'columnId'>, workflow: Pick<Workflow, 'columns'>): string | undefined {
  return stageConversationId(task, workflow, task.columnId);
}

/**
 * Whether one conversation is the one a stage belongs to: the declared agent's
 * conversation, or any conversation with no binding when the stage names none.
 * Binding, not openness, decides ownership, so a conversation that was closed after
 * its turn ended still owns the stage it ran.
 */
export function ownsStage(scope: Pick<Task, 'sessionRoles' | 'sessionIds'>, workflow: Pick<Workflow, 'columns'>, columnId: string, sessionId: string): boolean {
  const agent = stageAgentId(workflow.columns.find(column => column.id === columnId));
  const role = conversationAgent(scope, sessionId);
  if (agent !== undefined) return role === agent;
  // A stage without an agent belongs to the task's one main conversation: the first
  // conversation with no binding, whatever its open state. Any other unbound tab is a
  // side conversation and must not arm an advance merely because it also has no agent.
  const main = scope.sessionIds.find(value => conversationAgent(scope, value) === undefined);
  return sessionId === main;
}

/** Whether one conversation belongs to an agent rather than being the main one. */
export function isAgentConversation(scope: Pick<Task, 'sessionRoles'>, sessionId: string): boolean {
  return conversationAgent(scope, sessionId) !== undefined;
}
