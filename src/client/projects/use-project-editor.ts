import { useEffect, useRef, useState } from 'react';
import { isAbsolutePath } from '../../domain/validation.js';
import type { ClientApi, Problem, Project, ProjectLocation } from '../../shared/types.js';
import { asProblem } from '../problem.js';
import { useDirectoryPicker } from '../services.js';
import { creationReceiptId, type RunCommand } from '../ui.js';
import { applyDetection, canSaveProject, createProjectDraft, editProjectDraft, toProjectInput, type ProjectDraft } from './project-draft.js';

export interface ProjectEditorController {
  draft: ProjectDraft;
  detection: ProjectLocation | null;
  pending: boolean;
  picking: boolean;
  blocked: boolean;
  error: Problem | null;
  readonly canBrowse: boolean;
  change(field: 'name' | 'projectPath' | 'gitRootPath' | 'defaultBranch', value: string): void;
  browse(): Promise<void>;
  blurPath(): void;
  save(): Promise<void>;
  cancel(): void;
}

export function useProjectEditor({ api, hubId, expectedRevision, project, run, onSaved, onClose }: {
  api?: ClientApi;
  hubId?: string;
  expectedRevision?: number;
  project?: Project;
  run: RunCommand;
  onSaved: (id: string) => void;
  onClose: () => void;
}): ProjectEditorController {
  const [draft, setDraft] = useState<ProjectDraft>(() => createProjectDraft(project));
  const draftRef = useRef(draft);
  const [detection, setDetection] = useState<ProjectLocation | null>(null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  const detectionInFlight = useRef<Promise<void> | null>(null);
  const picker = useDirectoryPicker();
  useEffect(() => () => { alive.current = false; generation.current++; }, []);

  /** The ref is the handler-time source of truth; React state only mirrors it for rendering. */
  function commit(next: ProjectDraft): void {
    draftRef.current = next;
    setDraft(next);
  }

  function change(field: 'name' | 'projectPath' | 'gitRootPath' | 'defaultBranch', value: string): void {
    if (pending) return;
    setError(null);
    // A manual path edit cancels an in-flight detection for the previous path.
    if (field === 'projectPath') generation.current++;
    commit(editProjectDraft(draftRef.current, field, value));
  }

  function detect(pathValue: string): Promise<void> {
    if (api === undefined || !isAbsolutePath(pathValue)) return Promise.resolve();
    const token = ++generation.current;
    const task = (async () => {
      try {
        const location = await api.detectProject(pathValue);
        if (!alive.current || token !== generation.current) return;
        const currentPath = draftRef.current.projectPath.trim();
        if (currentPath !== pathValue && currentPath !== location.projectPath) return;
        setError(null);
        setDetection(location);
        commit(applyDetection(draftRef.current, location));
      } catch (failure) {
        if (!alive.current || token !== generation.current) return;
        setError(asProblem(failure));
      }
    })();
    detectionInFlight.current = task;
    void task.finally(() => { if (detectionInFlight.current === task) detectionInFlight.current = null; });
    return task;
  }

  async function browse(): Promise<void> {
    if (picker === null || pending || picking) return;
    setError(null); setPicking(true);
    try {
      const picked = await picker.pick();
      if (picked === null || !alive.current) return;
      generation.current++;
      commit({ ...draftRef.current, projectPath: picked });
      await detect(picked);
    } catch (failure) {
      if (alive.current) setError(asProblem(failure));
    } finally {
      if (alive.current) setPicking(false);
    }
  }

  function blurPath(): void { void detect(draftRef.current.projectPath.trim()); }

  async function save(): Promise<void> {
    if (pending || saving.current || blocked) return;
    saving.current = true;
    setPending(true); setError(null);
    try {
      // Never register a project from a draft a pending detection is about to correct.
      if (detectionInFlight.current !== null) await detectionInFlight.current;
      if (!alive.current) return;
      const current = draftRef.current;
      if (!canSaveProject(current)) {
        setError({ code: 'INVALID_PROJECT_INPUT', message: 'A project name and an absolute project path are required.' });
        return;
      }
      const result = await run({
        type: 'project.save',
        project: toProjectInput(current),
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
      if (!alive.current) return;
      const id = current.id ?? creationReceiptId(result, 'project');
      if (id === undefined) {
        setBlocked(true);
        setError({ code: 'CREATION_RECEIPT_REQUIRED', message: 'The host saved the project but did not return its exact project creation receipt. Select the saved project explicitly from the list or refresh before saving again.' });
        return;
      }
      if (hubId !== undefined && !result.state.hubs.find(hub => hub.id === hubId)?.projects.some(value => value.id === id)) {
        setBlocked(true);
        setError({ code: 'CREATED_PROJECT_UNAVAILABLE', message: 'The saved project is not available in the current list. Refresh and select the saved project explicitly before saving again.' });
        return;
      }
      onSaved(id);
    } catch (failure) {
      if (alive.current) setError(asProblem(failure));
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  }

  function cancel(): void {
    if (pending) return;
    generation.current++;
    onClose();
  }

  return { draft, detection, pending, picking, blocked, error, canBrowse: picker !== null && api !== undefined, change, browse, blurPath, save, cancel };
}
