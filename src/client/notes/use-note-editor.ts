import { useEffect, useRef, useState } from 'react';
import { noteTagsOf } from '../../domain/note.js';
import type { Command, Note, Problem } from '../../shared/types.js';
import { useAction, type RunCommand } from '../ui.js';

export type NoteEditorView = 'Edit' | 'Preview';

export interface NoteEditorController {
  content: string;
  tags: string[];
  view: NoteEditorView;
  pending: boolean;
  error: Problem | null;
  dirty: boolean;
  confirmingDelete: boolean;
  setContent(value: string): void;
  setTags(value: string[]): void;
  setView(value: NoteEditorView): void;
  save(): Promise<void>;
  requestDelete(): void;
  cancelDelete(): void;
  remove(): Promise<void>;
  close(): void;
}

/** One note draft: a fenced write lifetime keyed by the mounted task and note. */
export function useNoteEditor({ taskId, note, run, onSaved, onDeleted, onClose }: {
  taskId: string;
  note?: Note;
  run: RunCommand;
  onSaved(): void;
  onDeleted(): void;
  onClose(): void;
}): NoteEditorController {
  const action = useAction(run);
  const generation = useRef(0);
  const [content, setContent] = useState(note?.content ?? '');
  const [tags, setTags] = useState<string[]>(() => noteTagsOf(note?.tags));
  const [view, setView] = useState<NoteEditorView>('Edit');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => () => { generation.current++; }, []);
  const initialTags = noteTagsOf(note?.tags);
  const tagsChanged = tags.length !== initialTags.length || tags.some((tag, index) => tag !== initialTags[index]);
  const dirty = content !== (note?.content ?? '') || tagsChanged;

  function close(): void {
    generation.current++;
    onClose();
  }

  async function save(): Promise<void> {
    if (action.pending || !content.trim()) return;
    const current = generation.current;
    const command: Command = { type: 'note.save', taskId, ...(note ? { noteId: note.id } : {}), content, ...(tagsChanged ? { tags } : {}) };
    const result = await action.execute(command);
    if (result && current === generation.current) onSaved();
  }

  async function remove(): Promise<void> {
    if (action.pending || !note) return;
    const current = generation.current;
    const result = await action.execute({ type: 'note.delete', taskId, noteId: note.id });
    if (result && current === generation.current) onDeleted();
  }

  return {
    content, tags, view, pending: action.pending, error: action.error, dirty, confirmingDelete,
    setContent: value => { setContent(value); },
    setTags: value => { setTags(value); },
    setView,
    save, remove, close,
    requestDelete: () => { setConfirmingDelete(true); },
    cancelDelete: () => { setConfirmingDelete(false); },
  };
}
