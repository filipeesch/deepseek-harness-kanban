// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardView } from '../../src/client/board.js';
import { AutoRunController } from '../../src/client/auto-run.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { deferred, fakeApi, fixture, fixtureWithPlan } from './helpers.js';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => { if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent }); });

const native = (id: string) => <span>Native {id}</span>;
const drawer = () => document.querySelector('.kb-drawer') as HTMLElement;
const countdown = () => document.querySelector('.kb-card-countdown') as HTMLButtonElement | null;

async function settle(iterations = 30) {
  await act(async () => { for (let index = 0; index < iterations; index += 1) await Promise.resolve(); });
}
async function mount(initial = fixture()) {
  const mock = fakeApi(initial);
  const view = render(<BoardView api={mock.api} renderConversation={native} />);
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  return { ...mock, view };
}
async function openAlpha() {
  fireEvent.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
  await settle();
}
async function moveTo(column: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: column } });
  await settle();
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle();
}
function runCalls(mock: ReturnType<typeof fakeApi>) {
  return mock.command.mock.calls.map(([command]) => command).filter(command => command.type === 'task.runInstruction');
}

describe('instructed move auto-run', () => {
  it('arms the drawer notice and card countdown after a move and sends on expiry', async () => {
    const mock = await mount(); await openAlpha();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Info' })); }); await settle();
    vi.useFakeTimers();
    await moveTo('review');
    const marker = mock.get().state.tasks[0]!.instructionPending!;
    expect(screen.getByRole('tab', { name: 'Info' }).getAttribute('aria-selected')).toBe('true');
    expect(within(drawer()).getByText('Sending the Review instruction to Agent 1 in 5s.')).toBeTruthy();
    expect(countdown()?.textContent).toContain('5s');
    await advance(5000);
    expect(runCalls(mock)).toEqual([{ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Review **carefully**.' }]);
    expect(mock.get().state.tasks[0]!.instructionPending).toBeUndefined();
    expect(countdown()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run Review instruction' })).toBeNull();
  });

  it('cancels from the card and restores the play action', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    await act(async () => { fireEvent.click(countdown()!); }); await settle();
    expect(countdown()).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
    expect(mock.get().state.tasks[0]!.instructionPending).toBeDefined();
  });

  it('cancels from the drawer and keeps the current section', async () => {
    const mock = await mount(); await openAlpha();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Info' })); }); await settle();
    vi.useFakeTimers(); await moveTo('review');
    await act(async () => { fireEvent.click(within(drawer()).getByRole('button', { name: 'Cancel automatic Review instruction' })); }); await settle();
    expect(screen.getByRole('tab', { name: 'Info' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('cancels the countdown when a manual prompt resolves the marker', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const next = mock.get(); delete next.state.tasks[0]!.instructionPending; next.sequence += 1;
    await act(async () => { mock.publish(next); }); await settle();
    expect(countdown()).toBeNull();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('replaces the countdown with a newer instructed entry', async () => {
    const mock = await mount(fixtureWithPlan()); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    await moveTo('plan');
    const marker = mock.get().state.tasks[0]!.instructionPending!;
    await advance(5000);
    expect(runCalls(mock)).toEqual([{ type: 'task.runInstruction', taskId: 't1', columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan this task.' }]);
  });

  it('keeps running when the card is filtered out', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    await act(async () => { fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'no matching task' } }); }); await settle();
    expect(countdown()).toBeNull();
    await advance(5000);
    expect(runCalls(mock)).toHaveLength(1);
  });

  it('does not resume a countdown after unmount and remount', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const withMarker = mock.get();
    mock.view.unmount();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
    render(<BoardView api={mock.api} renderConversation={native} />);
    await settle(50);
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    expect(withMarker.state.tasks[0]!.instructionPending).toBeDefined();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('reports a failed timed send on both surfaces and restores the play action', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    mock.command.mockRejectedValueOnce({ code: 'SEND_FAILED', message: 'The instruction could not be sent.' });
    await advance(5000);
    const failedCard = screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card') as HTMLElement;
    const failedStatus = failedCard.querySelector('.kb-card-status') as HTMLElement;
    expect(within(failedStatus).getByRole('alert').textContent).toBe('The instruction could not be sent.');
    expect(within(drawer()).getByText('Automatic Review instruction failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    expect(runCalls(mock)).toHaveLength(1);
  });

  it('reports a changed instruction on both surfaces after the countdown and restores the action', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const changed = mock.get();
    changed.state.workflow.columns.find(column => column.id === 'review')!.onEnterPrompt = 'Replacement instruction.';
    changed.sequence += 1;
    await act(async () => { mock.publish(changed); }); await settle();
    expect(countdown()).not.toBeNull();
    await advance(5000);
    const changedCard = screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card') as HTMLElement;
    const changedStatus = changedCard.querySelector('.kb-card-status') as HTMLElement;
    expect(within(changedStatus).getByRole('alert').textContent).toBe('The workflow instruction changed. Review the current instruction before running.');
    expect(within(drawer()).getByText('Automatic Review instruction failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    expect(runCalls(mock)).toHaveLength(1);
  });

  it('reports a removed instruction on the card and in the drawer', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const removed = mock.get();
    delete removed.state.workflow.columns.find(column => column.id === 'review')!.onEnterPrompt;
    removed.sequence += 1;
    await act(async () => { mock.publish(removed); }); await settle();
    await advance(5000);
    const card = screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card') as HTMLElement;
    expect(within(card.querySelector('.kb-card-status') as HTMLElement).getByRole('alert').textContent).toContain('The workflow instruction changed.');
    expect(within(drawer()).getByRole('alert').textContent).toContain('The workflow instruction changed.');
    expect(screen.queryByRole('button', { name: 'Run Review instruction' })).toBeNull();
  });

  it('treats an already-resolved rejection as a silent end', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    mock.command.mockRejectedValueOnce({ code: 'INSTRUCTION_ALREADY_RESOLVED', message: 'Already resolved.' });
    await advance(5000);
    expect(screen.queryByText('Already resolved.')).toBeNull();
    expect(screen.queryByText('Automatic Review instruction failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
  });

  it('does not arm a countdown from a persisted entry alone', async () => {
    const initial = fixture();
    initial.state.tasks[0]!.columnId = 'review';
    initial.state.tasks[0]!.instructionPending = { columnId: 'review', enteredAt: 7 };
    const mock = await mount(initial); vi.useFakeTimers();
    expect(countdown()).toBeNull();
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('does not arm or reset countdown on a same-stage reorder', async () => {
    const initial = fixture();
    initial.state.tasks[0]!.columnId = 'review';
    initial.state.tasks[0]!.instructionPending = { columnId: 'review', enteredAt: 7 };
    const mock = await mount(initial); vi.useFakeTimers();
    const review = screen.getByRole('region', { name: 'Review column' });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => review });
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 20, pointerId: 1 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    await settle();
    expect(countdown()).toBeNull();
    expect(mock.get().state.tasks[0]!.instructionPending).toEqual({ columnId: 'review', enteredAt: 7 });
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('keeps an active countdown deadline when the card is reordered within its stage', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    await advance(3000);
    const review = screen.getByRole('region', { name: 'Review column' });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => review });
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 20, pointerId: 1 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    await settle();
    expect(mock.command.mock.calls.filter(([command]) => command.type === 'task.move')).toHaveLength(2);
    expect(countdown()).not.toBeNull();
    await advance(2000);
    expect(runCalls(mock)).toHaveLength(1);
  });

  it('does not arm a countdown for a task created in an instructed initial stage', async () => {
    const initial = fixture();
    initial.state.workflow.initialColumnId = 'review';
    const mock = await mount(initial);
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Created in review' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await settle(50);
    expect(screen.getByRole('button', { name: 'Run Review instruction' })).toBeTruthy();
    vi.useFakeTimers();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('arms from a board drop into an instructed stage', async () => {
    const mock = await mount(); vi.useFakeTimers();
    const review = screen.getByRole('region', { name: 'Review column' });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => review });
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 20, pointerId: 1 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    await settle();
    expect(mock.command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' });
    const marker = mock.get().state.tasks[0]!.instructionPending!;
    expect(countdown()).not.toBeNull();
    await advance(5000);
    expect(runCalls(mock)).toEqual([{ type: 'task.runInstruction', taskId: 't1', columnId: 'review', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Review **carefully**.' }]);
  });

  it('does not arm when the destination is uninstructed', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('doing');
    expect(countdown()).toBeNull();
    await advance(5000);
    expect(runCalls(mock)).toEqual([]);
  });

  it('keeps a stable focused control when the countdown is canceled', async () => {
    await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const control = countdown()!;
    control.focus();
    expect(document.activeElement).toBe(control);
    fireEvent.click(control);
    await settle();
    const play = screen.getByRole('button', { name: 'Run Review instruction' });
    expect(document.activeElement).toBe(play);
  });

  it('shows the sending state while the timed admission is in flight', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const pending = deferred<KanbanSnapshot>();
    mock.command.mockReturnValueOnce(pending.promise);
    await advance(5000);
    expect(screen.getByRole('button', { name: 'Sending Review instruction' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel automatic Review instruction' })).toBeNull();
    pending.resolve(fixture());
    await settle();
    expect(screen.queryByRole('button', { name: 'Sending Review instruction' })).toBeNull();
  });

  it('names a new conversation target and announces the armed window', async () => {
    const initial = fixture();
    initial.state.tasks[0]!.closedSessionIds = ['s1', 's2'];
    await mount(initial); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    expect(within(drawer()).getByText('Sending the Review instruction to a new conversation in 5s.')).toBeTruthy();
    expect(within(drawer()).getByRole('status').textContent).toBe('Automatic Review instruction armed.');
  });

  it('reports a host busy rejection after the entry was armed', async () => {
    const mock = await mount(); await openAlpha(); vi.useFakeTimers(); await moveTo('review');
    const busy = mock.get();
    busy.state.tasks[0]!.pendingTransition = { id: 'pending', fromColumnId: 'review', columnId: 'review', mode: 'move', status: 'waiting' };
    busy.sequence += 1;
    await act(async () => { mock.publish(busy); }); await settle();
    await advance(5000);
    const card = screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card') as HTMLElement;
    expect(within(card.querySelector('.kb-card-status') as HTMLElement).getByRole('alert').textContent).toContain('Resolve the confirmed transition first.');
    expect(within(drawer()).getByRole('alert').textContent).toContain('Resolve the confirmed transition first.');
  });

  it('keeps independent countdowns for two tasks and sends only the uncanceled one', async () => {
    const mock = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open task Alpha task' })); await settle();
    vi.useFakeTimers();
    await moveTo('review');
    fireEvent.click(screen.getByRole('button', { name: 'Open task Beta task' })); await settle();
    await moveTo('review');
    const tasks = mock.get().state.tasks;
    const alpha = tasks.find(task => task.id === 't1')!.instructionPending!;
    const beta = tasks.find(task => task.id === 't2')!.instructionPending!;
    expect(document.querySelectorAll('.kb-card-countdown')).toHaveLength(2);
    const alphaCard = screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card') as HTMLElement;
    fireEvent.click(within(alphaCard).getByRole('button', { name: 'Cancel automatic Review instruction' }));
    await settle();
    await advance(5000);
    expect(runCalls(mock)).toEqual([{ type: 'task.runInstruction', taskId: 't2', columnId: 'review', expectedEnteredAt: beta.enteredAt, expectedInstruction: 'Review **carefully**.' }]);
    expect(alpha.enteredAt).not.toBe(beta.enteredAt);
  });

  it('does not let a board unmount dispose a controller owned above it', async () => {
    const run = vi.fn(async () => fixture());
    const controller = new AutoRunController({ run });
    const mock = fakeApi();
    const view = render(<BoardView api={mock.api} autoRun={controller} renderConversation={native} />);
    await settle(50);
    vi.useFakeTimers();
    view.unmount();
    controller.arm({ taskId: 't1', columnId: 'review', enteredAt: 7, instruction: 'Review **carefully**.' });
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
