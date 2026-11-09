// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { StagePosition } from '../../src/shared/types.js';
import { beginStageDrag, draggedPosition, movedPastThreshold, type PointerEventsPort, type PointerPosition } from '../../src/client/workflow-view/gestures/stage-drag.js';
import { beginStageResize } from '../../src/client/workflow-view/gestures/stage-resize.js';
import { gridSnapPolicy } from '../../src/client/workflow-view/gestures/grid-snap.js';
import { FLOW_ZOOM, clampZoom, nextZoom, zoomAroundPoint } from '../../src/client/workflow-view/gestures/viewport-policy.js';

type Listener = (event: PointerPosition) => void;

function pointerPort() {
  const listeners = new Map<string, Set<Listener>>();
  const port: PointerEventsPort = {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  return {
    port,
    emit(type: 'pointermove' | 'pointerup' | 'pointercancel', event: PointerPosition) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

const start: PointerPosition = { pointerId: 1, clientX: 100, clientY: 100 };

describe('pointer geometry', () => {
  it('corrects a dragged point for the current zoom', () => {
    expect(draggedPosition({ x: 10, y: 20 }, start, { pointerId: 1, clientX: 140, clientY: 120 }, 2)).toEqual({ x: 30, y: 30 });
    expect(draggedPosition({ x: 10, y: 20 }, start, { pointerId: 1, clientX: 140, clientY: 120 }, 0)).toEqual({ x: 50, y: 40 });
  });

  it('separates a click from a drag', () => {
    expect(movedPastThreshold(start, { pointerId: 1, clientX: 102, clientY: 102 })).toBe(false);
    expect(movedPastThreshold(start, { pointerId: 1, clientX: 110, clientY: 110 })).toBe(true);
  });
});

describe('stage drag gesture', () => {
  it('commits once and releases the gesture so the next one can start', () => {
    const events = pointerPort();
    let active: { dispose(): void } | null = null;
    const onCommit = vi.fn();
    const onMove = vi.fn();
    const onCancel = vi.fn();
    function begin() {
      if (active !== null) return;
      const handle = beginStageDrag({
        stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port,
        onMove: (id: string, position: StagePosition) => onMove(id, position),
        onCommit: (id: string, position: StagePosition) => { active = null; onCommit(id, position); },
        onCancel: () => { active = null; onCancel(); },
      });
      active = handle;
    }
    begin();
    events.emit('pointermove', { pointerId: 1, clientX: 140, clientY: 120 });
    events.emit('pointermove', { pointerId: 1, clientX: 160, clientY: 140 });
    expect(onMove).toHaveBeenCalledTimes(2);
    events.emit('pointerup', { pointerId: 1, clientX: 160, clientY: 140 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('one', { x: 60, y: 40 });
    expect(active).toBeNull();
    expect(events.listenerCount()).toBe(0);

    begin();
    events.emit('pointermove', { pointerId: 1, clientX: 110, clientY: 110 });
    events.emit('pointerup', { pointerId: 1, clientX: 110, clientY: 110 });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('treats a press without movement as a click', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const handle = beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port,
      onMove: vi.fn(), onCommit, onCancel,
    });
    events.emit('pointerup', { pointerId: 1, clientX: 101, clientY: 101 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(events.listenerCount()).toBe(0);
    handle.dispose();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disposing releases the listeners and cancels', () => {
    const events = pointerPort();
    const onCancel = vi.fn();
    const handle = beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port,
      onMove: vi.fn(), onCommit: vi.fn(), onCancel,
    });
    handle.dispose();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(events.listenerCount()).toBe(0);
  });
});

describe('stage resize gesture', () => {
  it('cancels a press that never moved instead of authoring the current size', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port,
      onResize: vi.fn(), onCommit, onCancel,
    });
    events.emit('pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('grows a content-tall stage outward from the visible rectangle', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 1257 }, authored: { width: 300, height: 140 }, zoom: () => 1, events: events.port,
      onResize: vi.fn(), onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 100, clientY: 160 });
    events.emit('pointerup', { pointerId: 1, clientX: 100, clientY: 160 });
    expect(onCommit).toHaveBeenCalledWith('one', { width: 300, height: 1317 });
  });

  it('keeps the authored height for a width-only drag on a content-tall stage', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 1257 }, authored: { width: 300, height: 140 }, zoom: () => 1, events: events.port,
      onResize: vi.fn(), onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 150, clientY: 100 });
    events.emit('pointerup', { pointerId: 1, clientX: 150, clientY: 100 });
    expect(onCommit).toHaveBeenCalledWith('one', { width: 350, height: 140 });
  });

  it('does not record the content-grown height when an inward drag is clamped', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 1257 }, authored: { width: 300, height: 140 }, zoom: () => 1, events: events.port,
      onResize: vi.fn(), onCommit, onCancel,
    });
    events.emit('pointermove', { pointerId: 1, clientX: 100, clientY: 40 });
    events.emit('pointerup', { pointerId: 1, clientX: 100, clientY: 40 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clamps the size to the accepted bounds and commits once', () => {
    const events = pointerPort();
    const onResize = vi.fn();
    const onCommit = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 2, events: events.port,
      onResize, onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 200, clientY: 300 });
    expect(onResize).toHaveBeenCalledWith('one', { width: 350, height: 300 });
    events.emit('pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onResize).toHaveBeenLastCalledWith('one', { width: 264, height: 150 });
    events.emit('pointerup', { pointerId: 1, clientX: 0, clientY: 0 });
  });
});

