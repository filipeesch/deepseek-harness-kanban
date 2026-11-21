// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DecisionDock } from '../../src/client/decision-dock.js';
import { DecisionPanel } from '../../src/client/decision-panel.js';
import { DecisionWindowController } from '../../src/client/decision-window.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** The fixture board with one gate stage, and its first task parked in it. */
function gated(sessionIds: string[] = ['s1']): TestSnapshot {
  const snapshot = fixture();
  const board = snapshot.state.hubs[0]!.boards[0]!;
  board.workflow.columns.push({ id: 'gate', name: 'Gate', decision: {
    question: 'How should this proceed?',
    context: 'The review left findings.',
    options: [
      { id: 'ship', title: 'Ship it', description: 'Send it to done.', to: 'review' },
      { id: 'fix', title: 'Fix it', to: 'intake' },
    ],
  } });
  const task = snapshot.state.hubs[0]!.tasks.find(value => value.id === 't1')!;
  task.columnId = 'gate';
  task.sessionIds = sessionIds;
  task.stageEntry = { id: 'entry-gate', columnId: 'gate', stageIdentity: 'gate', enteredAt: '2026-01-01T00:00:00.000Z' };
  return snapshot;
}

function setup(sessionId: string, snapshot: TestSnapshot = gated()) {
  const controller = new DecisionWindowController({ run: async () => snapshot });
  const fake = fakeApi(snapshot);
  const view = render(<DecisionDock sessionId={sessionId} api={fake.api} controller={controller} />);
  return { ...view, controller, fake };
}

