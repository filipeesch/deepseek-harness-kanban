import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createPluginContextRow, type ContextRowData } from './context-row.js';

export const HANDOFF_CONTEXT_NODE_KIND = 'kanban-scripted-handoff';
export const HANDOFF_CONTEXT_SOURCE_KIND = 'scripted-handoff';
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'kanban-scripted-handoff': ContextRowData }
}
/** Standalone manual-entry handoff is native context, never a user prompt. */
const row = createPluginContextRow({ nodeKind: HANDOFF_CONTEXT_NODE_KIND, sourceKind: HANDOFF_CONTEXT_SOURCE_KIND, title: 'Script result', fallbackClassName: 'kb-handoff-context-fallback' });
export const scriptedHandoffDefinition = row.definition;
export const ScriptedHandoffNodeView = row.View;
export type ScriptedHandoffViewProps = ChatNodeViewProps<'kanban-scripted-handoff'>;