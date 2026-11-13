import React, { useCallback, useEffect, useRef } from 'react';
import { ConditionField } from '../stage/condition-field.js';
import type { ConditionAnchor } from './canvas.js';

const WIDTH = 340;
const ESTIMATED_HEIGHT = 250;
const GAP = 14;
const MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

/** Where the editor sits, kept inside the window whichever edge the connection is near. */
export function popoverPosition(
  anchor: ConditionAnchor,
  window: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = { width: WIDTH, height: ESTIMATED_HEIGHT },
): { left: number; top: number } {
  return {
    left: clamp(anchor.x - size.width / 2, MARGIN, window.width - size.width - MARGIN),
    top: clamp(anchor.y + GAP, MARGIN, window.height - size.height - MARGIN),
  };
}

export interface ConditionPopoverProps {
  /** Where the connection sits, in client coordinates. */
  readonly anchor: ConditionAnchor;
  /** The connection's accessible description, used as the editor's title. */
  readonly title: string;
  readonly value: string;
  readonly pending: boolean;
  readonly problem: string | null;
  readonly onSave: (value: string) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

/**
 * The editor for one connection's condition, anchored to that connection.
 *
 * It holds a draft: nothing is stored until the save action or Cmd/Ctrl+Enter, and
 * Escape, the cancel action, and a press outside dismiss it without storing. The
 * field is the same one the stage editor presents, so a condition is edited the
 * same way wherever it appears.
 */
export function ConditionPopover({ anchor, title, value, pending, problem, onSave, onDelete, onClose }: ConditionPopoverProps) {
  const [text, setText] = React.useState(value);
  const [size, setSize] = React.useState({ width: WIDTH, height: ESTIMATED_HEIGHT });
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = field.current?.querySelector('textarea');
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
    // Dismissing hands focus back to what had it, so the diagram keeps its place; a
    // connection end is an SVG control and may be gone, so the diagram shell is the fallback.
    return () => {
      if (previous !== null && previous.isConnected && previous !== document.body) { previous.focus(); return; }
      document.querySelector<HTMLElement>('.kb-flow-shell')?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!pending) onSave(text); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (surface.current !== null && target !== null && surface.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose, onSave, pending, text]);

  // The field can be resized and the problem line can grow, so the position follows the
  // editor's measured size instead of a constant estimate.
  useEffect(() => {
    const element = surface.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const position = popoverPosition(
    anchor,
    { width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 800 : window.innerHeight },
    size,
  );
  const submit = useCallback(() => { if (!pending) onSave(text); }, [onSave, pending, text]);
  return <div ref={surface} className="kb-condition-popover" role="dialog" aria-label={title} style={{ left: position.left, top: position.top, width: WIDTH }}>
    <div className="kb-condition-popover-head"><strong>{title}</strong></div>
    <div ref={field}><ConditionField value={text} label="Transition condition" disabled={pending} onChange={setText} /></div>
    {problem !== null && <p className="kb-hint kb-problem" role="alert">{problem}</p>}
    <div className="kb-transition-condition-actions">
      <button
        type="button"
        className="kb-button"
        title="Remove this connection"
        disabled={pending}
        onClick={onDelete}
      >Delete</button>
      <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
      <button type="button" className="kb-button kb-primary" disabled={pending} onClick={submit}>{pending ? 'Saving…' : 'Save'}</button>
    </div>
  </div>;
}
