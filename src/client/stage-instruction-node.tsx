import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

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
const row = createPluginContextRow({
  nodeKind: STAGE_CONTEXT_NODE_KIND,
  sourceKind: STAGE_CONTEXT_SOURCE_KIND,
  title: 'Stage instruction',
  fallbackClassName: 'kb-stage-context-fallback',
});

export const stageInstructionDefinition = row.definition;
/** Delegate to the host's native context-row renderer, with an inline fallback. */
export const StageInstructionNodeView = row.View;

export type StageInstructionViewProps = ChatNodeViewProps<'kanban-stage-context'>;
