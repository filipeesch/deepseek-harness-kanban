import type { ChatNodeDataMap, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

export const STAGE_NOTICE_NODE_KIND = 'kanban-stage-notice';
export const STAGE_NOTICE_SOURCE_KIND = 'stage-notice';

/** Chat payload for the visible stage-notice row. */
export type KanbanStageNoticeData = ContextRowData;

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'kanban-stage-notice': KanbanStageNoticeData;
  }
}

/**
 * Claim the durable `stage-notice` message so the announcement that a task changed
 * stage stays visible in every task conversation surface. It shares the stage row's
 * fallback styling: it is the same kind of row, a collapsed stage account.
 */
const row = createPluginContextRow({
  nodeKind: STAGE_NOTICE_NODE_KIND,
  sourceKind: STAGE_NOTICE_SOURCE_KIND,
  title: 'Stage notice',
  fallbackClassName: 'kb-stage-context-fallback',
});

export const stageNoticeDefinition = row.definition;
/** Delegate to the host's native context-row renderer, with an inline fallback. */
export const StageNoticeNodeView = row.View;

export type StageNoticeViewProps = ChatNodeViewProps<'kanban-stage-notice'>;
