// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ClientApi, ModelCatalog } from '../../src/shared/types.js';
import { useModelCatalog } from '../../src/client/model/use-model-catalog.js';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const first: ModelCatalog = { default: { provider: 'a', model: 'one' }, providers: [{ id: 'a', name: 'A', models: [{ id: 'one', name: 'One' }] }], failures: [] };
const second: ModelCatalog = { default: { provider: 'b', model: 'two' }, providers: [{ id: 'b', name: 'B', models: [{ id: 'two', name: 'Two' }] }], failures: [] };

function apiWith(...answers: Array<Promise<ModelCatalog> | Error>): ClientApi {
  let index = 0;
  return { modelCatalog: vi.fn(() => { const next = answers[index++]; return next instanceof Error ? Promise.reject(next) : next!; }) } as unknown as ClientApi;
}

describe('useModelCatalog', () => {
  it('keeps a newer read when an older one resolves later', async () => {
    const slow = deferred<ModelCatalog>();
    const fast = deferred<ModelCatalog>();
    const api = apiWith(slow.promise, fast.promise);
    const { result } = renderHook(() => useModelCatalog(api));
    act(() => result.current.reload());
    act(() => fast.resolve(second));
    await waitFor(() => expect(result.current.catalog).toBe(second));
    act(() => slow.resolve(first));
    await waitFor(() => expect(result.current.catalog).toBe(second));
  });

  it('reports a failure and clears it on retry', async () => {
    const failing = deferred<ModelCatalog>();
    const api = apiWith(failing.promise, Promise.resolve(second));
    const { result } = renderHook(() => useModelCatalog(api));
    act(() => failing.reject(new Error('offline')));
    await waitFor(() => expect(result.current.error?.message).toBe('offline'));
    expect(result.current.catalog).toBeNull();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.catalog).toBe(second);
  });

  it('does nothing without a client api', () => {
    const { result } = renderHook(() => useModelCatalog(undefined));
    expect(result.current.catalog).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
