// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RetainedCheckout } from '../../src/shared/types.js';
import { useBoardNotices } from '../../src/client/notices/use-board-notices.js';
import type { NoticeHandlers } from '../../src/client/notices/model.js';

const handlers: NoticeHandlers = {
  openTask: () => undefined,
  retryOperation: () => undefined,
  forceOperation: () => undefined,
  returnToProject: () => undefined,
  retryRelocation: () => undefined,
};

const retained: RetainedCheckout[] = [
  { path: '/trees/plain', projectId: 'p1', taskTitle: 'Alpha task', reason: 'folder' },
  { path: '/trees/gone', projectId: 'p1', taskTitle: 'Beta task', reason: 'unresolved' },
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    retained,
    tasks: [],
    projects: [],
    actionError: null,
    handlers,
    dismissal: { dismissRetained: vi.fn(async () => undefined), dismissFailure: vi.fn() },
    onDismissError: vi.fn(),
    ...overrides,
  };
}

describe('board notice dismissal', () => {
  it('hides a dismissed retained path before the host answers', async () => {
    let settle: (value: void) => void = () => undefined;
    const pending = new Promise<void>(resolve => { settle = resolve; });
    const dismissal = { dismissRetained: vi.fn(() => pending), dismissFailure: vi.fn() };
    const props = input({ dismissal });
    const { result } = renderHook(() => useBoardNotices(props));
    expect(result.current.notices).toHaveLength(2);
    act(() => { result.current.notices[0]!.dismiss!.run(); });
    expect(dismissal.dismissRetained).toHaveBeenCalledWith(['/trees/plain']);
    expect(result.current.notices.map(notice => notice.id)).toEqual(['retained:/trees/gone']);
    await act(async () => { settle(); await pending; });
    expect(result.current.notices.map(notice => notice.id)).toEqual(['retained:/trees/gone']);
  });

  it('restores the notice when the host rejects the dismissal', async () => {
    const dismissal = { dismissRetained: vi.fn(async () => { throw { code: 'STORAGE_SAVE_FAILED', message: 'Could not save.' }; }), dismissFailure: vi.fn() };
    const props = input({ dismissal });
    const { result } = renderHook(() => useBoardNotices(props));
    await act(async () => { result.current.notices[0]!.dismiss!.run(); });
    expect(result.current.notices.map(notice => notice.id)).toEqual(['retained:/trees/plain', 'retained:/trees/gone']);
    expect(props.onDismissError).toHaveBeenCalledOnce();
  });

  it('dismisses every retained path at once and offers no action when none remains', async () => {
    const dismissal = { dismissRetained: vi.fn(async () => undefined), dismissFailure: vi.fn() };
    const props = input({ dismissal });
    const { result } = renderHook(() => useBoardNotices(props));
    await act(async () => { result.current.dismissAllRetained!(); });
    expect(dismissal.dismissRetained).toHaveBeenCalledWith(['/trees/plain', '/trees/gone']);
    expect(result.current.notices).toHaveLength(0);
    expect(result.current.dismissAllRetained).toBeUndefined();
  });

  it('dismisses the command failure without touching the host', async () => {
    const dismissal = { dismissRetained: vi.fn(async () => undefined), dismissFailure: vi.fn() };
    const props = input({ dismissal, retained: [], actionError: { code: 'MOVE_FAILED', message: 'The move failed.' } });
    const { result } = renderHook(() => useBoardNotices(props));
    expect(result.current.notices.map(notice => notice.id)).toEqual(['command-failure']);
    act(() => { result.current.notices[0]!.dismiss!.run(); });
    expect(dismissal.dismissFailure).toHaveBeenCalledOnce();
    expect(dismissal.dismissRetained).not.toHaveBeenCalled();
  });
});
