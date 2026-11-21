import { useEffect, useRef, type RefObject } from 'react';

/**
 * Whether nothing on the page currently holds the focus: a removed control leaves the
 * document body focused, and a renderer that keeps the detached node as the active element
 * reports it as no longer connected.
 */
function focusIsLost(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  return !(active as HTMLElement).isConnected;
}

/**
 * Return focus to a stable control when a surface's failure notice closes.
 *
 * The notice and its two actions unmount with the last failure, and a focused control
 * that disappears drops the person's focus to the document body. The restore waits until
 * the target is usable again, because a retry that is still reading keeps the surface's
 * action disabled; it also never steals focus from a control the person moved to.
 *
 * @param failed - how many selections currently need a decision.
 * @param ready - whether the target action is enabled right now.
 * @param target - the control that becomes available once the failure is resolved.
 */
export function useRestoreFocusAfterFailure(failed: number, ready: boolean, target: RefObject<HTMLElement | null>): void {

  const previous = useRef(failed);
  const pending = useRef(false);
  useEffect(() => {
    if (previous.current > 0 && failed === 0) pending.current = focusIsLost();
    previous.current = failed;
    if (!pending.current || !ready) return;
    if (!focusIsLost()) { pending.current = false; return; }
    target.current?.focus();
    if (document.activeElement === target.current) pending.current = false;
  }, [failed, ready, target]);
}
