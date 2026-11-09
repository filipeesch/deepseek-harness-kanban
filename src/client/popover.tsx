import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

export interface PopoverHandle {
  /** Close the popover; focus returns to the trigger only when asked, so an action inside can keep focus. */
  close: (restoreFocus?: boolean) => void;
}

export interface PopoverProps {
  /** Accessible name of the dialog. */
  label: string;
  /** Content of the trigger button; the primitive owns the button and its dialog attributes. */
  trigger: ReactNode;
  triggerClassName: string;
  /** Accessible name and tooltip of the trigger. */
  triggerLabel: string;
  triggerDisabled?: boolean;
  /** Which edge of the anchor the popover lines up with. */
  align?: 'start' | 'end';
  /** When false, Escape and outside clicks are ignored, so a pending action cannot be lost. */
  dismissable?: boolean;
  /** Element focused when the popover opens; omit to leave focus on the trigger. */
  initialFocusSelector?: string;
  busy?: boolean;
  anchorClassName?: string;
  popoverClassName?: string;
  /** Called when the popover opens, so a consumer can clear a stale notice. */
  onOpen?: () => void;
  children: ReactNode;
}

/**
 * Open popovers in the order they were raised. Document listeners fire in registration
 * order, not in paint order, so without this the oldest open popover would swallow Escape
 * and dismiss itself while a newer popover painted above it stayed open.
 */
const raised: symbol[] = [];

/**
 * An anchored, non-modal dialog opened from a toolbar control. The primitive owns the
 * parts that are easy to get wrong - the dialog attributes, outside-pointer and Escape
 * handling, focus restoration, and stacking - so a consumer only supplies a trigger
 * and a body, and the drawer behind a popover stays open when only the popover is dismissed.
 */
export const Popover = forwardRef<PopoverHandle, PopoverProps>(function Popover({
  label, trigger, triggerClassName, triggerLabel, triggerDisabled = false, align = 'end',
  dismissable = true, initialFocusSelector, busy = false, anchorClassName = '', popoverClassName = '', onOpen, children,
}, ref) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const token = useRef<symbol>(Symbol('kb-popover'));
  const anchor = useRef<HTMLDivElement>(null);
  const triggerElement = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus && triggerElement.current?.isConnected) triggerElement.current.focus();
  }, []);

  useImperativeHandle(ref, () => ({ close }), [close]);

  /**
   * Take the trigger back only when the dismissed click left focus stranded on the page.
   * The default focus action of a pointer press runs after the event settles, so this has
   * to look at the result rather than decide during dispatch.
   */
  const reclaimTriggerFocus = useCallback(() => {
    window.setTimeout(() => {
      const trigger = triggerElement.current;
      if (trigger?.isConnected && (document.activeElement === null || document.activeElement === document.body)) trigger.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    raised.push(token.current);
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || anchor.current?.contains(event.target)) return;
      // Close without touching focus, then take the trigger back only if the click left
      // focus stranded on the page. Cancelling pointerdown would cancel a board drag too,
      // and stealing focus back from a control the user just pointed at loses their intent.
      close(false);
      reclaimTriggerFocus();
    };
    const key = (event: KeyboardEvent) => {
      // Only the topmost popover answers Escape, and it shields the drawer behind it.
      if (event.key !== 'Escape' || event.defaultPrevented || raised[raised.length - 1] !== token.current) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    if (dismissable) {
      document.addEventListener('pointerdown', pointer, true);
      document.addEventListener('keydown', key, true);
    }
    return () => {
      const at = raised.indexOf(token.current);
      if (at >= 0) raised.splice(at, 1);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, dismissable, close, reclaimTriggerFocus]);

  useEffect(() => {
    if (!open || initialFocusSelector === undefined) return;
    popover.current?.querySelector<HTMLElement>(initialFocusSelector)?.focus();
  }, [open, initialFocusSelector]);

  function toggle() {
    if (open) { close(true); return; }
    onOpen?.();
    setOpen(true);
  }

  const join = (base: string, extra: string) => (extra === '' ? base : base + ' ' + extra);

  return <div className={join('kb-popover-anchor', anchorClassName)} ref={anchor}>
    <button
      ref={triggerElement}
      type="button"
      className={triggerClassName}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id + '-popover' : undefined}
      aria-label={triggerLabel}
      title={triggerLabel}
      disabled={triggerDisabled}
      onClick={toggle}
    >{trigger}</button>
    {open && <div
      ref={popover}
      id={id + '-popover'}
      className={join('kb-popover is-' + align, popoverClassName)}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      aria-busy={busy || undefined}
    >{children}</div>}
  </div>;
});
