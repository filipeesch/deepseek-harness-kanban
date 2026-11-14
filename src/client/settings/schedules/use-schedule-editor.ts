import { useEffect, useRef, useState } from 'react';
import type { ClientApi, HubSchedule, Problem, Project, ModelCatalog, ModelSelection } from '../../../shared/types.js';
import { asProblem } from '../../problem.js';
import type { RunCommand } from '../../ui.js';
import { useModelCatalog } from '../../model/use-model-catalog.js';
import {
  createScheduleDraft, editScheduleDraft, editScheduleDraftModel, editScheduleDraftModelMode, scheduleDraftDescription, scheduleDraftError, scheduleDraftOccurrences,
  toScheduleCommand, type ScheduleDraft,
} from './schedule-draft.js';

export interface ScheduleEditorController {
  draft: ScheduleDraft;
  pending: boolean;
  error: Problem | null;
  catalog: ModelCatalog | null;
  catalogError: Problem | null;
  description: string | null;
  occurrences: string[];
  change(field: keyof ScheduleDraft, value: string | boolean): void;
  /** Move the draft onto one model route, or back to the deployment default. */
  applyModel(selection: ModelSelection | undefined): void;
  /** Choose the host default or a specific route without losing an entered route. */
  setModelMode(mode: 'default' | 'custom'): void;
  /** Re-read the host model catalog. */
  reloadCatalog(): void;
  save(): Promise<void>;
  cancel(): void;
}

export function useScheduleEditor({ api, hubId, schedule, expectedRevision, projects, run, onSaved, onClose }: {
  api?: ClientApi;
  hubId?: string;
  schedule?: HubSchedule;
  expectedRevision?: number;
  projects: readonly Project[];
  run: RunCommand;
  onSaved: () => void;
  onClose: () => void;
}): ScheduleEditorController {
  const [draft, setDraft] = useState<ScheduleDraft>(() => createScheduleDraft(schedule));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const catalogState = useModelCatalog(api);
  const catalog = catalogState.catalog;
  const catalogError = catalogState.error;
  const alive = useRef(true);
  const saving = useRef(false);
  /** The Hub revision the draft was read from; a later feed update must not widen the write. */
  const revisionAtOpen = useRef(expectedRevision);
  useEffect(() => () => { alive.current = false; }, []);
  function change(field: keyof ScheduleDraft, value: string | boolean): void {
    if (pending) return;
    setError(null);
    setDraft(previous => editScheduleDraft(previous, field, value));
  }

  function applyModel(selection: ModelSelection | undefined): void {
    if (pending) return;
    setError(null);
    setDraft(previous => editScheduleDraftModel(previous, selection));
  }

  function setModelMode(mode: 'default' | 'custom'): void {
    if (pending) return;
    setError(null);
    setDraft(previous => editScheduleDraftModelMode(previous, mode));
  }

  const description = scheduleDraftDescription(draft);
  const occurrences = scheduleDraftOccurrences(draft);
  const invalid = scheduleDraftError(draft, projects, catalog);

  async function save(): Promise<void> {
    if (pending || saving.current) return;
    if (invalid !== null) { setError({ code: 'INVALID_SCHEDULE', message: invalid }); return; }
    if (hubId === undefined) { setError({ code: 'HUB_REQUIRED', message: 'Select a Hub before saving a schedule.' }); return; }
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await run(toScheduleCommand(draft, hubId, revisionAtOpen.current));
      if (alive.current) onSaved();
    } catch (failure) {
      if (alive.current) setError(asProblem(failure));
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  }

  function cancel(): void {
    if (pending) return;
    onClose();
  }

  return { draft, pending, error, catalog, catalogError, description, occurrences, change, applyModel, setModelMode, reloadCatalog: catalogState.reload, save, cancel };
}
