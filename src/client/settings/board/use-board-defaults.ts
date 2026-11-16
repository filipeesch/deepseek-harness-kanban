import { useCallback, useEffect, useState } from 'react';
import type { Board, ClientApi, HubState, ModelSelection, Problem } from '../../../shared/types.js';
import { modelIsAvailable, modelSelectionKey } from '../../../domain/model-preference.js';
import { writeBoardDefaultsField, type BoardMcpSelection } from '../../../domain/board-defaults-field.js';
import { mcpAllowlistEntry, mcpAllowlistText } from '../../../domain/mcp-allowlist.js';
import { asProblem } from '../../problem.js';
import type { RunCommand } from '../../ui.js';
import { useModelCatalog, type ModelCatalogState } from '../../model/use-model-catalog.js';
import { useAgentPresetRoster, type RosterState } from '../../agent-preset-roster.js';
import { useMcpServers, type McpServersState } from './use-mcp-servers.js';
import type { AgentPresetPort } from '../../agent-preset-port.js';
import type { AgentPresetTranslate } from '../../agent-preset-context.js';

export type BoardModelMode = 'host' | 'specific';
export type BoardMcpMode = 'all' | 'selected';

export interface BoardDefaultsController {
  readonly mode: BoardModelMode;
  readonly selection: ModelSelection | undefined;
  readonly preset: string | undefined;
  readonly storedPreset: string | undefined;
  readonly storedModel: ModelSelection | undefined;
  readonly mcpMode: BoardMcpMode;
  readonly mcpEntries: readonly string[];
  readonly storedMcp: readonly string[] | undefined;
  readonly knownMcpServers: readonly string[];
  readonly mcpEntryProblem: string | null;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly canSave: boolean;
  readonly pending: boolean;
  readonly saved: boolean;
  readonly error: Problem | null;
  readonly catalog: ModelCatalogState;
  readonly roster: RosterState;
  readonly mcpServers: McpServersState;
  readonly translate: AgentPresetTranslate | undefined;
  /** The stored route is not among the models the host reports. */
  readonly storedModelMissing: boolean;
  chooseHostModel(): void;
  chooseSpecificModel(): void;
  chooseModel(selection: ModelSelection): void;
  choosePreset(preset: string | undefined): void;
  chooseMcpMode(mode: BoardMcpMode): void;
  toggleMcpServer(server: string): void;
  addMcpEntry(value: string): void;
  removeMcpEntry(entry: string): void;
  retryPresets(): void;
  save(): Promise<void>;
}

/** Whether an entry names the given server, either alone or with one of its tools. */
function entryServer(entry: string): string {
  return entry.split('/')[0]!;
}

