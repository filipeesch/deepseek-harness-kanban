/**
 * The consequences of deleting one card, read immediately before a deletion is
 * admitted. It is a report for the person and the agent, never a verdict: the
 * queued preflight stays the only authority on whether the cleanup proceeds, so
 * every fact here is read defensively and one the host cannot determine is
 * reported as unavailable instead of guessed.
 */

import { isGitProject } from '../shared/project.js';
import type { GitPort } from '../shared/ports.js';
import type { HubState, Project, Task } from '../shared/types.js';
import { relationsOf } from '../domain/card-relation.js';
import type { DeletionTarget } from './deletion-target.js';

/** One unclaimed checkout the deletion will leave on disk. */
export interface PreviewUnclaimedCheckout { path: string; branch: string }
/**
 * Whether the checkout holds local changes needing a separate discard consent.
 * `not-applicable` means the deletion will not remove that checkout, so no
 * consent can apply; `unavailable` means the host could not read the tree, which
 * is never the same answer as a clean tree.
 */
export type PreviewLocalChanges = 'clean' | 'changes' | 'unavailable' | 'not-applicable';

/** What the deletion will do with the checkout, or that it could not be resolved. */
/**
 * What the deletion does with the checkout. `none` means the task records a
 * checkout the resolver does not treat as removable or retained, which only a
 * plain aggregate read can produce.
 */
export type PreviewDisposition = 'remove' | 'retain' | 'none' | 'unavailable';

/** The checkout the card owns, as the deletion will treat it. */
export interface PreviewCheckout {
  path: string;
  branch: string;
  /** True when Kanban created the checkout, false when it was attached externally. */
  owned: boolean;
  /** True when a branch exists to preserve; a detached checkout has none. */
  branchKept: boolean;
  /** True when the project is not Git-backed, so the checkout stays on disk. */
  plainFolder: boolean;
  disposition: PreviewDisposition;
  localChanges: PreviewLocalChanges;
}

/** What one card deletion will remove, retain, and archive. */
export interface DeletionPreview {
  conversations: { total: number; closed: number };
  notes: number;
  relations: number;
  /** Absent when the card has no associated worktree. */
  checkout?: PreviewCheckout;
  unclaimedCheckouts: PreviewUnclaimedCheckout[];
}

/** The narrow facts a preview needs; no mutation, no command lane, no queue. */
export interface DeletionPreviewInput {
  hub: HubState;
  task: Task;
  project: Project;
  /** Resolves how the deletion treats the checkout, exactly as the cleanup will. */
  resolveTarget: () => Promise<DeletionTarget>;
  git: Pick<GitPort, 'localChanges'>;
}
/** Every note the Hub stores for one card. */
function noteCount(hub: HubState, taskId: string): number {
  return hub.notes.filter(note => note.taskId === taskId).length;
}

/**
 * The checkout disposition, or undefined when the shared resolver refuses. A
 * refusal here must not fail the call: the queued preflight reaches the same
 * decision with the context it needs, and it is the one that may refuse.
 */
async function resolveDisposition(input: DeletionPreviewInput): Promise<DeletionTarget | undefined> {
  try { return await input.resolveTarget(); }
  catch { return undefined; }
}

/**
 * Whether the checkout holds local changes that will need a separate consent. A
 * plain folder has no Git tree to read, so no consent can apply; a failed read is
 * unavailable rather than clean, because claiming a clean tree the host never saw
 * would hide a consent the person owes.
 */
async function readLocalChanges(input: DeletionPreviewInput, path: string): Promise<PreviewLocalChanges> {
  if (!isGitProject(input.project)) return 'not-applicable';
  try { return await input.git.localChanges(input.project, path, input.task.sessionIds) ? 'changes' : 'clean'; }
  catch { return 'unavailable'; }
}
/**
 * Read the consequences of deleting one card. Counting is pure, and only the
 * checkout disposition and the local-change fact touch the outside world: the
 * disposition comes from the same rule the cleanup applies, so a plain-folder
 * checkout is reported as retained before the deletion is admitted.
 */
export async function previewDeletion(input: DeletionPreviewInput): Promise<DeletionPreview> {
  const { hub, task } = input;
  const base = {
    conversations: { total: task.sessionIds.length, closed: task.closedSessionIds.length },
    notes: noteCount(hub, task.id),
    relations: relationsOf(hub, task.id).length,
    unclaimedCheckouts: (task.unclaimedWorktrees ?? []).map(entry => ({ path: entry.path, branch: entry.branch })),
  };
  const worktree = task.worktree;
  // No checkout means the deletion removes no directory; the counts still apply.
  if (!worktree) return base;
  const target = await resolveDisposition(input);
  const plainFolder = target?.checkout === 'retain' && target.retainReason === 'folder';
  const disposition: PreviewDisposition = target === undefined ? 'unavailable' : target.checkout;
  // A checkout the deletion will not remove cannot require discard consent.
  const localChanges: PreviewLocalChanges = disposition === 'remove'
    ? await readLocalChanges(input, worktree.path)
    : disposition === 'retain' ? 'not-applicable' : 'unavailable';
  return {
    ...base,
    checkout: {
      path: worktree.path,
      branch: worktree.branch,
      owned: worktree.owned,
      branchKept: worktree.branch !== 'HEAD',
      plainFolder,
      disposition,
      localChanges,
    },
  };
}
