import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'inherit', backgroundColor: 'transparent', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { padding: '8px 0', caretColor: 'currentColor' },
  '.cm-line': { padding: '0 10px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'color-mix(in srgb, currentColor 48%, transparent)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, currentColor 4%, transparent)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, currentColor 18%, transparent) !important' },
  '.cm-foldPlaceholder': { backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', color: 'inherit' },
  '.cm-panels': { backgroundColor: 'var(--kb-surface, Canvas)', color: 'inherit' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid color-mix(in srgb, currentColor 20%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, currentColor 20%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, currentColor 31%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--kb-surface, Canvas)', color: 'inherit', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)' },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'color-mix(in srgb, currentColor 54%, #6b7280)', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'color-mix(in srgb, currentColor 70%, #2563eb)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'color-mix(in srgb, currentColor 64%, #15803d)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'color-mix(in srgb, currentColor 64%, #b45309)' },
  { tag: [tags.keyword, tags.operator], color: 'color-mix(in srgb, currentColor 68%, #7c3aed)' },
  { tag: tags.invalid, color: '#c53030' },
]);

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly?: boolean;
  diagnostics?: readonly Diagnostic[];
  onSaveShortcut?: () => void;
  describedBy?: string;
  className?: string;
}

/** Controlled CodeMirror host for workflow YAML; the view is created once per mount. */
export function CodeEditor({ value, onChange, label, readOnly = false, diagnostics = [], onSaveShortcut, describedBy, className }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onSaveRef = useRef(onSaveShortcut); onSaveRef.current = onSaveShortcut;
  const readOnlyCompartment = useRef(new Compartment());
  const contentCompartment = useRef(new Compartment());
  const syncing = useRef(false);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        foldGutter(),
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current?.(); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        yaml(),
        syntaxHighlighting(highlightStyle),
        EditorView.lineWrapping,
        editorTheme,
        readOnlyCompartment.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        contentCompartment.current.of(EditorView.contentAttributes.of({ 'aria-label': label, ...(describedBy ? { 'aria-describedby': describedBy } : {}) })),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    const instance = new EditorView({ state, parent });
    view.current = instance;
    instance.dispatch(setDiagnostics(instance.state, [...diagnostics]));
    return () => { view.current = null; instance.destroy(); };
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    syncing.current = true;
    try {
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
    } finally {
      syncing.current = false;
    }
  }, [value]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: readOnlyCompartment.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch(setDiagnostics(instance.state, [...diagnostics]));
  }, [diagnostics]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: contentCompartment.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label, ...(describedBy ? { 'aria-describedby': describedBy } : {}) })) });
  }, [label, describedBy]);

  return <div ref={host} className={'kb-code-editor' + (readOnly ? ' is-read-only' : '') + (className ? ' ' + className : '')} aria-disabled={readOnly || undefined} />;
}
