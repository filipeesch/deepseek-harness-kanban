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

/** Chat payload shared by every plugin message presented as a context row. */
export interface ContextRowData {
  readonly seq: number;
  readonly time: number;
  readonly content: readonly ContentBlock[];
  readonly source: unknown;
  readonly producer: ContextProducerView;
  readonly form: KnownContextForm | null;
}

type SourceEvent = Extract<ConversationMatch['event'], { type: 'user/message' }>;

/** Forms the host presents structurally; any other value stays opaque. */
const KNOWN_CONTEXT_FORMS: readonly string[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'];

/**
 * Read the form the durable source declares. The host's own mapper is not part of
 * its public client surface, so the same closed vocabulary is applied here.
 */
export function contextFormOf(source: unknown): KnownContextForm | null {
  const form = (source as { readonly form?: unknown } | null | undefined)?.form;
  return typeof form === 'string' && KNOWN_CONTEXT_FORMS.includes(form) ? form as KnownContextForm : null;
}

/** Whether one durable event is an appended plugin message of this source kind. */
export function isContextSourceEvent(event: ConversationStartMatch['event'] | ConversationMatch['event'], sourceKind: string): event is SourceEvent {
  return event.type === 'user/message'
    && event.surfaceOp === 'append'
    && (event.data.source as { kind?: unknown }).kind === sourceKind;
}

/** Project one durable message into the shared context-row payload. */
export function contextRowData(event: SourceEvent, sourceKind: string): ContextRowData {
  return {
    seq: event.seq,
    time: event.time,
    content: event.data.content,
    source: event.data.source,
    producer: { role: 'inject', label: sourceKind },
    form: contextFormOf(event.data.source),
  };
}

/**
 * Claim one plugin message before Chat's ordinary context Definition hides it,
 * and publish a visible custom node at its real position.
 */
export function createContextRowDefinition(nodeKind: string, sourceKind: string): ConversationNodeDefinition<ContextRowData> {
  return {
    kind: nodeKind,
    target: 'chat',
    match(event) {
      if (!isContextSourceEvent(event, sourceKind)) return null;
      return { id: String(event.data.id), role: 'start', exclusive: true };
    },
    start(_context: ConversationNodeContext, match: ConversationStartMatch) {
      if (!isContextSourceEvent(match.event, sourceKind)) throw new Error(nodeKind + ' start requires the ' + sourceKind + ' user message');
      return contextRowData(match.event, sourceKind);
    },
    update(context) {
      return context.state;
    },
    buildViewNode(context: ConversationNodeContext<ContextRowData>): ConversationViewNode | null {
      const state = context.state;
      if (state === undefined) return null;
      const node: ChatConversationViewNode = {
        key: context.key,
        kind: nodeKind,
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
}

/** Text blocks of one context row, used by the inline fallback. */
export function contextRowText(node: ChatNode<'context'> | { readonly data: ContextRowData }): string {
  return (node as { readonly data: ContextRowData }).data.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n');
}

const fallbackStyle = {
  margin: '8px 0', border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', borderRadius: 8,
  background: 'var(--dsw-alias-bg-l2, #f7f7f7)', fontSize: 12.5,
} as const;
// The default summary display keeps the browser's disclosure marker, so the
// fallback still advertises that the row expands.
const fallbackSummaryStyle = { padding: '8px 10px', cursor: 'pointer' } as const;
const fallbackBodyStyle = { margin: 0, padding: '0 10px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', maxHeight: 180, overflow: 'auto' } as const;

class NativeContextBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Keeps the row visible if a future host drops its context-row renderer. */
export function ContextRowFallback({ text, title, className }: { text: string; title: string; className: string }) {
  return <details className={className} data-kanban-context-row-fallback="" style={fallbackStyle}>
    <summary style={fallbackSummaryStyle}>{title}</summary>
    {text === '' ? null : <pre className={className + '-body'} style={fallbackBodyStyle}>{text}</pre>}
  </details>;
}

export interface ContextRowViewProps {
  readonly node: ChatNode<'context'> | { readonly data: ContextRowData };
  readonly t?: ChatNodeViewProps<'context'>['t'];
  readonly slots: NativeSlotSource;
  /** Fallback summary shown when the host's context-row renderer is unavailable. */
  readonly title: string;
  readonly fallbackClassName: string;
}

/**
 * Delegate to the host's own context-row renderer so the visible row keeps the
 * native disclosure chrome and escaped-content behavior.
 */
export function ContextRowView({ node, t, slots, title, fallbackClassName }: ContextRowViewProps) {
  useSlotEntries(slots, 'conversation.chat.node');
  const data = (node as { readonly data: ContextRowData }).data;
  // The native row reads the source summary; the fallback must keep the same
  // sender identity instead of collapsing every row to the static title.
  const source = (data.source as { readonly summary?: unknown } | null | undefined)?.summary;
  const fallbackTitle = typeof source === 'string' && source.trim() !== '' ? source : title;
  const fallback = <ContextRowFallback text={contextRowText({ data })} title={fallbackTitle} className={fallbackClassName} />;
  const nativeEntry = slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'context' && entry.component !== undefined);
  if (nativeEntry === undefined || t === undefined) return fallback;
  const Native = nativeEntry.component as ComponentType<Record<string, unknown>>;
  return <NativeContextBoundary key={String(nativeEntry.component)} fallback={fallback}>
    <Native node={{ ...(node as Record<string, unknown>), kind: 'context', data }} t={t} />
  </NativeContextBoundary>;
}

/** One plugin message row presented with the host's native context-row renderer. */
export interface PluginContextRowOptions<K extends keyof ChatNodeDataMap> {
  readonly nodeKind: K;
  readonly sourceKind: string;
  /** Fallback summary shown when the host's context-row renderer is unavailable. */
  readonly title: string;
  readonly fallbackClassName: string;
}

export interface PluginContextRowViewProps<K extends keyof ChatNodeDataMap> {
  readonly node: ChatNodeViewProps<K>['node'];
  readonly t?: ChatNodeViewProps<'context'>['t'];
  readonly slots: NativeSlotSource;
}

export interface PluginContextRow<K extends keyof ChatNodeDataMap> {
  readonly definition: ConversationNodeDefinition<ContextRowData>;
  readonly View: (props: PluginContextRowViewProps<K>) => React.ReactElement;
}

/**
 * Build the claim Definition and the visible view for one plugin message source.
 * Every plugin message row has the same behavior: claim the source exclusively and
 * delegate to the host's context-row renderer with an inline fallback.
 */
export function createPluginContextRow<K extends keyof ChatNodeDataMap>(options: PluginContextRowOptions<K>): PluginContextRow<K> {
  function View({ node, t, slots }: PluginContextRowViewProps<K>) {
    return <ContextRowView node={node} t={t} slots={slots} title={options.title} fallbackClassName={options.fallbackClassName} />;
  }
  return { definition: createContextRowDefinition(options.nodeKind, options.sourceKind), View };
}
