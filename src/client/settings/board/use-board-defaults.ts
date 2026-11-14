import { useCallback, useEffect, useState } from 'react';
import type { Board, ClientApi, HubState, ModelSelection, Problem } from '../../../shared/types.js';
import { modelIsAvailable, modelSelectionKey } from '../../../domain/model-preference.js';
import { writeBoardDefaultsField } from '../../../domain/board-defaults-field.js';
import { asProblem } from '../../problem.js';
import type { RunCommand } from '../../ui.js';
import { useModelCatalog, type ModelCatalogState } from '../../model/use-model-catalog.js';
import { useAgentPresetRoster, type RosterState } from '../../agent-preset-roster.js';
import type { AgentPresetPort } from '../../agent-preset-port.js';
import type { AgentPresetTranslate } from '../../agent-preset-context.js';

export type BoardModelMode = 'host' | 'specific';

export interface BoardDefaultsController {
  readonly mode: BoardModelMode;
  readonly selection: ModelSelection | undefined;
  readonly preset: string | undefined;
  readonly storedPreset: string | undefined;
  readonly storedModel: ModelSelection | undefined;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly canSave: boolean;
  readonly pending: boolean;
  readonly saved: boolean;
  readonly error: Problem | null;
  readonly catalog: ModelCatalogState;
  readonly roster: RosterState;
  readonly translate: AgentPresetTranslate | undefined;
  /** The stored route is not among the models the host reports. */
  readonly storedModelMissing: boolean;
  chooseHostModel(): void;
  chooseSpecificModel(): void;
  chooseModel(selection: ModelSelection): void;
  choosePreset(preset: string | undefined): void;
  retryPresets(): void;
  save(): Promise<void>;
}

/** Everything the Defaults panel needs to edit and save both board defaults as one draft. */
export function useBoardDefaults(options: {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  yaml: string;
  baseRevision: number;
  workflowEditing: boolean;
  presetPort: AgentPresetPort | null;
  translate?: AgentPresetTranslate;
}): BoardDefaultsController {
  const { hub, board, run, api, yaml, baseRevision, workflowEditing, presetPort, translate } = options;
  const storedModel = board.workflow.model;
  const storedPreset = board.workflow.agentPreset;
  const storedMode: BoardModelMode = storedModel === undefined ? 'host' : 'specific';
  const storedKey = modelSelectionKey(storedModel);

  const [mode, setMode] = useState<BoardModelMode>(storedMode);
  const [selection, setSelection] = useState<ModelSelection | undefined>(storedModel);
  const [preset, setPreset] = useState<string | undefined>(storedPreset);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Problem | null>(null);

  const nextModel = mode === 'specific' ? selection : undefined;
  const modelDirty = mode !== storedMode || modelSelectionKey(nextModel) !== storedKey;
  const presetDirty = (preset ?? undefined) !== (storedPreset ?? undefined);
  const dirty = modelDirty || presetDirty;
  const valid = mode === 'host' || selection !== undefined;
  const canSave = dirty && valid && !pending && !workflowEditing;
  const catalog = useModelCatalog(api);
  const roster = useAgentPresetRoster(presetPort);
  const storedModelMissing = storedModel !== undefined && catalog.catalog !== null && !modelIsAvailable(catalog.catalog, storedModel);

  // A pristine draft follows the board; a dirty one keeps the person's work until it
  // is saved. Only the fields of the saved document feed this sync, never the catalog
  // or roster, so an unavailable read can never clear a stored default.
  useEffect(() => {
    if (dirty) return;
    setMode(storedMode);
    setSelection(storedModel);
    setPreset(storedPreset);
  }, [storedKey, storedPreset, dirty]);

  const chooseHostModel = useCallback(() => { setMode('host'); setSaved(false); setError(null); }, []);
  const chooseSpecificModel = useCallback(() => { setMode('specific'); setSaved(false); setError(null); }, []);
  const chooseModel = useCallback((value: ModelSelection) => { setMode('specific'); setSelection(value); setSaved(false); setError(null); }, []);
  const choosePreset = useCallback((value: string | undefined) => { setPreset(value); setSaved(false); setError(null); }, []);
  const retryPresets = roster.retry;

  async function save(): Promise<void> {
    if (!canSave || pending) return;
    setPending(true); setError(null);
    try {
      await run({
        type: 'board.workflow.save', hubId: hub.id, boardId: board.id,
        yaml: writeBoardDefaultsField(yaml, { model: mode === 'specific' ? selection : undefined, preset }),
        expectedRevision: baseRevision,
      });
      setSaved(true);
    } catch (failure) {
      setError(asProblem(failure));
    } finally {
      setPending(false);
    }
  }

  return {
    mode, selection, preset, storedPreset, storedModel, dirty, valid, canSave, pending, saved, error,
    catalog, roster: roster.state, translate, storedModelMissing,
    chooseHostModel, chooseSpecificModel, chooseModel, choosePreset, retryPresets, save,
  };
}
