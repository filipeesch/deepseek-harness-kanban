// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView, createBoardPageState } from '../../src/client/board.js';
import { NotesPanel } from '../../src/client/notes/notes-panel.js';
import { addDraftTag, filterNotes, toggleTag, uniqueTags } from '../../src/client/notes/note-tags.js';
import { useNoteEditor } from '../../src/client/notes/use-note-editor.js';
import type { RunCommand } from '../../src/client/ui.js';
import type { Note } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const renderNative = (id: string) => <div data-testid={'native-' + id}>Native session {id}</div>;

function note(id: string, taskId: string, content: string, tags?: string[]): Note {
  return { id, taskId, content, createdAt: 'now', updatedAt: 'now', ...(tags ? { tags } : {}) };
}

async function openNotes(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open task Alpha task' });
  await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
  await user.click(screen.getByRole('tab', { name: 'Notes' }));
}

describe('note tag helpers', () => {
  it('derives unique tags alphabetically and filters by one tag', () => {
    const notes = [note('a', 't1', 'a', ['zoo']), note('b', 't1', 'b', ['apple', 'design']), note('c', 't1', 'c', ['design']), note('d', 't1', 'd')];
    expect(uniqueTags(notes)).toEqual(['apple', 'design', 'zoo']);
    expect(filterNotes(notes, null).map(value => value.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterNotes(notes, 'design').map(value => value.id)).toEqual(['b', 'c']);
    expect(filterNotes(notes, 'missing')).toEqual([]);
  });

  it('toggles the active tag and normalizes a drafted chip', () => {
    expect(toggleTag(null, 'design')).toBe('design');
    expect(toggleTag('design', 'design')).toBeNull();
    expect(addDraftTag(['design'], ' Design ')).toEqual(['design']);
    expect(addDraftTag(['design'], 'TODO')).toEqual(['design', 'todo']);
    expect(addDraftTag(['design'], 'very-long-tag-name-here')).toEqual(['design', 'very-long-tag-n']);
    expect(addDraftTag(['a', 'b', 'c', 'd'], 'e')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('normalizes legacy stored tags for display and filtering', () => {
    const legacy = note('a', 't1', 'legacy', [' Design ', 'very-long-tag-name-here', 'a', 'b', 'c']);
    expect(uniqueTags([legacy])).toEqual(['a', 'b', 'design', 'very-long-tag-n']);
    expect(filterNotes([legacy], 'design').map(value => value.id)).toEqual(['a']);
    expect(filterNotes([legacy], 'a')).toHaveLength(1);
  });
});

describe('note editor controller', () => {
  it('tracks a dirty draft from content and tags', () => {
    const run = vi.fn(async () => fixture()) as unknown as RunCommand;
    const { result } = renderHook(() => useNoteEditor({ taskId: 't1', note: note('a', 't1', 'note a', ['design']), run, onSaved: vi.fn(), onDeleted: vi.fn(), onClose: vi.fn() }));
    expect(result.current.dirty).toBe(false);
    act(() => { result.current.setContent('note a changed'); });
    expect(result.current.dirty).toBe(true);
    act(() => { result.current.setContent('note a'); result.current.setTags(['todo']); });
    expect(result.current.dirty).toBe(true);
    act(() => { result.current.setTags(['design']); });
    expect(result.current.dirty).toBe(false);
  });

  it('ignores a save that completes after the editor unmounts', async () => {
    let resolve!: (value: ReturnType<typeof fixture>) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>(done => { resolve = done; })) as unknown as RunCommand;
    const onSaved = vi.fn();
    const { result, unmount } = renderHook(() => useNoteEditor({ taskId: 't1', note: note('a', 't1', 'note a'), run, onSaved, onDeleted: vi.fn(), onClose: vi.fn() }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.save(); });
    expect(run).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { resolve(fixture()); await pending; });
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('note tag input', () => {
  it('adds chips on Enter and comma, removes them, and stops at four', async () => {
    const value = fixture(); value.state.notes = [note('a', 't1', 'note a'), note('b', 't1', 'note b', ['design'])];
    const mock = fakeApi(value); const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={mock.command} />);
    await user.click(screen.getByRole('button', { name: 'Edit note a' }));
    expect([...document.querySelectorAll('datalist option')].map(option => option.getAttribute('value'))).toContain('design');
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, ' Design{Enter}');
    expect(screen.getByRole('button', { name: 'Remove tag design' })).toBeTruthy();
    await user.type(input, 'design{Enter}');
    expect(screen.getAllByRole('button', { name: 'Remove tag design' })).toHaveLength(1);
    await user.type(input, 'TODO,');
    expect(screen.getByRole('button', { name: 'Remove tag todo' })).toBeTruthy();
    await user.type(input, 'very-long-tag-name-here{Enter}');
    expect(screen.getByRole('button', { name: 'Remove tag very-long-tag-n' })).toBeTruthy();
    await user.type(input, 'extra{Enter}');
    expect((screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove tag design' }));
    expect((screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement).disabled).toBe(false);
  });
});

describe('note list and tag filter', () => {
  it('presents legacy tags normalized and preserves them on a content-only save', async () => {
    const value = fixture(); value.state.notes = [note('a', 't1', 'legacy content', [' Design '])];
    const mock = fakeApi(value); const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={mock.command} />);
    const list = document.querySelector('.kb-note-list') as HTMLElement;
    expect(within(list).getByText('design')).toBeTruthy();
    expect(screen.queryByText(' Design ')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit note a' }));
    const save = screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), ' updated');
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(mock.command).toHaveBeenCalledWith({ type: 'note.save', taskId: 't1', noteId: 'a', content: 'legacy content updated' }));
    expect(mock.command).not.toHaveBeenCalledWith(expect.objectContaining({ tags: expect.anything() }));
  });

  it('renders tag chips, a clamped preview, and filters the list by one tag', async () => {
    const value = fixture();
    value.state.notes = [note('a', 't1', 'note a', ['design']), note('b', 't1', 'note b', ['todo']), note('c', 't1', 'note c')];
    const mock = fakeApi(value); const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={mock.command} />);
    expect(screen.queryByRole('textbox', { name: 'Markdown' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Tags' })).toBeNull();
    const list = document.querySelector('.kb-note-list') as HTMLElement;
    expect(within(list).getByText('design')).toBeTruthy();
    expect(within(list).queryByText('note b')).toBeTruthy();
    expect(within(list).getAllByRole('list', { name: 'Note tags' })).toHaveLength(2);
    expect(document.querySelector('.kb-note-preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'design' }));
    expect(screen.getByRole('button', { name: 'design' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('note b')).toBeNull();
    expect(screen.getByText('note a')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'design' }));
    expect(screen.getByText('note b')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'todo' }));
    expect(screen.queryByText('note a')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('note a')).toBeTruthy();
  });

  it('omits the filter bar when no note has tags', () => {
    const value = fixture(); value.state.notes = [note('a', 't1', 'note a')];
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={fakeApi(value).command} />);
    expect(screen.queryByRole('group', { name: 'Filter notes by tag' })).toBeNull();
  });

  it('offers a Preview tab and cancels a delete confirmation', async () => {
    const value = fixture(); value.state.notes = [note('a', 't1', '**bold** note', ['design'])];
    const mock = fakeApi(value); const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={mock.command} />);
    await user.click(screen.getByRole('button', { name: 'Edit note a' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Markdown' }));
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(within(screen.getByRole('dialog')).getByText('bold')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm deleting note' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep note' }));
    await user.click(within(confirm).getByRole('button', { name: 'Keep note' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete note' }));
    expect(mock.command).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes the overlay through Escape, the backdrop, and the close action without saving', async () => {
    const value = fixture(); value.state.notes = [note('a', 't1', 'note a')];
    const mock = fakeApi(value); const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={mock.command} />);
    const open = async () => { await user.click(screen.getByRole('button', { name: 'Edit note a' })); };
    await open(); await user.type(screen.getByRole('textbox', { name: 'Markdown' }), ' draft');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await open(); fireEvent.mouseDown(document.querySelector('.kb-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    await open(); await user.click(screen.getByRole('button', { name: 'Close Edit note' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await open();
    expect((screen.getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe('note a');
    expect(mock.command).not.toHaveBeenCalled();
  });

  it('locks the overlay while a delete is in flight', async () => {
    const value = fixture(); value.state.notes = [note('a', 't1', 'note a')];
    let resolve!: (value: ReturnType<typeof fixture>) => void;
    const run = vi.fn(() => new Promise<ReturnType<typeof fixture>>(done => { resolve = done; })) as unknown as RunCommand;
    const user = userEvent.setup();
    render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={run} />);
    await user.click(screen.getByRole('button', { name: 'Edit note a' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm deleting note' });
    const remove = within(confirm).getByRole('button', { name: 'Delete note permanently' }) as HTMLButtonElement;
    await user.click(remove);
    expect(remove.disabled).toBe(true);
    expect((within(confirm).getByRole('button', { name: 'Keep note' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete note' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve(fixture()); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('notes in the task drawer', () => {
  it('creates a tagged note in the overlay, updates it, and clears the filter on save', async () => {
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={renderNative} />);
    await openNotes(user);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), '**Design** note');
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), ' Design{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Design')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'design' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'design' }));
    expect(screen.getByRole('button', { name: 'design' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByRole('button', { name: 'design' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), 'Another note');
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'todo{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Another note')).toBeTruthy();
    const created = mock.get().state.notes.find(value => value.content === 'Another note')!;
    await user.click(screen.getByRole('button', { name: 'Edit note ' + created.id }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), ' updated');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.command).toHaveBeenLastCalledWith({ type: 'note.save', taskId: 't1', noteId: created.id, content: 'Another note updated' });
    expect(screen.getByText('Another note updated')).toBeTruthy();
  });

  it('deletes a note from the overlay and keeps the remaining notes', async () => {
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={renderNative} />);
    await openNotes(user);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), 'First note');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), 'Second note');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const first = mock.get().state.notes.find(value => value.content === 'First note')!;
    await user.click(screen.getByRole('button', { name: 'Edit note ' + first.id }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Confirm deleting note' })).getByRole('button', { name: 'Delete note permanently' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('First note')).toBeNull();
    expect(screen.getByText('Second note')).toBeTruthy();
    expect(mock.command).toHaveBeenCalledWith({ type: 'note.delete', taskId: 't1', noteId: first.id });
  });

  it('keeps All reachable when the active tag outlives its last note', async () => {
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={renderNative} />);
    await openNotes(user);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), 'Tagged note');
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'design{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown' }), 'Untagged note');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'design' }));
    expect(screen.queryByText('Untagged note')).toBeNull();
    const tagged = mock.get().state.notes.find(value => value.content === 'Tagged note')!;
    await user.click(screen.getByRole('button', { name: 'Edit note ' + tagged.id }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Confirm deleting note' })).getByRole('button', { name: 'Delete note permanently' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('No notes match the selected tag.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Untagged note')).toBeTruthy();
  });
});
