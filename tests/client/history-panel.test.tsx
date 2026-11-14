// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { HistoryPanel } from '../../src/client/history/history-panel.js';
import { BoardView } from '../../src/client/board.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);

const COLUMNS = [{ id: 'intake', name: 'Intake' }, { id: 'doing', name: 'Doing' }];
const CREATED = '2026-11-11T09:00:00.000Z';
const MOVED = '2026-11-11T10:00:00.000Z';

describe('the history panel', () => {
  it('presents one table row per recorded fact, newest first, with its four columns', () => {
    render(<HistoryPanel columns={COLUMNS} history={[
      { kind: 'created', at: CREATED, columnId: 'intake' },
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing' },
    ]} />);
    const table = screen.getByRole('table', { name: 'Task history' });
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['When', 'Event', 'Detail', 'In stage']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell')[1]!.textContent)).toEqual(['Stage changed', 'Created']);
    expect(within(rows[0]!).getAllByRole('cell')[2]!.textContent).toBe('Intake \u2192 Doing \u00b7 Move trigger not recorded');
    expect(within(rows[0]!).getAllByRole('cell')[0]!.querySelector('time')?.getAttribute('datetime')).toBe(MOVED);
  });

  it('reads each stage entry origin distinctly in its Detail cell', () => {
    render(<HistoryPanel columns={COLUMNS} history={[
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing', origin: 'manual' },
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing', origin: 'agent' },
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing', origin: 'auto' },
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing', origin: 'script:passed' },
      { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing', origin: 'error:error' },
    ]} />);
    const rows = within(screen.getByRole('table', { name: 'Task history' })).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell')[2]!.textContent)).toEqual([
      'Intake \u2192 Doing \u00b7 Moved by the reserved error route',
      'Intake \u2192 Doing \u00b7 Moved by script exit passed',
      'Intake \u2192 Doing \u00b7 Moved by an automatic advance',
      'Intake \u2192 Doing \u00b7 Moved by an agent-declared transition',
      'Intake \u2192 Doing \u00b7 Moved by an operator',
    ]);
  });

  it('refreshes the current stage duration while mounted and stops the refresh on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T10:05:00.000Z'));
    const view = render(<HistoryPanel columns={COLUMNS} history={[{ kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing' }]} />);
    const duration = () => screen.getByRole('table').querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[3]!.textContent;
    expect(duration()).toBe('5 min');
    act(() => { vi.setSystemTime(new Date('2026-11-11T10:19:00.000Z')); vi.advanceTimersByTime(60_000); });
    expect(duration()).toBe('20 min');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('states that nothing has been recorded yet instead of presenting an empty table', () => {
    render(<HistoryPanel columns={COLUMNS} history={undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Nothing has been recorded for this task yet.');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the History section in the task drawer', () => {
  it('is the last section and keeps the drawer open when selected', async () => {
    const data = fixture();
    const alpha = data.state.hubs[0]!.tasks.find(task => task.id === 't1')!;
    alpha.history = [{ kind: 'created', at: CREATED, columnId: 'intake' }, { kind: 'stage', at: MOVED, fromColumnId: 'intake', columnId: 'doing' }];
    const mock = fakeApi(data);
    const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    const sections = within(screen.getByRole('tablist', { name: 'Task sections' })).getAllByRole('tab');
    expect(sections.map(tab => tab.id.replace(/^.*-tab-/, ''))).toEqual(['Conversations', 'Info', 'Git', 'Notes', 'Relations', 'History']);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('heading', { name: 'Alpha task', level: 2 })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Task history' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('table', { name: 'Task history' })).toBeTruthy();
  });

  it('states that nothing has been recorded for a task without entries', async () => {
    const mock = fakeApi(fixture());
    const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => null} />);
    await screen.findByRole('button', { name: 'Open task Beta task' });
    await user.click(screen.getByRole('button', { name: 'Open task Beta task' }));
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(within(screen.getByRole('tabpanel')).getByRole('status').textContent).toBe('Nothing has been recorded for this task yet.');
  });
});
