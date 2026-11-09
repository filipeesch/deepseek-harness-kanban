import { describe, expect, it, vi } from 'vitest';
import { beginConnectionDrag, type KeyboardEventsPort } from '../../src/client/workflow-view/gestures/connection-drag.js';
import type { PointerEventsPort, PointerPosition } from '../../src/client/workflow-view/gestures/stage-drag.js';

type PointerListener = (event: PointerPosition) => void;
type KeyListener = (event: { readonly key: string }) => void;

type PointerType = 'pointermove' | 'pointerup' | 'pointercancel';

function ports() {
  const pointers = new Map<PointerType, Set<PointerListener>>();
  const keys = new Set<KeyListener>();
  const events: PointerEventsPort = {
    addEventListener: (type, listener) => {
      const set = pointers.get(type) ?? new Set<PointerListener>();
      set.add(listener);
      pointers.set(type, set);
    },
    removeEventListener: (type, listener) => { pointers.get(type)?.delete(listener); },
  };
  const keyEvents: KeyboardEventsPort = {
    addEventListener: (_type, listener) => { keys.add(listener); },
    removeEventListener: (_type, listener) => { keys.delete(listener); },
  };
  const dispatch = (type: PointerType, event: PointerPosition) => { for (const listener of [...(pointers.get(type) ?? [])]) listener(event); };
  return {
    events, keyEvents,
    pointerListeners: () => (['pointermove', 'pointerup', 'pointercancel'] as const).reduce((total, type) => total + (pointers.get(type)?.size ?? 0), 0),
    move: (x: number, y: number, pointerId = 1) => dispatch('pointermove', { pointerId, clientX: x, clientY: y }),
    up: (pointerId = 1) => dispatch('pointerup', { pointerId, clientX: 0, clientY: 0 }),
    cancel: (pointerId = 1) => dispatch('pointercancel', { pointerId, clientX: 0, clientY: 0 }),
    press: (key: string) => { for (const listener of [...keys]) listener({ key }); },
  };
}

const start = { pointerId: 1, clientX: 100, clientY: 100 };

describe('connection drag gesture', () => {
  it('commits once after the pointer moved', () => {
    const fake = ports();
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove, onCommit, onCancel });
    fake.move(104, 100);
    fake.move(140, 100);
    fake.up();
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(fake.pointerListeners()).toBe(0);
  });

  it('observes a move below the threshold without previewing it', () => {
    const fake = ports();
    const onSample = vi.fn();
    const onMove = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onSample, onMove, onCommit: vi.fn(), onCancel: vi.fn() });
    fake.move(101, 100);
    expect(onSample).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
    fake.up();
  });

  it('treats a press without movement as no change and stores nothing', () => {
    const fake = ports();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove: vi.fn(), onCommit, onCancel });
    fake.move(101, 101);
    fake.up();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels with Escape', () => {
    const fake = ports();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove: vi.fn(), onCommit, onCancel });
    fake.move(160, 120);
    fake.press('Escape');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fake.pointerListeners()).toBe(0);
  });

  it('cancels on pointercancel', () => {
    const fake = ports();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove: vi.fn(), onCommit, onCancel });
    fake.move(160, 120);
    fake.cancel();
    fake.up();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a running gesture when it is disposed', () => {
    const fake = ports();
    const onMove = vi.fn();
    const onCancel = vi.fn();
    const handle = beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove, onCommit: vi.fn(), onCancel });
    fake.move(120, 120);
    handle.dispose();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fake.pointerListeners()).toBe(0);
  });

  it('ignores another pointer', () => {
    const fake = ports();
    const onMove = vi.fn();
    const onCommit = vi.fn();
    beginConnectionDrag({ start, events: fake.events, keys: fake.keyEvents, onMove, onCommit, onCancel: vi.fn() });
    fake.move(200, 200, 2);
    fake.up(2);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
