import { describe, expect, it } from 'vitest';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { nativeHookPropName, orderNativeListEntries, renderableNativeEntries } from '../../src/client/native-slot-descriptors.js';

const entry = (id: string, order: number, extra: Partial<StoredEntry> = {}) => ({
  component: () => null,
  options: { id, order },
  ...extra,
}) as unknown as StoredEntry;

describe('native slot descriptors', () => {
  it('orders list winners by native order and registration sequence', () => {
    expect(orderNativeListEntries([entry('late', 20), entry('first', -10), entry('second', 10)]).map(value => value.options.id))
      .toEqual(['first', 'second', 'late']);
  });

  it('keeps one single winner and excludes store-backed replicas', () => {
    const storeBacked = entry('corner', 0, { store: {} as never });
    expect(renderableNativeEntries([storeBacked, entry('lineage', 0)], 'single').map(value => value.options.id)).toEqual(['lineage']);
    expect(renderableNativeEntries([entry('a', 0), entry('b', 0)], 'single').map(value => value.options.id)).toEqual(['a']);
  });

  it('supports exclusion and the native hook-name convention', () => {
    expect(renderableNativeEntries([entry('agent-preset', -10), entry('job-list', 20)], 'list', { exclude: value => value.options.id === 'agent-preset' }).map(value => value.options.id)).toEqual(['job-list']);
    expect(nativeHookPropName('agentPresets')).toBe('useAgentPresets');
  });
});
