import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

export const TASK_MESSAGE_NODE_KIND = 'kanban-task-message';
export const TASK_MESSAGE_SOURCE_KIND = 'task-message';

/** Chat payload for the visible cross-card message row. */
export type KanbanTaskMessageData = ContextRowData;

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'kanban-task-message': KanbanTaskMessageData;
  }
}

/**
 * Claim the durable `task-message` source so a delivered cross-card message stays
 * visible in every task conversation surface, with the host's own context row.
 */
const row = createPluginContextRow({
  nodeKind: TASK_MESSAGE_NODE_KIND,
  sourceKind: TASK_MESSAGE_SOURCE_KIND,
  title: 'Task message',
  fallbackClassName: 'kb-task-message-fallback',
});

export const taskMessageDefinition = row.definition;
/** Delegate to the host's native context-row renderer, with an inline fallback. */
export const TaskMessageNodeView = row.View;

export type TaskMessageViewProps = ChatNodeViewProps<'kanban-task-message'>;
