export const ACTIVE_HUB_KEY = 'dsh.kanban.activeHub';
export const ACTIVE_BOARDS_KEY = 'dsh.kanban.activeBoards';

export function readStorage(key: string): string | null { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
export function writeStorage(key: string, value: string | null): void { try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); } catch { /* preferences are best effort */ } }
export function readBoardPreferences(): Record<string, string> {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ACTIVE_BOARDS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {};
  } catch { return {}; }
}
export function writeBoardPreference(hubId: string, boardId: string, previous: Record<string, string>): Record<string, string> {
  const next = { ...previous, [hubId]: boardId };
  writeStorage(ACTIVE_BOARDS_KEY, JSON.stringify(next));
  return next;
}
