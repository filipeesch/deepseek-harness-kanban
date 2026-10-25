// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView, createBoardPageState } from '../../src/client/board.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const renderNative = (id: string) => <div data-testid={'native-' + id}>Native session {id}</div>;

async function openAlpha(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
}

describe('original Markdown source', () => {
  it('preserves note indentation and trailing whitespace on creation and editing while rejecting blank notes', async () => {
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={renderNative} />);
    await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Notes' }));
    const original = '    const answer = 42;  ' + String.fromCharCode(10, 10);
    fireEvent.change(screen.getByRole('textbox', { name: 'New note Markdown' }), { target: { value: original } });
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(mock.command).toHaveBeenLastCalledWith({ type: 'note.save', taskId: 't1', content: original }));
    const created = mock.get().state.notes[0]!; expect(created.content).toBe(original);
    await user.click(screen.getByRole('button', { name: 'Edit note ' + created.id }));
    const replacement = String.fromCharCode(10) + '    preserveIndentation();  ' + String.fromCharCode(10, 10);
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note Markdown' }), { target: { value: replacement } });
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(mock.command).toHaveBeenLastCalledWith({ type: 'note.save', taskId: 't1', noteId: created.id, content: replacement }));
    expect(mock.get().state.notes[0]!.content).toBe(replacement);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New note Markdown' }), { target: { value: '   ' + String.fromCharCode(10) + '  ' } });
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.command).toHaveBeenCalledTimes(2);
  });
});

describe('plugin-owned page bookmarks', () => {
  it('creates independent preference objects with no native resources', () => {
    const first = createBoardPageState(); const second = createBoardPageState();
    expect(first).not.toBe(second); expect(first.drawers).not.toBe(second.drawers);
    expect(first).toEqual({ search: '', projectFilter: '', selectedTaskId: null, drawers: {} });
    expect(Object.getPrototypeOf(first.drawers)).toBeNull();
  });

  it('restores filters, selected task and selected conversation after page unmount without retaining hidden native views', async () => {
    const mock = fakeApi(); const pageState = createBoardPageState(); const user = userEvent.setup(); const mounted = new Set<string>(); const released: string[] = [];
    function Native({ id }: { id: string }) {
      useEffect(() => { mounted.add(id); return () => { mounted.delete(id); released.push(id); }; }, [id]);
      return <div data-testid={'retained-' + id}>Native session {id}</div>;
    }
    const native = (id: string) => <Native id={id} />;
    const first = render(<BoardView api={mock.api} pageState={pageState} renderConversation={native} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Alpha');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    await user.click(screen.getByRole('tab', { name: 'Agent 2' })); await screen.findByTestId('retained-s2');
    expect([...mounted]).toEqual(['s2']);
    first.unmount(); expect(mounted.size).toBe(0); expect(released).toContain('s2'); expect(mock.listeners.size).toBe(0);
    expect(pageState.search).toBe('Alpha'); expect(pageState.projectFilter).toBe('p1'); expect(pageState.selectedTaskId).toBe('t1'); expect(pageState.drawers.t1?.conversationId).toBe('s2');
    render(<BoardView api={mock.api} pageState={pageState} renderConversation={native} />);
    await screen.findByTestId('retained-s2');
    expect((screen.getByRole('searchbox', { name: 'Search tasks' }) as HTMLInputElement).value).toBe('Alpha');
    expect((screen.getByRole('combobox', { name: 'Project filter' }) as HTMLSelectElement).value).toBe('p1');
    expect(screen.getByRole('tab', { name: 'Agent 2' }).getAttribute('aria-selected')).toBe('true'); expect([...mounted]).toEqual(['s2']);
  });

  it('restores the drawer section and the last conversation when changing sections or remounting', async () => {
    const mock = fakeApi(); const pageState = createBoardPageState(); const user = userEvent.setup();
    const first = render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderNative} />);
    await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Agent 2' })); await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.queryByTestId('native-s2')).toBeNull(); first.unmount();
    render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderNative} />);
    await screen.findByRole('button', { name: 'Close task details' });
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true'); expect(screen.queryByTestId('native-s2')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Conversations' })); await screen.findByTestId('native-s2');
    expect(screen.getByRole('tab', { name: 'Agent 2' }).getAttribute('aria-selected')).toBe('true');
  });

  it('preserves search, project filter, and selected task across page remounts', async () => {
    const mock = fakeApi(); const pageState = createBoardPageState(); const user = userEvent.setup();
    const first = render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderNative} />);
    await screen.findByRole('button', { name: 'Open task Beta task' });
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Alpha'); await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' })); await user.click(screen.getByRole('tab', { name: 'Info' })); first.unmount();
    render(<BoardView api={mock.api} pageState={pageState} renderConversation={renderNative} />);
    await screen.findByRole('button', { name: 'Close task details' });
    expect(screen.getByRole('tab', { name: 'Info' }).getAttribute('aria-selected')).toBe('true');
    expect(pageState.search).toBe('Alpha'); expect(pageState.projectFilter).toBe('p1'); expect(pageState.selectedTaskId).toBe('t1');
  });
});

