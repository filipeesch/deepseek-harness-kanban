// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TaskCard, cardStatusEntries, type TaskCardProps } from '../../src/client/task-card.js';
import { AutoRunController } from '../../src/client/auto-run.js';
import { EMPTY_ATTENTION, type Attention, type Column, type ContextOperation, type Task } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

beforeEach(() => { if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const column: Column = { id: 'intake', name: 'Intake' };
const baseTask: Task = { ...fixture().state.tasks[0]!, title: 'Alpha task', columnId: 'intake', operation: null, pendingTransition: undefined };
const failedOperation: ContextOperation = { id: 'op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: null }, phase: 'failed', targetPath: '/tree', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' };
const attentionWith = (overrides: Partial<Attention> = {}): Attention => ({ ...EMPTY_ATTENTION, ...overrides });

function setup(overrides: Partial<TaskCardProps> = {}) {
  const onOpen = vi.fn();
  const onToggleSelect = vi.fn();
  const onBeginDrag = vi.fn();
  const shouldSuppressClick = vi.fn(() => false);
  const props: TaskCardProps = {
    task: baseTask, column, projectName: 'API', attention: EMPTY_ATTENTION, selectionMode: false, selected: false,
    autoRun: new AutoRunController({ run: async () => fixture() }), onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick,
    ...overrides,
  };
  const view = render(<TaskCard {...props} />);
  const card = document.querySelector('.kb-card') as HTMLElement;
  return { ...view, card, onOpen, onToggleSelect, onBeginDrag, shouldSuppressClick, props };
}

describe('task card regions', () => {
  it('renders title, context, and activity in order with one owner per fact', () => {
    const { card } = setup({ attention: attentionWith({ running: true, background: [{ kind: 'job', label: 'Run tests' }], unread: true, awaitingReply: true, failed: true }) });
    const title = card.querySelector('.kb-card-open')!;
    const context = card.querySelector('.kb-card-context')!;
    const activity = card.querySelector('.kb-card-activity')!;
    expect(title.querySelector('strong')?.textContent).toBe('Alpha task');
    expect(card.children[0]).toBe(title);
    expect(card.children[1]).toBe(context);
    expect(card.children[2]).toBe(activity);
    expect(within(context as HTMLElement).getByText('API')).toBeTruthy();
    expect(within(context as HTMLElement).getAllByRole('img')).toHaveLength(3);
    expect(within(context as HTMLElement).queryByText('Working')).toBeNull();
    expect(within(activity as HTMLElement).getByText('Working')).toBeTruthy();
    expect(within(activity as HTMLElement).queryByText('API')).toBeNull();
    expect(card.querySelector('.kb-card-status')).toBeNull();
  });

  it('places the status region after the activity region', () => {
    const { card } = setup({ task: { ...baseTask, operation: failedOperation } });
    expect(card.children[2]?.className).toContain('kb-card-activity');
    expect(card.children[3]?.className).toContain('kb-card-status');
  });

  it('keeps the complete long title in the open button and its accessible name', () => {
    const title = 'A title long enough to wrap over several lines in a narrow card';
    const { card } = setup({ task: { ...baseTask, title } });
    expect(card.querySelector('.kb-card-open strong')?.textContent).toBe(title);
    expect(screen.getByRole('button', { name: 'Open task ' + title })).toBeTruthy();
  });

  it('keeps the complete project name in the context label', () => {
    setup({ projectName: 'A very long project name that will not fit the card' });
    const project = document.querySelector('.kb-card-project') as HTMLElement;
    expect(project.getAttribute('title')).toBe('A very long project name that will not fit the card');
    expect(project.textContent).toBe('A very long project name that will not fit the card');
  });

  it('marks only the card root as working', () => {
    const { card } = setup({ attention: attentionWith({ running: true }) });
    expect(card.getAttribute('data-working')).toBe('true');
    expect(card.querySelector('.kb-card-open')?.getAttribute('data-working')).toBeNull();
  });
});

describe('task card activity region', () => {
  it('labels a single background family and keeps the chip outside the open button', () => {
    const { card } = setup({ attention: attentionWith({ background: [{ kind: 'job', label: 'Run tests' }] }) });
    const chip = within(card).getByRole('note');
    expect(chip.textContent).toBe('1 job');
    expect(chip.getAttribute('aria-label')).toBe('Background activity: 1 job. Run tests');
    expect(chip.getAttribute('title')).toBe('Run tests');
    expect(chip.getAttribute('tabindex')).toBe('0');
    expect(chip.closest('button')).toBeNull();
    expect(card.querySelector('.kb-card-activity')?.contains(chip)).toBe(true);
  });

  it('aggregates mixed background families in one line', () => {
    const { card } = setup({ attention: attentionWith({ background: [{ kind: 'job', label: 'Run tests' }, { kind: 'subagent', label: 'Research' }] }) });
    const chip = within(card).getByRole('note');
    expect(chip.textContent).toBe('2 activities');
    expect(chip.getAttribute('aria-label')).toBe('Background activity: 2 activities. Run tests · Research');
    expect(chip.textContent).not.toContain('job');
    expect(chip.textContent).not.toContain('subagent');
  });

  it('keeps one persistent working announcement across updates', () => {
    const { rerender, props } = setup();
    const idle = document.querySelector('[role="status"]') as HTMLElement;
    expect(idle.textContent).toBe('');
    rerender(<TaskCard {...props} attention={attentionWith({ running: true })} />);
    const running = document.querySelector('[role="status"]') as HTMLElement;
    expect(running).toBe(idle);
    expect(running.textContent).toBe('Working on Alpha task');
    rerender(<TaskCard {...props} attention={attentionWith({ running: true })} />);
    expect(document.querySelector('[role="status"]')).toBe(idle);
    expect(idle.textContent).toBe('Working on Alpha task');
  });
});

describe('task card status strip', () => {
  it('shows a failure-toned operation status', () => {
    const { card } = setup({ task: { ...baseTask, operation: failedOperation } });
    const line = card.querySelector('.kb-card-status-line')!;
    expect(line.textContent).toBe('Operation failed');
    expect(line.className).toContain('is-danger');
    expect(line.querySelector('svg')).toBeTruthy();
  });

  it('shows a pending-toned transition status', () => {
    const { card } = setup({ task: { ...baseTask, pendingTransition: { id: 'p', fromColumnId: 'intake', columnId: 'doing', mode: 'move', status: 'waiting' } } });
    const line = card.querySelector('.kb-card-status-line')!;
    expect(line.textContent).toBe('Confirmed action: waiting');
    expect(line.className).toContain('is-pending');
  });

  it('presents both statuses together', () => {
    const { card } = setup({ task: { ...baseTask, operation: failedOperation, pendingTransition: { id: 'p', fromColumnId: 'intake', columnId: 'doing', mode: 'move', status: 'sending' } } });
    expect(card.querySelectorAll('.kb-card-status-line')).toHaveLength(2);
  });

  it('clears a resolved status', () => {
    const { rerender, props } = setup({ task: { ...baseTask, operation: failedOperation } });
    expect(document.querySelector('.kb-card-status-line')).toBeTruthy();
    rerender(<TaskCard {...props} task={baseTask} />);
    expect(document.querySelector('.kb-card-status')).toBeNull();
  });

  it('reports a run-action admission failure in the status region', async () => {
    const autoRun = new AutoRunController({ run: async () => { throw { code: 'SEND_FAILED', message: 'The instruction could not be sent.' }; } });
    await autoRun.runNow({ taskId: 't1', columnId: 'intake', enteredAt: 7, instruction: 'Review carefully.' });
    const { card } = setup({ autoRun });
    const status = card.querySelector('.kb-card-status') as HTMLElement;
    expect(status).toBeTruthy();
    const alert = within(status).getByRole('alert');
    expect(alert.textContent).toBe('The instruction could not be sent.');
    expect(alert.className).toContain('is-danger');
  });

  it('derives the run failure as an alert entry', () => {
    expect(cardStatusEntries(baseTask, 'The instruction could not be sent.')).toEqual([
      { key: 'instruction', tone: 'danger', label: 'The instruction could not be sent.', alert: true },
    ]);
    expect(cardStatusEntries(baseTask)).toEqual([]);
  });
});

describe('task card interaction surface', () => {
  it('opens the drawer from the title button', () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('activates the card from the context row and the background chip', () => {
    const { onOpen } = setup({ attention: attentionWith({ background: [{ kind: 'job', label: 'Run tests' }] }) });
    fireEvent.click(document.querySelector('.kb-card-context')!);
    expect(onOpen).toHaveBeenCalledWith('t1');
    fireEvent.click(document.querySelector('.kb-background')!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('activates the card from the background chip by keyboard', () => {
    const { onOpen } = setup({ attention: attentionWith({ background: [{ kind: 'job', label: 'Run tests' }] }) });
    const chip = document.querySelector('.kb-background')!;
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('t1');
    fireEvent.keyDown(chip, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('toggles selection from the card in selection mode', () => {
    const { onToggleSelect } = setup({ selectionMode: true });
    const card = document.querySelector('.kb-card') as HTMLElement;
    const checkbox = within(card).getByRole('checkbox', { name: 'Select Alpha task' });
    expect(card.querySelector('.kb-card-context')?.firstElementChild).toBe(checkbox);
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith('t1');
    fireEvent.click(within(card).getByRole('button', { name: 'Select task Alpha task' }));
    expect(onToggleSelect).toHaveBeenCalledTimes(2);
  });

  it('starts a drag from card surface but not from the activity controls', () => {
    const { card, onBeginDrag } = setup({ attention: attentionWith({ background: [{ kind: 'job', label: 'Run tests' }] }) });
    fireEvent.pointerDown(card.querySelector('.kb-card-project')!, { button: 0 });
    expect(onBeginDrag).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(card.querySelector('.kb-background')!, { button: 0 });
    expect(onBeginDrag).toHaveBeenCalledTimes(1);
  });

  it('suppresses opening after a drag', () => {
    const { onOpen } = setup({ shouldSuppressClick: () => true });
    fireEvent.click(document.querySelector('.kb-card-open')!);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
