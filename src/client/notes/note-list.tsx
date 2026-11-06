import React from 'react';
import { noteTagsOf } from '../../domain/note.js';
import type { Note } from '../../shared/types.js';
import { PencilIcon } from '../icons.js';
import { Markdown } from '../ui.js';

/** List cards keep a scannable Markdown excerpt and open the overlay through the pencil action. */
export function NoteList({ notes, onEdit }: { notes: Note[]; onEdit: (note: Note) => void }) {
  return <ul className="kb-note-list">{notes.map(note => {
    const tags = noteTagsOf(note.tags);
    return <li className="kb-note kb-note-card" key={note.id}>
      {tags.length > 0 && <ul className="kb-note-tag-chips" aria-label="Note tags">{tags.map(tag => <li className="kb-tag" key={tag}>{tag}</li>)}</ul>}
      <div className="kb-note-preview"><Markdown>{note.content}</Markdown></div>
      <div className="kb-note-card-footer">
        <button type="button" className="kb-button kb-icon-button" aria-label={'Edit note ' + note.id} title="Edit note" onClick={() => onEdit(note)}><PencilIcon size={14} /></button>
      </div>
    </li>;
  })}</ul>;
}
