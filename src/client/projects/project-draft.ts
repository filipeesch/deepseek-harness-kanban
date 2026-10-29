import { isAbsolutePath } from '../../domain/validation.js';
import type { Project, ProjectInput, ProjectLocation } from '../../shared/types.js';

export interface ProjectDraft {
  id?: string;
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  /** Fields the user changed; detection never overwrites an edited field unless it still matches the last detection. */
  edited: { name: boolean; gitRootPath: boolean; defaultBranch: boolean };
  /** Last values produced by detection, used to keep pristine fields in sync. */
  detected: { gitRootPath: string; defaultBranch: string };
}

export function createProjectDraft(project?: Project): ProjectDraft {
  return {
    ...(project === undefined ? {} : { id: project.id }),
    name: project?.name ?? '',
    projectPath: project?.projectPath ?? '',
    gitRootPath: project?.gitRootPath ?? '',
    defaultBranch: project?.defaultBranch ?? '',
    edited: { name: false, gitRootPath: false, defaultBranch: false },
    detected: { gitRootPath: project?.gitRootPath ?? '', defaultBranch: project?.defaultBranch ?? '' },
  };
}

export function editProjectDraft(draft: ProjectDraft, field: 'name' | 'projectPath' | 'gitRootPath' | 'defaultBranch', value: string): ProjectDraft {
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
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    name: draft.name.trim(),
    projectPath: draft.projectPath.trim(),
    ...(gitRootPath ? { gitRootPath } : {}),
    ...(gitRootPath && defaultBranch ? { defaultBranch } : {}),
  };
}

