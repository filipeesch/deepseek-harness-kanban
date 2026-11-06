import React, { useState } from 'react';
import type { BoardState, Note, Task } from '../../shared/types.js';
import { createTaskPageState, usePageField, type TaskPageState } from '../page-state.js';
import type { RunCommand } from '../ui.js';
import { NoteEditorDialog } from './note-editor-dialog.js';
import { NoteList } from './note-list.js';
import { NoteTagBar } from './note-tag-bar.js';
import { filterNotes, uniqueTags } from './note-tags.js';

export function NotesPanel({ task, state, run, viewState }: { task: Task; state: BoardState; run: RunCommand; viewState?: TaskPageState }) {
  return <NotesPanelContent key={task.id} task={task} state={state} run={run} viewState={viewState} />;
}

function NotesPanelContent({ task, state, run, viewState }: { task: Task; state: BoardState; run: RunCommand; viewState?: TaskPageState }) {
  const [localViewState] = useState(createTaskPageState);
  const preferences = viewState ?? localViewState;
  const [filter, setFilter] = usePageField(preferences, 'noteTagFilter');
  const [editing, setEditing] = useState<{ note?: Note } | null>(null);
  const notes = state.notes.filter(note => note.taskId === task.id);
  const tags = uniqueTags(notes);
  const active = filter ?? null;
  const visible = filterNotes(notes, active);
  const closeEditor = () => setEditing(null);
  const saved = () => { setEditing(null); setFilter(undefined); };
  return <div className="kb-form">
    <p className="kb-hint">Notes belong to this task and are shared by all of its conversations.</p>
    <div className="kb-row"><h3>Shared notes</h3><button className="kb-button" type="button" onClick={() => setEditing({})}>New note</button></div>
    {notes.length === 0 && <p>No notes yet.</p>}
    {/* Keep All reachable when a filter outlives its last tag. */}
    {(tags.length > 0 || active !== null) && <NoteTagBar tags={tags} active={active} onSelect={tag => setFilter(tag ?? undefined)} />}
    {notes.length > 0 && visible.length === 0 && <p className="kb-hint">No notes match the selected tag.</p>}
    {visible.length > 0 && <NoteList notes={visible} onEdit={note => setEditing({ note })} />}
    {editing !== null && <NoteEditorDialog key={editing.note?.id ?? 'new'} taskId={task.id} note={editing.note} suggestions={tags} run={run} onSaved={saved} onDeleted={closeEditor} onClose={closeEditor} />}
  </div>;
}