describe('grid snapping in the gestures', () => {
  const snap = gridSnapPolicy();

  it('settles a dragged stage on the lattice and commits the settled position', () => {
    const events = pointerPort();
    const onMove = vi.fn();
    const onCommit = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port, snap,
      onMove, onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 143, clientY: 121 });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 40, y: 24 });
    events.emit('pointerup', { pointerId: 1, clientX: 143, clientY: 121 });
    expect(onCommit).toHaveBeenCalledWith('one', { x: 40, y: 24 });
  });

  it('ignores the lattice for a gesture that uses the bypass modifier', () => {
    const events = pointerPort();
    const onMove = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port, snap,
      onMove, onCommit: vi.fn(), onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 143, clientY: 121, altKey: true });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 43, y: 21 });
    // Releasing the modifier does not snap the rest of the gesture back.
    events.emit('pointermove', { pointerId: 1, clientX: 150, clientY: 130 });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 50, y: 30 });
  });

  it('cancels a drag that returns to the stored position at a fractional zoom', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 2.5, events: events.port,
      onMove: vi.fn(), onCommit, onCancel,
    });
    // Ten screen pixels away and back to half a pixel past the start: the raw
    // position is fractional, but the persisted whole unit is the origin.
    events.emit('pointermove', { pointerId: 1, clientX: 110, clientY: 100 });
    events.emit('pointermove', { pointerId: 1, clientX: 100.5, clientY: 100 });
    events.emit('pointerup', { pointerId: 1, clientX: 100.5, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('commits the whole-unit position the workflow stores', () => {
    const events = pointerPort();
    const onMove = vi.fn();
    const onCommit = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 2.5, events: events.port,
      onMove, onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 103, clientY: 100 });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 1.2, y: 0 });
    events.emit('pointerup', { pointerId: 1, clientX: 103, clientY: 100 });
    expect(onCommit).toHaveBeenCalledWith('one', { x: 1, y: 0 });
  });

  it('cancels a drag that settles on the position it started from', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port, snap,
      onMove: vi.fn(), onCommit, onCancel,
    });
    // A 3px drag stays inside the first half step, so the settled position is the origin.
    events.emit('pointermove', { pointerId: 1, clientX: 103, clientY: 101 });
    events.emit('pointerup', { pointerId: 1, clientX: 103, clientY: 101 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('settles a resized stage on the lattice', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port, snap,
      onResize: vi.fn(), onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 150, clientY: 130 });
    events.emit('pointerup', { pointerId: 1, clientX: 150, clientY: 130 });
    expect(onCommit).toHaveBeenCalledWith('one', { width: 352, height: 232 });
  });

  it('raises a snapped size to the smallest lattice point above the minimum', () => {
    const events = pointerPort();
    const onResize = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port, snap,
      onResize, onCommit: vi.fn(), onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 50, clientY: 40 });
    expect(onResize).toHaveBeenLastCalledWith('one', { width: 264, height: 144 });
  });

  it('cancels a snapped resize that settles on the size it started from', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    // An authored size that is already a lattice point: a 3px drag settles on it.
    beginStageResize({
      stageId: 'one', start, origin: { width: 304, height: 208 }, authored: { width: 304, height: 208 }, zoom: () => 1, events: events.port, snap,
      onResize: vi.fn(), onCommit, onCancel,
    });
    events.emit('pointermove', { pointerId: 1, clientX: 103, clientY: 100 });
    events.emit('pointerup', { pointerId: 1, clientX: 103, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stores a snapped resize that moves an off-lattice size onto the lattice', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    // 300 is not a lattice point, so a 3px drag settles on 304, which differs
    // from the size the gesture started from and is therefore a real edit.
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port, snap,
      onResize: vi.fn(), onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 103, clientY: 100 });
    events.emit('pointerup', { pointerId: 1, clientX: 103, clientY: 100 });
    expect(onCommit).toHaveBeenCalledWith('one', { width: 304, height: 200 });
  });

  it('keeps the drag bypass engaged when the modifier appears before the threshold', () => {
    const events = pointerPort();
    const onMove = vi.fn();
    beginStageDrag({
      stageId: 'one', start, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port, snap,
      onMove, onCommit: vi.fn(), onCancel: vi.fn(),
    });
    // Pressed and released inside the threshold: the gesture still remembers it.
    events.emit('pointermove', { pointerId: 1, clientX: 101, clientY: 100, altKey: true });
    events.emit('pointermove', { pointerId: 1, clientX: 113, clientY: 100 });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 13, y: 0 });
  });

  it('keeps the drag bypass engaged when the press carried the modifier', () => {
    const events = pointerPort();
    const onMove = vi.fn();
    beginStageDrag({
      stageId: 'one', start: { ...start, altKey: true }, origin: { x: 0, y: 0 }, zoom: () => 1, events: events.port, snap,
      onMove, onCommit: vi.fn(), onCancel: vi.fn(),
    });
    // The modifier is released before the pointer moves past the threshold.
    events.emit('pointermove', { pointerId: 1, clientX: 113, clientY: 100 });
    expect(onMove).toHaveBeenLastCalledWith('one', { x: 13, y: 0 });
  });

  it('keeps the resize bypass engaged when the press carried the modifier', () => {
    const events = pointerPort();
    const onResize = vi.fn();
    beginStageResize({
      stageId: 'one', start: { ...start, altKey: true }, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port, snap,
      onResize, onCommit: vi.fn(), onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 113, clientY: 100 });
    expect(onResize).toHaveBeenLastCalledWith('one', { width: 313, height: 200 });
  });

  it('ignores the lattice for a resize that uses the bypass modifier', () => {
    const events = pointerPort();
    const onCommit = vi.fn();
    beginStageResize({
      stageId: 'one', start, origin: { width: 300, height: 200 }, authored: { width: 300, height: 200 }, zoom: () => 1, events: events.port, snap,
      onResize: vi.fn(), onCommit, onCancel: vi.fn(),
    });
    events.emit('pointermove', { pointerId: 1, clientX: 150, clientY: 130, altKey: true });
    events.emit('pointerup', { pointerId: 1, clientX: 150, clientY: 130 });
    expect(onCommit).toHaveBeenCalledWith('one', { width: 350, height: 230 });
  });
});

describe('viewport policy', () => {
  it('stops at the zoom bounds', () => {
    expect(clampZoom(99)).toBe(FLOW_ZOOM.max);
    expect(clampZoom(0.0001)).toBe(FLOW_ZOOM.min);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(nextZoom(FLOW_ZOOM.max, 'in')).toBe(FLOW_ZOOM.max);
    expect(nextZoom(FLOW_ZOOM.min, 'out')).toBe(FLOW_ZOOM.min);
  });

  it('keeps the anchored point over the same diagram point', () => {
    const before = { x: 10, y: 20, zoom: 1 };
    const view = zoomAroundPoint(before, { x: 110, y: 220 }, 2);
    expect(view.zoom).toBe(2);
    expect((110 - view.x) / view.zoom).toBeCloseTo((110 - before.x) / before.zoom, 5);
    expect((220 - view.y) / view.zoom).toBeCloseTo((220 - before.y) / before.zoom, 5);
  });
});
