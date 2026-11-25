import { useCallback, useEffect, useState } from 'react';
import type { Board, ClientApi, HubState, Problem } from '../../../shared/types.js';
import { writeBoardMcpField } from '../../../domain/board-mcp-field.js';
import { mcpAllowlistEntry, mcpAllowlistText } from '../../../domain/mcp-allowlist.js';
import { asProblem } from '../../problem.js';
import type { RunCommand } from '../../ui.js';
import { useMcpServers, type McpServersState } from './use-mcp-servers.js';

export type BoardMcpMode = 'all' | 'selected';

export interface BoardMcpController {
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
  readonly mcpServers: McpServersState;
  chooseMcpMode(mode: BoardMcpMode): void;
  toggleMcpServer(server: string): void;
  addMcpEntry(value: string): void;
  removeMcpEntry(entry: string): void;
  save(): Promise<void>;
}

/** Whether an entry names the given server, either alone or with one of its tools. */
function entryServer(entry: string): string {
  return entry.split('/')[0]!;
}

/**
 * The Defaults tab's one draft: the board's MCP tool allowlist. The agents — and with
 * them the board default preset and model — live in the Agents tab, which owns their
 * migration, so this save never rewrites the document's shape.
 */
export function useBoardMcpDefaults(options: {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  yaml: string;
  baseRevision: number;
  workflowEditing: boolean;
}): BoardMcpController {
  const { hub, board, run, api, yaml, baseRevision, workflowEditing } = options;
  const storedMcp = board.workflow.mcp;
  const storedMcpMode: BoardMcpMode = storedMcp === undefined ? 'all' : 'selected';
  const storedMcpKey = storedMcp === undefined ? 'all' : 'selected:' + storedMcp.join(',');
  const [mcpMode, setMcpMode] = useState<BoardMcpMode>(storedMcpMode);
  const [mcpEntries, setMcpEntries] = useState<string[]>([...(storedMcp ?? [])]);
  const [mcpEntryProblem, setMcpEntryProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const nextMcpKey = mcpMode === 'all' ? 'all' : 'selected:' + mcpEntries.join(',');
  const dirty = nextMcpKey !== storedMcpKey;
  const entriesValid = mcpEntries.every(entry => mcpAllowlistEntry(entry) !== undefined);
  const valid = entriesValid;
  const canSave = dirty && valid && !pending && !workflowEditing;
  const mcpServers = useMcpServers(api);
  const knownMcpServers = [...new Set([...mcpServers.servers, ...mcpEntries.map(entryServer), ...(storedMcp ?? []).map(entryServer)])].sort();

  useEffect(() => {
    if (dirty) return;
    setMcpMode(storedMcpMode);
    setMcpEntries([...(storedMcp ?? [])]);
    setMcpEntryProblem(null);
  }, [storedMcpKey, dirty]);

  const chooseMcpMode = useCallback((value: BoardMcpMode) => { setMcpMode(value); setMcpEntryProblem(null); setSaved(false); setError(null); }, []);
  const toggleMcpServer = useCallback((server: string) => {
    setMcpMode('selected');
    setSaved(false);
    setError(null);
    setMcpEntries(current => {
      const others = current.filter(entry => entryServer(entry) !== server);
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

  async function save(): Promise<void> {
    if (!canSave || pending) return;
    setPending(true); setError(null);
    try {
      await run({
        type: 'board.workflow.save', hubId: hub.id, boardId: board.id,
        yaml: writeBoardMcpField(yaml, mcpMode === 'all' ? undefined : mcpEntries),
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
    mcpMode, mcpEntries, storedMcp, knownMcpServers, mcpEntryProblem, dirty, valid, canSave, pending, saved, error, mcpServers,
    chooseMcpMode, toggleMcpServer, addMcpEntry, removeMcpEntry, save,
  };
}