describe('physical reconnect epoch ordering', () => {
  it('accepts sequence zero in a newer epoch and rejects higher-sequence data from an older epoch', async () => {
    const initial = fixture(); initial.sequence = 7; initial.clientEpoch = 1; const mock = fakeApi(initial);
    render(<BoardView api={mock.api} renderConversation={renderNative} />); await screen.findByRole('button', { name: 'Open task Alpha task' });
    const fresh = fixture(); fresh.sequence = 0; fresh.clientEpoch = 2; fresh.state.tasks[0]!.title = 'New host generation'; act(() => { mock.publish(fresh); });
    await screen.findByRole('button', { name: 'Open task New host generation' });
    const stale = fixture(); stale.sequence = 999; stale.clientEpoch = 1; stale.state.tasks[0]!.title = 'Old host payload'; act(() => { mock.publish(stale); });
    expect(screen.queryByRole('button', { name: 'Open task Old host payload' })).toBeNull(); expect(screen.getByRole('button', { name: 'Open task New host generation' })).toBeTruthy();
    const olderSameEpoch = fixture(); olderSameEpoch.sequence = -1; olderSameEpoch.clientEpoch = 2; olderSameEpoch.state.tasks[0]!.title = 'Older same-epoch payload'; act(() => { mock.publish(olderSameEpoch); });
    expect(screen.queryByRole('button', { name: 'Open task Older same-epoch payload' })).toBeNull();
  });

  it('treats snapshots without an epoch as epoch zero', async () => {
    const initial = fixture(); initial.sequence = 7; const mock = fakeApi(initial); render(<BoardView api={mock.api} renderConversation={renderNative} />); await screen.findByRole('button', { name: 'Open task Alpha task' });
    const fresh = fixture(); fresh.clientEpoch = 1; fresh.sequence = 0; fresh.state.tasks[0]!.title = 'Epoch one'; act(() => { mock.publish(fresh); }); await screen.findByRole('button', { name: 'Open task Epoch one' });
    const stale = fixture(); stale.sequence = 100; stale.state.tasks[0]!.title = 'Untagged stale result'; act(() => { mock.publish(stale); });
    expect(screen.queryByRole('button', { name: 'Open task Untagged stale result' })).toBeNull(); expect(screen.getByRole('button', { name: 'Open task Epoch one' })).toBeTruthy();
  });

  it('rejects a late initial unary response from a prior epoch after receiving a new-generation event', async () => {
    const mock = fakeApi(); let resolve!: (snapshot: KanbanSnapshot) => void; vi.mocked(mock.api.snapshot).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<BoardView api={mock.api} renderConversation={renderNative} />);
    const fresh = fixture(); fresh.clientEpoch = 2; fresh.sequence = 0; fresh.state.tasks[0]!.title = 'Reconnect result'; act(() => { mock.publish(fresh); }); await screen.findByRole('button', { name: 'Open task Reconnect result' });
    const late = fixture(); late.clientEpoch = 1; late.sequence = 200; await act(async () => { resolve(late); });
    expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull(); expect(screen.getByRole('button', { name: 'Open task Reconnect result' })).toBeTruthy();
  });
});
