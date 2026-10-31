/** Minimal string storage port; adapters decide where preferences live. */
export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

/** Browser adapter; storage failures are best effort and never break the board. */
export function browserStorage(): KeyValueStorage {
  return {
    get(key: string): string | null {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    },
    set(key: string, value: string | null): void {
      try {
        if (value === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
      } catch { /* preferences are best effort */ }
    },
  };
}
