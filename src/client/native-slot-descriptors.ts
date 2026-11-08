import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';

export type NativeSlotKind = 'single' | 'list';

/** Keep native work-details copy and hook names aligned with the host renderer. */
export function nativeHookPropName(source: string): string {
  return 'use' + source.charAt(0).toUpperCase() + source.slice(1);
}

/** Order list winners the way the native actions/utilities bands render them. */
export function orderNativeListEntries(entries: readonly StoredEntry[]): readonly StoredEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (left.entry.options.order ?? 0) - (right.entry.options.order ?? 0) || left.index - right.index)
    .map(value => value.entry);
}

/**
 * Select the entries a manual native-slot host can render.
 * Store-backed entries are excluded: a second store instance cannot control the
 * real native surface, so rendering one would be a broken affordance.
 */
export function renderableNativeEntries(
  entries: readonly StoredEntry[],
  kind: NativeSlotKind,
): readonly StoredEntry[] {
  const renderable = orderNativeListEntries(entries.filter(entry => entry.component !== undefined && entry.store === undefined));
  return kind === 'list' ? renderable : renderable.slice(0, 1);
}
