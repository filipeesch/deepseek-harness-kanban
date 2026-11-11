/** The stage under a connection gesture's pointer, in client coordinates. */
export interface ConnectionDropResolver {
  resolve(point: { readonly clientX: number; readonly clientY: number }): string | null;
}

/**
 * The board contract: a stage is any element with `data-column-id`. The card drag
 * uses the same contract, so one hit test serves both gestures and the diagram
 * needs no geometry of its own.
 */
export function boardConnectionDropResolver(): ConnectionDropResolver {
  return {
    resolve({ clientX, clientY }) {
      if (typeof document === 'undefined') return null;
      const hit = document.elementFromPoint(clientX, clientY);
      const stage = hit?.closest<HTMLElement>('[data-column-id]');
      return stage?.dataset['columnId'] ?? null;
    },
  };
}
