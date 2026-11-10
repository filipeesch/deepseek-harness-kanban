import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { ContextRowView, createContextRowDefinition, type ContextRowData } from './context-row.js';
import type { NativeSlotSource } from './native-slot-host.js';

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
export const taskContextDefinition = createContextRowDefinition(TASK_CONTEXT_NODE_KIND, TASK_CONTEXT_SOURCE_KIND);

export interface TaskContextNodeViewProps {
  node: ChatNodeViewProps<'kanban-task-context'>['node'];
  t?: ChatNodeViewProps<'context'>['t'];
  slots: NativeSlotSource;
}

/** Delegate to the host's native context-row renderer, with an inline fallback. */
export function TaskContextNodeView({ node, t, slots }: TaskContextNodeViewProps) {
  return <ContextRowView node={node} t={t} slots={slots} title="Task context" fallbackClassName="kb-task-context-fallback" />;
}

export type TaskContextViewProps = ChatNodeViewProps<'kanban-task-context'>;
