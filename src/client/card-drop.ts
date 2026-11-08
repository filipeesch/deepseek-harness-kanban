/** One resolved drop target inside a card list. */
export interface CardDropTarget {
  readonly columnId: string;
  readonly columnName: string;
  readonly beforeTaskId: string | null;
  /** Where the insertion line sits inside the destination list, in list coordinates. */
  readonly indicatorY: number;
}

/** Finds the stage and the insertion point under a pointer. */
export interface CardDropResolver {
  resolve(point: { readonly x: number; readonly y: number }, taskId: string): CardDropTarget | null;
  /** Scrolls the drop surface when the pointer nears an edge. */
  autoScroll?(point: { readonly x: number; readonly y: number }): void;
}

/**
 * The board contract: a stage is any element with `data-column-id`, its cards
 * are `.kb-card` elements carrying `data-task-id` inside `.kb-card-list`, and
 * its name is the first `h2` of `.kb-column-header`. The diagram keeps the same
 * contract, so one resolver serves both presentations.
 */
export function boardDropResolver(): CardDropResolver {
  return {
    resolve({ x, y }, taskId) {
      const hit = document.elementFromPoint(x, y);
      const column = hit?.closest<HTMLElement>('[data-column-id]');
      if (!column) return null;
      const columnId = column.dataset['columnId'] ?? '';
      if (!columnId) return null;
      const list = column.querySelector<HTMLElement>('.kb-card-list');
      if (!list) return null;
      const cards = Array.from(list.querySelectorAll<HTMLElement>('.kb-card')).filter(card => card.dataset['taskId'] !== taskId);
      let index = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const cardRect = cards[i]!.getBoundingClientRect();
        if (y < cardRect.top + cardRect.height / 2) { index = i; break; }
      }
      const listRect = list.getBoundingClientRect();
      let indicatorY = 4;
      if (cards.length > 0 && index === 0) indicatorY = cards[0]!.getBoundingClientRect().top - listRect.top - 1;
      else if (cards.length > 0 && index >= cards.length) indicatorY = cards[cards.length - 1]!.getBoundingClientRect().bottom - listRect.top + 1;
      else if (cards.length > 0) {
        const previous = cards[index - 1]!.getBoundingClientRect();
        const next = cards[index]!.getBoundingClientRect();
        indicatorY = (previous.bottom + next.top) / 2 - listRect.top;
      }
      return {
        columnId,
        columnName: column.querySelector('.kb-column-header h2')?.textContent ?? columnId,
        beforeTaskId: cards[index]?.dataset['taskId'] ?? null,
        indicatorY,
      };
    },
    autoScroll({ x }) {
      const board = document.querySelector<HTMLElement>('.kb-columns');
      if (!board) return;
      const boardRect = board.getBoundingClientRect();
      if (x < boardRect.left + 60) board.scrollLeft -= 12;
      else if (x > boardRect.right - 60) board.scrollLeft += 12;
    },
  };
}