/**
 * Everything the Defaults panel needs to edit and save the board defaults as one
 * draft: the model, the agent preset, and the MCP allowlist.
 */
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
  const storedMcp = board.workflow.mcp;
  const storedMode: BoardModelMode = storedModel === undefined ? 'host' : 'specific';
  const storedKey = modelSelectionKey(storedModel);
  const storedMcpMode: BoardMcpMode = storedMcp === undefined ? 'all' : 'selected';
  const storedMcpKey = storedMcp === undefined ? 'all' : 'selected:' + storedMcp.join(',');

  const [mode, setMode] = useState<BoardModelMode>(storedMode);
  const [selection, setSelection] = useState<ModelSelection | undefined>(storedModel);
  const [preset, setPreset] = useState<string | undefined>(storedPreset);
  const [mcpMode, setMcpMode] = useState<BoardMcpMode>(storedMcpMode);
  const [mcpEntries, setMcpEntries] = useState<string[]>([...(storedMcp ?? [])]);
  const [mcpEntryProblem, setMcpEntryProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Problem | null>(null);

  const nextModel = mode === 'specific' ? selection : undefined;
  const modelDirty = mode !== storedMode || modelSelectionKey(nextModel) !== storedKey;
  const presetDirty = (preset ?? undefined) !== (storedPreset ?? undefined);
  const nextMcpKey = mcpMode === 'all' ? 'all' : 'selected:' + mcpEntries.join(',');
  const mcpDirty = nextMcpKey !== storedMcpKey;
  const dirty = modelDirty || presetDirty || mcpDirty;
  const entriesValid = mcpEntries.every(entry => mcpAllowlistEntry(entry) !== undefined);
  const valid = (mode === 'host' || selection !== undefined) && entriesValid;
  const canSave = dirty && valid && !pending && !workflowEditing;
  const catalog = useModelCatalog(api);
  const roster = useAgentPresetRoster(presetPort);
  const mcpServers = useMcpServers(api);
  const storedModelMissing = storedModel !== undefined && catalog.catalog !== null && !modelIsAvailable(catalog.catalog, storedModel);
  // Every server the host reports stays selectable, and a stored server the host no
  // longer reports is presented too, so the control never hides what it keeps.
  const knownMcpServers = [...new Set([...mcpServers.servers, ...mcpEntries.map(entryServer), ...(storedMcp ?? []).map(entryServer)])].sort();

  // A pristine draft follows the board; a dirty one keeps the person's work until it
  // is saved. Only the fields of the saved document feed this sync, never the catalog
  // or roster, so an unavailable read can never clear a stored default.
  useEffect(() => {
    if (dirty) return;
    setMode(storedMode);
    setSelection(storedModel);
    setPreset(storedPreset);
    setMcpMode(storedMcpMode);
    setMcpEntries([...(storedMcp ?? [])]);
    setMcpEntryProblem(null);
  }, [storedKey, storedPreset, storedMcpKey, dirty]);

  const chooseHostModel = useCallback(() => { setMode('host'); setSaved(false); setError(null); }, []);
  const chooseSpecificModel = useCallback(() => { setMode('specific'); setSaved(false); setError(null); }, []);
  const chooseModel = useCallback((value: ModelSelection) => { setMode('specific'); setSelection(value); setSaved(false); setError(null); }, []);
  const choosePreset = useCallback((value: string | undefined) => { setPreset(value); setSaved(false); setError(null); }, []);
  const chooseMcpMode = useCallback((value: BoardMcpMode) => { setMcpMode(value); setMcpEntryProblem(null); setSaved(false); setError(null); }, []);
  const toggleMcpServer = useCallback((server: string) => {
    setMcpMode('selected');
    setSaved(false);
    setError(null);
    setMcpEntries(current => {
      const others = current.filter(entry => entryServer(entry) !== server);
      // A checked server means the whole server; unchecking drops it with any of its
      // single-tool entries, and checking replaces those entries with the whole server.
      return current.includes(server) ? others : [...others, server];
    });
  }, []);
  const addMcpEntry = useCallback((value: string) => {
    const parsed = mcpAllowlistEntry(value);
    if (parsed === undefined) {
      setMcpEntryProblem('Enter a server name, or a server and one tool as server/tool.');
      return;
    }
    const entry = mcpAllowlistText(parsed);
    setMcpEntryProblem(null);
    setMcpMode('selected');
    setSaved(false);
    setError(null);
    setMcpEntries(current => current.includes(entry) ? current : [...current, entry]);
  }, []);
  const removeMcpEntry = useCallback((entry: string) => {
    setSaved(false);
    setError(null);
    setMcpEntries(current => current.filter(value => value !== entry));
  }, []);
  const retryPresets = roster.retry;

  async function save(): Promise<void> {
    if (!canSave || pending) return;
    setPending(true); setError(null);
    const mcp: BoardMcpSelection = mcpMode === 'all' ? { mode: 'all' } : { mode: 'selected', entries: mcpEntries };
    try {
      await run({
        type: 'board.workflow.save', hubId: hub.id, boardId: board.id,
        yaml: writeBoardDefaultsField(yaml, { model: mode === 'specific' ? selection : undefined, preset, mcp }),
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
    mode, selection, preset, storedPreset, storedModel, mcpMode, mcpEntries, storedMcp, knownMcpServers, mcpEntryProblem,
    dirty, valid, canSave, pending, saved, error,
    catalog, roster: roster.state, mcpServers, translate, storedModelMissing,
    chooseHostModel, chooseSpecificModel, chooseModel, choosePreset, chooseMcpMode, toggleMcpServer, addMcpEntry, removeMcpEntry, retryPresets, save,
  };
}
