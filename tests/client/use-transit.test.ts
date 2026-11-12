// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task, Workflow } from '../../src/shared/types.js';
import { buildWorkflowScene } from '../../src/domain/diagram/scene.js';
import { useTransit, type TransitInput } from '../../src/client/workflow-view/use/use-transit.js';
import { transitions } from '../support/transition-rules.js';

function task(id: string, columnId: string): Task {
  return {
    id, projectId: 'project', title: 'Task ' + id, description: '', columnId, position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'one',
  columns: [
    { id: 'one', name: 'One', allowedTransitions: transitions('two') },
    { id: 'two', name: 'Two', allowedTransitions: transitions('three') },
    { id: 'three', name: 'Three', allowedTransitions: [] },
    // A stage no connection reaches, used for a movement without a drawn arrow.
    { id: 'four', name: 'Four', allowedTransitions: [] },
  ],
  groups: [],
};

const placements = new Map([['one', { x: 0, y: 0 }], ['two', { x: 400, y: 0 }], ['three', { x: 800, y: 0 }], ['four', { x: 0, y: 400 }]]);
const scene = buildWorkflowScene({ workflow, tasks: [], placements });

function input(tasks: readonly Task[], overrides: Partial<TransitInput> = {}): TransitInput {
  return { tasks, scene, resetKey: 'board-1', reducedMotion: false, supported: true, ...overrides };
}

describe('transit after a stage change', () => {
  it('presents one transit per movement', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')]) });
    act(() => { rerender(input([task('a', 'two')])); });
    expect(result.current.transits).toHaveLength(1);
    expect(result.current.transits[0]!.key).toBe('a:one->two');
  });

  it('presents one transit for a movement the view reports twice', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')]) });
    act(() => { rerender(input([task('a', 'two')])); });
    act(() => { rerender(input([task('a', 'two')])); });
    act(() => { rerender(input([task('a', 'two'), task('b', 'one')])); });
    expect(result.current.transits).toHaveLength(1);
  });

  it('keeps a running transit when the presented cards change for another reason', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one'), task('b', 'one')]) });
    act(() => { rerender(input([task('a', 'two'), task('b', 'one')])); });
    expect(result.current.transits).toHaveLength(1);
    act(() => { rerender(input([task('b', 'one'), task('a', 'two')])); });
    expect(result.current.transits).toHaveLength(1);
  });

  it('reports the arrival, with no transit, between two stages the diagram does not connect', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'three')], { onArrive })); });
    expect(result.current.transits).toEqual([]);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledWith('a');
  });

  it('reports the arrival of a flying transit once it lands', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'two')], { onArrive })); });
    expect(onArrive).not.toHaveBeenCalled();
    act(() => { for (const transit of result.current.transits) result.current.arrive(transit); });
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledWith('a');
  });

  it('reports no arrival when the host settles the whole arrangement', () => {
    const onArrive = vi.fn();
    const { rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive, reducedMotion: true }) });
    act(() => { rerender(input([task('a', 'three')], { onArrive, reducedMotion: true })); });
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('presents nothing when the host asks for reduced motion', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { reducedMotion: true }) });
    act(() => { rerender(input([task('a', 'two')], { reducedMotion: true })); });
    expect(result.current.transits).toEqual([]);
  });

  it('presents nothing when the host cannot animate along a path', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { supported: false }) });
    act(() => { rerender(input([task('a', 'two')], { supported: false })); });
    expect(result.current.transits).toEqual([]);
  });

  it('invalidates a superseded flight when the card moves again without a connection', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'two')], { onArrive })); });
    const flight = result.current.transits;
    expect(flight).toHaveLength(1);
    act(() => { rerender(input([task('a', 'four')], { onArrive })); });
    expect(result.current.transits).toEqual([]);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledWith('a');
    // The superseded flight's late completion cannot pulse the card a second time.
    act(() => { for (const transit of flight) result.current.arrive(transit); });
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it('invalidates the flight when a move rolls back to its source stage', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'two')], { onArrive })); });
    const flight = result.current.transits;
    expect(flight).toHaveLength(1);
    // The optimistic move failed and the card returned to its source stage.
    act(() => { rerender(input([task('a', 'one')], { onArrive })); });
    expect(result.current.transits).toEqual([]);
    // One arrival for the return, and the superseded flight never pulses again.
    expect(onArrive).toHaveBeenCalledTimes(1);
    act(() => { for (const transit of flight) result.current.arrive(transit); });
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it('does not pulse for a card the diagram no longer presents, and clears its flight', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one'), task('b', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'two'), task('b', 'one')], { onArrive })); });
    const flight = result.current.transits[0]!;
    act(() => { rerender(input([task('b', 'one')], { onArrive })); });
    act(() => { result.current.arrive(flight); });
    expect(onArrive).not.toHaveBeenCalled();
    expect(result.current.transits).toEqual([]);
  });

  it('clears a running flight when the host starts asking for reduced motion', () => {
    const onArrive = vi.fn();
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')], { onArrive }) });
    act(() => { rerender(input([task('a', 'two')], { onArrive })); });
    expect(result.current.transits).toHaveLength(1);
    act(() => { rerender(input([task('a', 'two')], { onArrive, reducedMotion: true })); });
    expect(result.current.transits).toEqual([]);
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('settles a mixed batch above the cap without a flight or a pulse', () => {
    const onArrive = vi.fn();
    const start = Array.from({ length: 9 }, (_value, index) => task('t' + index, 'one'));
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input(start, { onArrive }) });
    const moved = Array.from({ length: 8 }, (_value, index) => task('t' + index, 'two'));
    moved.push(task('t8', 'three'));
    act(() => { rerender(input(moved, { onArrive })); });
    expect(result.current.transits).toEqual([]);
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('settles when the presented view is replaced', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')]) });
    act(() => { rerender(input([task('a', 'one')])); });
    act(() => { rerender(input([task('a', 'two')], { resetKey: 'board-2' })); });
    expect(result.current.transits).toEqual([]);
  });

  it('drops a transit once it arrives, and the next movement presents a new one', () => {
    const { result, rerender } = renderHook((props: TransitInput) => useTransit(props), { initialProps: input([task('a', 'one')]) });
    act(() => { rerender(input([task('a', 'two')])); });
    const transits = result.current.transits;
    act(() => { for (const transit of transits) result.current.arrive(transit); });
    expect(result.current.transits).toEqual([]);
    act(() => { rerender(input([task('a', 'three')])); });
    expect(result.current.transits.map(value => value.key)).toEqual(['a:two->three']);
  });
});
