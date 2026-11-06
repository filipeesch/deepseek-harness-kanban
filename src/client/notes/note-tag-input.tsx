import React, { useId, useState } from 'react';
import { MAX_NOTE_TAGS, MAX_NOTE_TAG_LENGTH } from '../../domain/note.js';
import { addDraftTag } from './note-tags.js';

/** Chip input: Enter or a comma turns the drafted text into a normalized chip. */
export function NoteTagInput({ value, suggestions, disabled = false, onChange }: {
  value: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const suggestionsId = useId();
  const atLimit = value.length >= MAX_NOTE_TAGS;
  const locked = disabled || atLimit;

  function commit(raw: string): void {
    if (!disabled && !atLimit && raw.trim()) onChange(addDraftTag(value, raw));
    setDraft('');
  }

  return <div className="kb-field">
    <span className="kb-field-label">Tags</span>
    <ul className="kb-note-tag-chips" aria-label="Note tags">
      {value.map(tag => <li className="kb-tag kb-tag-editable" key={tag}>{tag}
        <button type="button" className="kb-tag-remove" aria-label={'Remove tag ' + tag} disabled={disabled} onClick={() => onChange(value.filter(item => item !== tag))}>×</button>
      </li>)}
    </ul>
    <input className="kb-input" aria-label="Tags" list={suggestionsId} value={draft} disabled={locked}
      placeholder={atLimit ? 'Tag limit reached' : 'Add a tag and press Enter'}
      onChange={event => { const next = event.target.value; if (next.endsWith(',')) commit(next.slice(0, -1)); else setDraft(next); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(draft); } }} />
    <datalist id={suggestionsId}>{suggestions.map(tag => <option key={tag} value={tag} />)}</datalist>
    <p className="kb-hint">At most {MAX_NOTE_TAGS} tags per note. Tags are lowercase and up to {MAX_NOTE_TAG_LENGTH} characters.</p>
  </div>;
}
