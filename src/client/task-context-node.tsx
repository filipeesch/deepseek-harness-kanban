import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

export const TASK_CONTEXT_NODE_KIND = 'kanban-task-context';
export const TASK_CONTEXT_SOURCE_KIND = 'kanban-task';

/** Chat payload for the visible task-context row. */
export type KanbanTaskContextData = ContextRowData;

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'kanban-task-context': KanbanTaskContextData;
  }
}

/**
 * Claim the durable `kanban-task` message before Chat's ordinary context
 * Definition hides it, and publish a visible custom node at its real position.
 */
const row = createPluginContextRow({
  nodeKind: TASK_CONTEXT_NODE_KIND,
  sourceKind: TASK_CONTEXT_SOURCE_KIND,
  title: 'Task context',
  fallbackClassName: 'kb-task-context-fallback',
});

export const taskContextDefinition = row.definition;
/** Delegate to the host's native context-row renderer, with an inline fallback. */
export const TaskContextNodeView = row.View;

export type TaskContextViewProps = ChatNodeViewProps<'kanban-task-context'>;
