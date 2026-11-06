import React from 'react';
import { toggleTag } from './note-tags.js';

/** One active tag filter; selecting it again or All clears the filter. */
export function NoteTagBar({ tags, active, onSelect }: { tags: string[]; active: string | null; onSelect: (tag: string | null) => void }) {
  return <div className="kb-tag-bar" role="group" aria-label="Filter notes by tag">
    <button type="button" className="kb-tag kb-tag-filter" aria-pressed={active === null} onClick={() => onSelect(null)}>All</button>
    {tags.map(tag => <button type="button" className="kb-tag kb-tag-filter" key={tag} aria-pressed={active === tag} onClick={() => onSelect(toggleTag(active, tag))}>{tag}</button>)}
  </div>;
}
