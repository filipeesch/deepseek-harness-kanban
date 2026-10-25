import React, { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { KanbanSnapshot, Command, Problem } from '../shared/types.js';
import { asProblem } from './problem.js';

export { asProblem };

export type RunCommand = (command: Command) => Promise<KanbanSnapshot>;

/** Entity identity belongs to the exact command response, never to a snapshot set difference. */
export function creationReceiptId(snapshot: KanbanSnapshot, kind: NonNullable<KanbanSnapshot['commandReceipt']>['kind']): string | undefined {
  const receipt = snapshot.commandReceipt;
  return receipt?.kind === kind && typeof receipt.id === 'string' && receipt.id.trim() ? receipt.id : undefined;
}

export function ErrorNotice({ problem }: { problem: Problem | null }) {
  return problem ? <div className="kb-error" role="alert"><strong>{problem.code}</strong><span>{problem.message}</span></div> : null;
}

export function ProblemNotice({ problem, title = 'The operation needs attention', sessionTitles, detailsLabel = 'Details' }: {
  problem: Problem | null;
  title?: string;
  sessionTitles?: { title(sessionId: string): string | undefined };
  detailsLabel?: string;
}) {
  if (!problem) return null;
  const details = problem.details ?? {};
  const sessionId = typeof details.sessionId === 'string' ? details.sessionId : undefined;
  const sessionTitle = sessionId ? sessionTitles?.title(sessionId) : undefined;
  const values = Object.entries(details);
  return <div className="kb-error" role="alert">
    <strong>{title}</strong>
    <span>{problem.message || 'The operation could not be completed.'}</span>
    {sessionId && <span className="kb-hint">Conversation: {sessionTitle ? sessionTitle + ' (' + sessionId + ')' : sessionId}</span>}
    <details className="kb-problem-details">
      <summary>{detailsLabel}</summary>
      <dl className="kb-problem-facts">
        <div><dt>Code</dt><dd><code>{problem.code}</code></dd></div>
        {values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{typeof value === 'string' ? value : JSON.stringify(value)}</code></dd></div>)}
      </dl>
    </details>
  </div>;
}

export function Markdown({ children }: { children: string }) {
  return <div className="kb-markdown"><ReactMarkdown skipHtml components={{ a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{label}</a> }}>{children}</ReactMarkdown></div>;
}

export function useAction(run: RunCommand) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const alive = useRef(true); const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function execute(command: Command) {
    if (inFlight.current) return null;
    inFlight.current = true; setPending(true); setError(null);
    try { return await run(command); }
    catch (failure) { const problem = asProblem(failure); if (alive.current) setError(problem); return null; }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  }
  return { pending, error, execute, clearError: () => setError(null) };
}

export function Modal({ title, children, onClose, busy = false, size = 'default', initialFocus = 'first', describedBy }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; size?: 'default' | 'wide'; initialFocus?: 'first' | 'cancel'; describedBy?: string }) {
  const id = useId(); const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ onClose, busy }); state.current = { onClose, busy };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"], [contenteditable="true"]:not([aria-disabled="true"])') ?? []).filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
    const preferred = initialFocus === 'cancel' ? dialog?.querySelector<HTMLElement>('[data-kb-initial-focus]') : undefined;
    const target = busy ? dialog : preferred ?? focusable()[0] ?? dialog;
    target?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!state.current.busy) state.current.onClose(); }
      if (event.key !== 'Tab') return;
      const items = focusable(); const first = items[0]; const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog?.addEventListener('keydown', key);
    return () => { dialog?.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [initialFocus, busy]);
  return <div className="kb-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className={'kb-dialog' + (size === 'wide' ? ' kb-dialog-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={describedBy} aria-busy={busy} ref={ref} tabIndex={-1}><header className="kb-dialog-header"><h2 id={id}>{title}</h2><button type="button" className="kb-button kb-icon-button" disabled={busy} onClick={onClose} aria-label={'Close ' + title}>×</button></header>{children}</div></div>;
}

export function Tabs({ label, values, selected, onSelect, id }: { label: string; values: readonly string[]; selected: string; onSelect: (value: string) => void; id: string }) {
  return <div role="tablist" aria-label={label} className="kb-tabs">{values.map((value, index) => <button type="button" className="kb-tab" key={value} id={id + '-tab-' + value} role="tab" aria-selected={selected === value} aria-controls={id + '-panel-' + value} tabIndex={selected === value ? 0 : -1} onClick={() => onSelect(value)} onKeyDown={event => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % values.length;
    else if (event.key === 'ArrowLeft') next = (index + values.length - 1) % values.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = values.length - 1;
    else return;
    event.preventDefault(); const target = values[next]; if (target) { onSelect(target); document.getElementById(id + '-tab-' + target)?.focus(); }
  }}>{value}</button>)}</div>;
}

export function submit(event: FormEvent) { event.preventDefault(); }
