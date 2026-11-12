// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClientApi } from '../../src/shared/types.js';
import { useSharingActions } from '../../src/client/sharing/actions.js';

function fakeApi(sharing: (command: unknown) => Promise<unknown>): ClientApi {
  return { sharing } as unknown as ClientApi;
}

describe('sharing actions', () => {
  it('dispatches the command and clears the pending label', async () => {
    const sharing = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSharingActions(fakeApi(sharing)));
    await act(async () => { await result.current.run('publish-board', { type: 'sharing.publishBoard', hubId: 'hub', boardId: 'board' }); });
    expect(sharing).toHaveBeenCalledWith({ type: 'sharing.publishBoard', hubId: 'hub', boardId: 'board' });
    expect(result.current.pending).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('reports progress while the command is in flight', async () => {
    let release: (() => void) | undefined;
    const sharing = () => new Promise<unknown>(resolve => { release = () => resolve(undefined); });
    const { result } = renderHook(() => useSharingActions(fakeApi(sharing as never)));
    let done: Promise<unknown> | undefined;
    act(() => { done = result.current.run('updates', { type: 'sharing.getUpdates', hubId: 'hub' }); });
    expect(result.current.pending).toBe('updates');
    await act(async () => { release?.(); await done; });
    expect(result.current.pending).toBeNull();
  });

  it('surfaces a failure and leaves the message for the caller', async () => {
    const sharing = vi.fn(async () => { throw { code: 'SHARING_FAILED', message: 'The team repository could not be reached.' }; });
    const onError = vi.fn();
    const { result } = renderHook(() => useSharingActions(fakeApi(sharing), { onError }));
    let failure: unknown;
    await act(async () => { failure = await result.current.run('publish-all', { type: 'sharing.publishAll', hubId: 'hub' }); });
    expect(failure).toMatchObject({ code: 'SHARING_FAILED' });
    expect(result.current.error).toMatchObject({ code: 'SHARING_FAILED' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it('explains that the view has no team settings when the api is missing', async () => {
    const { result } = renderHook(() => useSharingActions(undefined));
    let failure: unknown;
    await act(async () => { failure = await result.current.run('publish-board', { type: 'sharing.publishBoard', hubId: 'hub', boardId: 'board' }); });
    expect(failure).toMatchObject({ code: 'SHARING_UNAVAILABLE' });
    expect(result.current.error).toMatchObject({ code: 'SHARING_UNAVAILABLE' });
  });
});
