import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

export const HANDOFF_CONTEXT_NODE_KIND = 'kanban-deterministic-handoff';
export const HANDOFF_CONTEXT_SOURCE_KIND = 'deterministic-handoff';
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'kanban-deterministic-handoff': ContextRowData }
}
/** Standalone manual-entry handoff is native context, never a user prompt. */
const row = createPluginContextRow({ nodeKind: HANDOFF_CONTEXT_NODE_KIND, sourceKind: HANDOFF_CONTEXT_SOURCE_KIND, title: 'Deterministic result', fallbackClassName: 'kb-handoff-context-fallback' });
export const deterministicHandoffDefinition = row.definition;
export const DeterministicHandoffNodeView = row.View;
export type DeterministicHandoffViewProps = ChatNodeViewProps<'kanban-deterministic-handoff'>;
