import { sameWorkflowContent } from '../workflow-content.js';
import { sameScope } from '../journal/derive.js';

/**
 * One board as sharing compares it: the authored workflow plus the board fields that
 * publish beside it. Every surface that asks "does this board differ from what this
 * installation applied?" — the board's state, the change list, the publish derivation,
 * and revisions — answers it through this comparison, so they cannot disagree.
 */
export interface BoardDocument {
  readonly workflow: string;
  readonly name: string | null;
  readonly projectKeys: readonly string[] | null;
  readonly rank: string | null;
  /** The recorded default preset choice; absent or null means the board records none. */
  readonly presetMode?: 'operator' | 'host' | null;
}

/**
 * Whether two authored workflows differ in what they publish. The compared content
 * carries descriptions, decision configurations, scripts, and the diagram layout, so a
 * description-only edit is a difference and a comment-only edit is not. Stage identity
 * is excluded because a publish never carries a key-only difference: the derivation
 * matches identities instead of publishing them, and comparing them here would report a
 * difference that a publish then could not append.
 */
export function workflowDiffers(localText: string, appliedText: string): boolean {
  return !sameWorkflowContent(localText, appliedText);
}

/** Whether one board differs from the version this installation last applied. */
export function boardDiffers(local: BoardDocument, applied: BoardDocument): boolean {
  return (local.presetMode ?? null) !== (applied.presetMode ?? null)
    || local.name !== applied.name
    || !sameScope(local.projectKeys, applied.projectKeys)
    || local.rank !== applied.rank
    || workflowDiffers(local.workflow, applied.workflow);
}
