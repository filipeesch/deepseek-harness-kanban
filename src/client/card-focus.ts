/**
 * The activatable control of a rendered task card, for either presentation:
 * the board card is a container with a `.kb-card-open` child, while the diagram
 * card is itself a button.
 */
export function cardFocusTarget(taskId: string, root: ParentNode = document): HTMLElement | null {
  const card = Array.from(root.querySelectorAll<HTMLElement>('[data-task-id]')).find(element => element.dataset['taskId'] === taskId) ?? null;
  if (card === null) return null;
  if (card.matches('button, [role="button"], a[href], input, select, textarea')) return card;
  return card.querySelector<HTMLElement>('.kb-card-open, button, [role="button"], a[href]');
}
