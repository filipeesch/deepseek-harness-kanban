import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientApi, CreateWorktree, Project, Task } from '../shared/types.js';
import { taskTitleSlug, worktreePathForBranch } from '../shared/worktree-name.js';
import { asProblem } from './ui.js';

export interface WorktreeSuggestion { branchName: string; path: string }

export function initialWorktree(task: Task, project?: Project, basePath?: string): CreateWorktree {
  const branchName = taskTitleSlug(task.title);
  return { mode: 'new', branchName, path: worktreePathForBranch(basePath, branchName), sourceBranch: project?.defaultBranch ?? '' };
}

/** The host accepts an omitted source and falls back to its default branch or HEAD. */
export function validWorktree(value: CreateWorktree): boolean {
  return Boolean(value.path.trim() && value.branchName.trim());
}

export function cleanWorktree(value: CreateWorktree): CreateWorktree {
  const source = value.sourceBranch?.trim();
  return { mode: value.mode, path: value.path.trim(), branchName: value.branchName.trim(), ...(value.mode === 'new' && source ? { sourceBranch: source } : {}) };
}

export interface WorktreeDraft {
  value: CreateWorktree;
  suggestion: WorktreeSuggestion | null;
  suggestionPending: boolean;
  suggestionError: ReturnType<typeof asProblem> | null;
  branchTouched: boolean;
  pathTouched: boolean;
  assign(next: CreateWorktree): void;
  resetPath(): void;
  reloadSuggestion(): void;
  refreshSuggestion(): Promise<WorktreeSuggestion | null>;
}

export function useWorktreeDraft({ api, task, project, basePath, enabled }: { api: ClientApi; task: Task; project?: Project; basePath?: string; enabled: boolean }): WorktreeDraft {
  const [value, setValue] = useState<CreateWorktree>(() => initialWorktree(task, project, basePath));
  const [suggestion, setSuggestion] = useState<WorktreeSuggestion | null>(null);
  const [suggestionPending, setSuggestionPending] = useState(false);
  const [suggestionError, setSuggestionError] = useState<ReturnType<typeof asProblem> | null>(null);
  const [branchTouched, setBranchTouched] = useState(false);
  const [pathTouched, setPathTouched] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const valueRef = useRef(value); valueRef.current = value;
  const touchedRef = useRef({ branch: branchTouched, path: pathTouched });
  touchedRef.current = { branch: branchTouched, path: pathTouched };
  const defaultSource = project?.defaultBranch ?? '';
  const lastDefaultSource = useRef(defaultSource);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refreshSuggestion = useCallback(async (): Promise<WorktreeSuggestion | null> => {
    setSuggestionPending(true); setSuggestionError(null);
    try {
      const result = await api.worktreeDefault(task.id);
      if (mounted.current) {
        setSuggestion(result);
        if (!touchedRef.current.branch && !touchedRef.current.path) {
          setValue(current => ({ ...current, branchName: result.branchName, path: result.path }));
        }
      }
      return result;
    } catch (failure) {
      if (mounted.current) setSuggestionError(asProblem(failure));
      return null;
    } finally {
      if (mounted.current) setSuggestionPending(false);
    }
  }, [api, task.id]);

  useEffect(() => {
    if (!enabled) { setSuggestion(null); setSuggestionPending(false); setSuggestionError(null); return; }
    void refreshSuggestion();
  }, [enabled, attempt, refreshSuggestion]);

  useEffect(() => {
    if (touchedRef.current.path) return;
    setValue(current => {
      const next = worktreePathForBranch(basePath, current.branchName);
      return current.path === next ? current : { ...current, path: next };
    });
  }, [basePath, value.branchName]);

  // Keep the displayed source in sync with the project default until the user overrides it.
  useEffect(() => {
    setValue(current => current.sourceBranch === lastDefaultSource.current ? { ...current, sourceBranch: defaultSource } : current);
    lastDefaultSource.current = defaultSource;
  }, [defaultSource]);

  function assign(next: CreateWorktree) {
    const current = valueRef.current;
    if (next.mode !== current.mode) {
      touchedRef.current.branch = next.mode === 'existing';
      setBranchTouched(next.mode === 'existing');
    } else if (next.branchName !== current.branchName) {
      touchedRef.current.branch = true; setBranchTouched(true);
    }
    if (next.path !== current.path) { touchedRef.current.path = true; setPathTouched(true); }
    valueRef.current = next; setValue(next);
  }
  function resetPath() {
    touchedRef.current.path = false; setPathTouched(false);
    setValue(current => ({ ...current, path: worktreePathForBranch(basePath, current.branchName) }));
  }
  function reloadSuggestion() { setAttempt(value => value + 1); }

  return { value, suggestion, suggestionPending, suggestionError, branchTouched, pathTouched, assign, resetPath, reloadSuggestion, refreshSuggestion };
}