describe('decision dock', () => {
  it('presents the task gate above a conversation of that task', async () => {
    setup('s1');
    expect(await screen.findByRole('heading', { name: 'How should this proceed?' })).toBeTruthy();
    expect(screen.getByText('The review left findings.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Ship it' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('presents exactly one gate for the conversation', async () => {
    const { container } = setup('s1');
    await screen.findByRole('heading', { name: 'How should this proceed?' });
    expect(container.querySelectorAll('.kb-decision')).toHaveLength(1);
  });

  it('arms the one shared window, so every surface reads the same choice', async () => {
    const { controller } = setup('s1');
    fireEvent.click(await screen.findByRole('radio', { name: 'Ship it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor('t1')).toMatchObject({ taskId: 't1', entryId: 'entry-gate', optionId: 'ship', destinationName: 'Review', status: 'counting' });
    expect(screen.getByText(/Moving to Review in \d+ seconds/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(controller.entryFor('t1')).toBeUndefined();
  });

  it('shows the answer one conversation confirmed in another conversation of the task', async () => {
    const snapshot = gated(['s1', 's2']);
    const controller = new DecisionWindowController({ run: async () => snapshot });
    const fake = fakeApi(snapshot);
    render(<>
      <DecisionDock sessionId="s1" api={fake.api} controller={controller} />
      <DecisionDock sessionId="s2" api={fake.api} controller={controller} />
    </>);
    const strips = await screen.findAllByRole('form');
    expect(strips).toHaveLength(2);
    const first = within(strips[0]!);
    fireEvent.click(first.getByRole('radio', { name: 'Fix it' }));
    first.getByRole('textbox', { name: 'Observation' });
    fireEvent.change(first.getByRole('textbox', { name: 'Observation' }), { target: { value: 'Please fix the copy.' } });
    fireEvent.click(first.getByRole('button', { name: 'Confirm choice' }));
    // The second conversation adopts the option and the observation the one window holds.
    const second = within(strips[1]!);
    expect((second.getByRole('radio', { name: 'Fix it' }) as HTMLInputElement).checked).toBe(true);
    expect((second.getByRole('textbox', { name: 'Observation' }) as HTMLTextAreaElement).value).toBe('Please fix the copy.');
    expect(second.getByText(/Moving to Intake in \d+ seconds/)).toBeTruthy();
  });

  it('submits the task choice once, after exactly five seconds, from two docked surfaces', async () => {
    const snapshot = gated(['s1', 's2']);
    const run = vi.fn(async (_command: unknown) => snapshot);
    const fake = fakeApi(snapshot);
    // The window is the real five-second timer, driven by the fake clock.
    vi.useFakeTimers();
    const controller = new DecisionWindowController({ run });
    render(<>
      <DecisionDock sessionId="s1" api={fake.api} controller={controller} />
      <DecisionDock sessionId="s2" api={fake.api} controller={controller} />
    </>);
    // The dock read its snapshot inside an effect, so settle that before driving the window.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const strips = screen.getAllByRole('form');
    expect(strips).toHaveLength(2);
    const first = within(strips[0]!);
    const second = within(strips[1]!);

    fireEvent.click(first.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(first.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor('t1')?.status).toBe('counting');
    // Cancelling from the other conversation leaves nothing to submit.
    fireEvent.click(second.getByRole('button', { name: 'Cancel' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(run).not.toHaveBeenCalled();
    expect(controller.entryFor('t1')).toBeUndefined();

    fireEvent.click(first.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(first.getByRole('button', { name: 'Confirm choice' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ type: 'task.decide', taskId: 't1', optionId: 'ship' });
  });

  it('presents nothing above a conversation that belongs to no task', async () => {
    const { container, fake } = setup('s-ordinary-chat');
    // Wait for the snapshot the dock read, so the empty render is the resolved one.
    await waitFor(() => expect(fake.api.snapshot).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });

  it('presents nothing for a task outside a decision stage', async () => {
    const snapshot = fixture();
    const { container, fake } = setup('s1', snapshot);
    await waitFor(() => expect(fake.api.snapshot).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });

  it('stops presenting the gate when the task leaves the stage', async () => {
    const { fake } = setup('s1');
    await screen.findByRole('heading', { name: 'How should this proceed?' });
    fake.publish(fixture());
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'How should this proceed?' })).toBeNull());
  });
});

describe('decision draft', () => {
  it('shows the applied option in a second conversation when the same choice is retried', async () => {
    const snapshot = gated();
    const run = vi.fn(async (_command: unknown) => { throw new Error('The destination stage changed.'); });
    const controller = new DecisionWindowController({ run });
    const board = snapshot.state.hubs[0]!.boards[0]!;
    const gate = board.workflow.columns.find(value => value.id === 'gate')!;
    const task = snapshot.state.hubs[0]!.tasks.find(value => value.id === 't1')!;
    vi.useFakeTimers();
    render(<>
      <DecisionPanel task={task} column={gate} columns={board.workflow.columns} controller={controller} />
      <DecisionPanel task={task} column={gate} columns={board.workflow.columns} controller={controller} />
    </>);
    const strips = screen.getAllByRole('form');
    const first = within(strips[0]!);
    const second = within(strips[1]!);
    // Confirm A, let the window fail.
    fireEvent.click(first.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(first.getByRole('button', { name: 'Confirm choice' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(controller.entryFor('t1')?.status).toBe('failed');
    // The other conversation picks a different option.
    fireEvent.click(second.getByRole('radio', { name: 'Fix it' }));
    expect((second.getByRole('radio', { name: 'Fix it' }) as HTMLInputElement).checked).toBe(true);
    // Retrying the identical choice must show A in both conversations while it counts.
    fireEvent.click(first.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(first.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor('t1')?.status).toBe('counting');
    expect((second.getByRole('radio', { name: 'Ship it' }) as HTMLInputElement).checked).toBe(true);
    expect((second.getByRole('radio', { name: 'Fix it' }) as HTMLInputElement).checked).toBe(false);
    // The retry fails too: both conversations keep the attempt's choice beside its refusal.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(controller.entryFor('t1')?.status).toBe('failed');
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect((second.getByRole('radio', { name: 'Ship it' }) as HTMLInputElement).checked).toBe(true);
    expect((second.getByRole('radio', { name: 'Fix it' }) as HTMLInputElement).checked).toBe(false);
  });

  it('starts unanswered for a new stage entry whose options reuse the old identities', async () => {
    const snapshot = gated();
    const controller = new DecisionWindowController({ run: async () => snapshot });
    const board = snapshot.state.hubs[0]!.boards[0]!;
    const gate = board.workflow.columns.find(value => value.id === 'gate')!;
    const task = snapshot.state.hubs[0]!.tasks.find(value => value.id === 't1')!;
    const fake = fakeApi(snapshot);
    const view = render(<>
      <DecisionDock sessionId="s1" api={fake.api} controller={controller} />
      <DecisionPanel task={task} column={gate} columns={board.workflow.columns} controller={controller} />
    </>);
    // The dock hydrates from its snapshot in a microtask; wait for both strips.
    await waitFor(() => expect(screen.getAllByRole('form')).toHaveLength(2));
    const strips = screen.getAllByRole('form');
    // Select in the direct panel (the second strip), so the draft that resets is the panel's.
    const panel = within(strips[1]!);
    fireEvent.click(panel.getByRole('radio', { name: 'Ship it' }));
    expect((panel.getByRole('radio', { name: 'Ship it' }) as HTMLInputElement).checked).toBe(true);
    const moved = { ...task, stageEntry: { ...task.stageEntry!, id: 'entry-next', enteredAt: '2026-01-02T00:00:00.000Z' } };
    view.rerender(<>
      <DecisionDock sessionId="s1" api={fake.api} controller={controller} />
      <DecisionPanel task={moved} column={gate} columns={board.workflow.columns} controller={controller} />
    </>);
    // The same option identities, a new stage entry: the keyed draft starts empty.
    const after = screen.getAllByRole('form');
    expect(after).toHaveLength(2);
    const checked = screen.getAllByRole('radio').filter(radio => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(0);
  });
});