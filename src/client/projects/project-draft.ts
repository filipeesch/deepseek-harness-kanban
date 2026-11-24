import { isAbsolutePath } from '../../domain/validation.js';
import type { Project, ProjectInput, ProjectLocation, WorktreePolicy } from '../../shared/types.js';

export interface ProjectDraft {
  id?: string;
  name: string;
  /** Stable local identity within the Hub; empty means the host derives it from the name. */
  projectKey: string;
  /** The key the team's boards name this project by; empty means the local key. */
  publishedKey: string;
  /** The stored team key the draft started from, so clearing it is a stated change. */
  initialPublishedKey: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  /** How the project answers the worktree decision its tasks face before their first execution. */
  worktreePolicy: WorktreePolicy;
  /** Fields the user changed; detection never overwrites an edited field unless it still matches the last detection. */
  edited: { name: boolean; gitRootPath: boolean; defaultBranch: boolean };
  /** Last values produced by detection, used to keep pristine fields in sync. */
  detected: { gitRootPath: string; defaultBranch: string };
}

export function createProjectDraft(project?: Project): ProjectDraft {
  return {
    ...(project === undefined ? {} : { id: project.id }),
    name: project?.name ?? '',
    projectKey: project?.projectKey ?? '',
    publishedKey: project?.publishedKey ?? '',
    initialPublishedKey: project?.publishedKey ?? '',
    projectPath: project?.projectPath ?? '',
    gitRootPath: project?.gitRootPath ?? '',
    defaultBranch: project?.defaultBranch ?? '',
    worktreePolicy: project?.worktreePolicy ?? 'ask',
    edited: { name: false, gitRootPath: false, defaultBranch: false },
    detected: { gitRootPath: project?.gitRootPath ?? '', defaultBranch: project?.defaultBranch ?? '' },
  };
}

export function editProjectDraft(draft: ProjectDraft, field: 'name' | 'projectKey' | 'publishedKey' | 'projectPath' | 'gitRootPath' | 'defaultBranch' | 'worktreePolicy', value: string): ProjectDraft {
  return { ...draft, [field]: value, edited: { ...draft.edited, [field]: true } };
}

function canAutofill(draft: ProjectDraft, field: 'gitRootPath' | 'defaultBranch'): boolean {
  return !draft.edited[field] || draft[field] === draft.detected[field];
}

function folderName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

/** Apply a detection result without replacing values the user owns. */
export function applyDetection(draft: ProjectDraft, location: ProjectLocation): ProjectDraft {
  const gitRootPath = location.kind === 'git' ? location.gitRootPath : '';
  const defaultBranch = location.kind === 'git' ? location.defaultBranch ?? '' : '';
  const next: ProjectDraft = {
    ...draft,
    projectPath: location.projectPath,
    detected: { gitRootPath, defaultBranch },
  };
  if (canAutofill(draft, 'gitRootPath')) next.gitRootPath = gitRootPath;
  if (canAutofill(draft, 'defaultBranch')) next.defaultBranch = defaultBranch;
  if (draft.name.trim() === '' && !draft.edited.name) next.name = folderName(location.projectPath);
  return next;
}

export function canSaveProject(draft: ProjectDraft): boolean {
  return draft.name.trim().length > 0 && isAbsolutePath(draft.projectPath.trim());
}

/** Blank Git root means a folder project; a default branch without a Git root is never sent. */
export function toProjectInput(draft: ProjectDraft): ProjectInput {
  const gitRootPath = draft.gitRootPath.trim();
  const defaultBranch = draft.defaultBranch.trim();
  const projectKey = draft.projectKey.trim();
  const publishedKey = draft.publishedKey.trim();
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    name: draft.name.trim(),
    ...(projectKey ? { projectKey } : {}),
    // Stated only when it says something: a value claims the identity, and an empty
    // field over a stored key clears it. Otherwise the host keeps what it holds, so a
    // save of a project with no team key carries no field at all.
    ...(publishedKey !== '' || draft.initialPublishedKey !== '' ? { publishedKey } : {}),
    projectPath: draft.projectPath.trim(),
    worktreePolicy: draft.worktreePolicy,
    ...(gitRootPath ? { gitRootPath } : {}),
    ...(gitRootPath && defaultBranch ? { defaultBranch } : {}),
  };
}

