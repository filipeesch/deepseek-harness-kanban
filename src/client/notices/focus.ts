/**
 * Hand focus to the next dismissible notice when the activated one disappears, or to
 * the board body when no dismissible notice remains. Every control that is about to
 * unmount must be passed in, because React has not removed them yet.
 */
export function focusAfterDismissal(removing: readonly HTMLButtonElement[], fallback?: () => void): void {
  const scope = removing[0]?.ownerDocument ?? globalThis.document;
  const gone = new Set(removing);
  const remaining = Array.from(scope.querySelectorAll<HTMLButtonElement>('[data-kb-dismiss]'))
    .filter(candidate => !gone.has(candidate));
  const anchor = removing[0];
  const following = anchor === undefined
    ? remaining[0]
    : remaining.find(candidate => (anchor.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) ?? remaining[0];
  if (following) { following.focus(); return; }
  fallback?.();
  scope.querySelector<HTMLElement>('.kb-page-body')?.focus();
}
