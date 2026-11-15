import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Extension } from '@codemirror/state';

/** The two languages a stage program may be authored in. */
export type CodeLanguage = 'bash' | 'typescript';

/**
 * The syntax support of one program language.
 *
 * The read-only review and the editable program import this one mapping, so the two
 * surfaces cannot drift in what they highlight or how they fold.
 */
export function codeLanguage(value: CodeLanguage): Extension {
  return value === 'typescript' ? javascript({ typescript: true }) : StreamLanguage.define(shell);
}
