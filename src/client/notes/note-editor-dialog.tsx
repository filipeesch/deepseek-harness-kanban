import React, { useEffect, useId, useRef } from 'react';
import type { Note } from '../../shared/types.js';
import { TrashIcon } from '../icons.js';
import { ErrorNotice, Markdown, Modal, Tabs, type RunCommand } from '../ui.js';
import { NoteTagInput } from './note-tag-input.js';
import { useNoteEditor } from './use-note-editor.js';

/** Create or edit one shared note in a focused overlay. */
export function NoteEditorDialog({ taskId, note, suggestions, run, onSaved, onDeleted, onClose }: {
  taskId: string;
  note?: Note;
  suggestions: string[];
  run: RunCommand;
  onSaved(): void;
  onDeleted(): void;
  onClose(): void;
}) {
  const editor = useNoteEditor({ taskId, note, run, onSaved, onDeleted, onClose });
  const tabId = useId();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editor.confirmingDelete) keepRef.current?.focus(); }, [editor.confirmingDelete]);
  function cancelDelete(): void { editor.cancelDelete(); deleteRef.current?.focus(); }
  const title = note === undefined ? 'New note' : 'Edit note';
  return <Modal title={title} size="wide" busy={editor.pending} initialFocus="target" onClose={editor.close}
    headerActions={note === undefined ? undefined : <button ref={deleteRef} type="button" className="kb-button kb-icon-button kb-danger" aria-label="Delete note" title="Delete note" disabled={editor.pending} onClick={editor.requestDelete}><TrashIcon size={16} /></button>}>
    {editor.confirmingDelete && <div className="kb-inline-confirm" role="alertdialog" aria-label="Confirm deleting note">
      <p>Delete this note? This cannot be undone.</p>
      <div className="kb-actions">
        <button ref={keepRef} type="button" className="kb-button" disabled={editor.pending} onClick={cancelDelete}>Keep note</button>
        <button type="button" className="kb-button kb-danger" disabled={editor.pending} onClick={() => void editor.remove()}>{editor.pending ? 'Deleting…' : 'Delete note permanently'}</button>
      </div>
    </div>}
    <div className="kb-note-editor-tabs"><Tabs label="Note view" values={['Edit', 'Preview']} selected={editor.view} onSelect={value => editor.setView(value === 'Preview' ? 'Preview' : 'Edit')} id={tabId} /></div>
    <div role="tabpanel" id={tabId + '-panel-' + editor.view} aria-labelledby={tabId + '-tab-' + editor.view} className="kb-note-editor-panel">
      {editor.view === 'Edit'
        ? <label className="kb-field">Markdown<textarea className="kb-input" data-kb-initial-focus rows={12} disabled={editor.pending} value={editor.content} onChange={event => editor.setContent(event.target.value)} /></label>
        : <div className="kb-note-preview kb-note-preview-full">{editor.content.trim() ? <Markdown>{editor.content}</Markdown> : <p className="kb-hint">Nothing to preview yet.</p>}</div>}
    </div>
    <NoteTagInput value={editor.tags} suggestions={suggestions} disabled={editor.pending} onChange={editor.setTags} />
    <ErrorNotice problem={editor.error} />
    <div className="kb-actions">
      <button type="button" className="kb-button" disabled={editor.pending} onClick={editor.close}>Cancel</button>
      <button type="button" className="kb-button kb-primary" disabled={editor.pending || !editor.content.trim() || !editor.dirty} onClick={() => void editor.save()}>{editor.pending ? 'Saving…' : 'Save note'}</button>
    </div>
  </Modal>;
}
