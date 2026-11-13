import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightSpecialChars, lineNumbers } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { editorTheme, highlightStyle } from './code-editor.js';

export type CodeLanguage = 'bash' | 'typescript';

const language = (value: CodeLanguage) => value === 'typescript' ? javascript({ typescript: true }) : StreamLanguage.define(shell);

/** Read-only exact source: the review inspects bytes, never edits them. */
export function CodeView({ code, language: kind, label, className }: { code: string; language: CodeLanguage; label: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({ tabindex: '0', role: 'textbox', 'aria-label': label, 'aria-readonly': 'true' }),
        language(kind),
        syntaxHighlighting(highlightStyle),
        editorTheme,
      ],
    });
    const instance = new EditorView({ state, parent });
    return () => { instance.destroy(); };
  }, [code, kind, label]);
  return <div ref={host} className={'kb-code-view' + (className === undefined ? '' : ' ' + className)} data-language={kind} />;
}
