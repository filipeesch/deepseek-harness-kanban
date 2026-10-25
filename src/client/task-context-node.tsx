import React, { Component, type ComponentType, type ReactNode } from 'react';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type {
  ChatConversationViewNode, ChatNode, ChatNodeDataMap, ChatNodeViewProps,
} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {
  ContextProducerView, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
  ConversationStartMatch, ConversationViewNode, KnownContextForm,
} from '@deepseek-ai/dsh-client-ui-conversation/client';
import { useSlotEntries, type NativeSlotSource } from './native-slot-host.js';

export const TASK_CONTEXT_NODE_KIND = 'kanban-task-context';
export const TASK_CONTEXT_SOURCE_KIND = 'kanban-task';

/** Chat payload for the visible task-context row. */
export interface KanbanTaskContextData {
  readonly seq: number;
  readonly time: number;
  readonly content: readonly ContentBlock[];
  readonly source: unknown;
  readonly producer: ContextProducerView;
  readonly form: KnownContextForm | null;
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'kanban-task-context': KanbanTaskContextData;
  }
}

function isTaskContextEvent(event: ConversationStartMatch['event'] | ConversationMatch['event']): event is Extract<ConversationMatch['event'], { type: 'user/message' }> {
  return event.type === 'user/message'
    && event.surfaceOp === 'append'
    && (event.data.source as { kind?: unknown }).kind === TASK_CONTEXT_SOURCE_KIND;
}

function stateOf(event: Extract<ConversationMatch['event'], { type: 'user/message' }>): KanbanTaskContextData {
  return {
    seq: event.seq,
    time: event.time,
    content: event.data.content,
    source: event.data.source,
    producer: { role: 'inject', label: TASK_CONTEXT_SOURCE_KIND },
    form: null,
  } satisfies KanbanTaskContextData;
}

/**
 * Claim the durable `kanban-task` message before Chat's ordinary context
 * Definition hides it, and publish a visible custom node at its real position.
 */
export const taskContextDefinition: ConversationNodeDefinition<KanbanTaskContextData> = {
  kind: TASK_CONTEXT_NODE_KIND,
  target: 'chat',
  match(event) {
    if (!isTaskContextEvent(event)) return null;
    return { id: String(event.data.id), role: 'start', exclusive: true };
  },
  start(_context: ConversationNodeContext, match: ConversationStartMatch) {
    if (!isTaskContextEvent(match.event)) throw new Error('kanban task context start requires the kanban-task user message');
    return stateOf(match.event);
  },
  update(context) {
    return context.state;
  },
  buildViewNode(context: ConversationNodeContext<KanbanTaskContextData>): ConversationViewNode | null {
    const state = context.state;
    if (state === undefined) return null;
    const node: ChatConversationViewNode = {
      key: context.key,
      kind: TASK_CONTEXT_NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      groupTree: 'turn',
      data: state,
    };
    return node;
  },
};

export interface TaskContextNodeViewProps {
  node: ChatNode<'kanban-task-context'>;
  t?: ChatNodeViewProps<'kanban-task-context'>['t'];
  slots: NativeSlotSource;
}

function textOf(node: ChatNode<'kanban-task-context'>): string {
  return node.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
}

/** Fallback keeps the context visible if a future host drops its context-row renderer. */
const fallbackStyle = {
  margin: '8px 0', border: '1px solid var(--dsh-alias-border-l2, #d0d0d0)', borderRadius: 8,
  background: 'var(--dsh-alias-bg-l2, #f7f7f7)', fontSize: 12.5,
} as const;
const fallbackSummaryStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' } as const;
const fallbackBodyStyle = { margin: 0, padding: '0 10px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', maxHeight: 180, overflow: 'auto' } as const;

class NativeContextBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function TaskContextFallback({ node }: Pick<TaskContextNodeViewProps, 'node'>) {
  const text = textOf(node);
  return <details className="kb-task-context-fallback" data-kanban-task-context-fallback="" style={fallbackStyle}>
    <summary style={fallbackSummaryStyle}>Task context</summary>
    {text === '' ? null : <pre className="kb-task-context-fallback-body" style={fallbackBodyStyle}>{text}</pre>}
  </details>;
}

/**
 * Delegate to the host's own context-row renderer so the visible row keeps the
 * native disclosure chrome and escaped-content behavior.
 */
export function TaskContextNodeView({ node, t, slots }: TaskContextNodeViewProps) {
  useSlotEntries(slots, 'conversation.chat.node');
  const nativeEntry = slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'context' && entry.component !== undefined);
  if (nativeEntry === undefined || t === undefined) return <TaskContextFallback node={node} />;
  const Native = nativeEntry.component as ComponentType<Record<string, unknown>>;
  return <NativeContextBoundary key={String(nativeEntry.component)} fallback={<TaskContextFallback node={node} />}>
    <Native node={{ ...node, kind: 'context', data: node.data }} t={t} />
  </NativeContextBoundary>;
}

export type TaskContextViewProps = ChatNodeViewProps<'kanban-task-context'>;
