import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { ContextRowView, createContextRowDefinition, type ContextRowData } from './context-row.js';
import type { NativeSlotSource } from './native-slot-host.js';

export const STAGE_CONTEXT_NODE_KIND = 'kanban-stage-context';
export const STAGE_CONTEXT_SOURCE_KIND = 'stage-instruction';

/** Chat payload for the visible stage-instruction row. */
export type KanbanStageContextData = ContextRowData;

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'kanban-stage-context': KanbanStageContextData;
  }
}

/**
 * Claim the durable `stage-instruction` message so a delivered instruction stays
 * visible in every task conversation surface, not only where the host keeps the
 * projection that presents a claimed message on its own.
 */
export const stageInstructionDefinition = createContextRowDefinition(STAGE_CONTEXT_NODE_KIND, STAGE_CONTEXT_SOURCE_KIND);

export interface StageInstructionNodeViewProps {
  node: ChatNodeViewProps<'kanban-stage-context'>['node'];
  t?: ChatNodeViewProps<'context'>['t'];
  slots: NativeSlotSource;
}

/** Delegate to the host's native context-row renderer, with an inline fallback. */
export function StageInstructionNodeView({ node, t, slots }: StageInstructionNodeViewProps) {
  return <ContextRowView node={node} t={t} slots={slots} title="Stage instruction" fallbackClassName="kb-stage-context-fallback" />;
}

export type StageInstructionViewProps = ChatNodeViewProps<'kanban-stage-context'>;
