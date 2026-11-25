import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Board, ClientApi, HubState, ModelSelection, Problem } from '../../../shared/types.js';
import { effectiveBoardModel } from '../../../domain/board-preset.js';
import { effectiveBoardPreset } from '../../../domain/board-preset.js';
import { writeBoardAgentPresetField } from '../../../domain/board-agent-preset-field.js';
import { writeBoardAgentsField } from '../../../domain/board-agents-field.js';
import { writeBoardModelField } from '../../../domain/board-model-field.js';
import { agentIdFromName, agentsDraft, agentsDraftChanged, agentsDraftProblems, agentsFromDraft, type AgentDraft, type AgentsDraft } from './board-agents-draft.js';
import { asProblem } from '../../problem.js';
import type { RunCommand } from '../../ui.js';
import { useModelCatalog, type ModelCatalogState } from '../../model/use-model-catalog.js';
import { useAgentPresetRoster, type RosterState } from '../../agent-preset-roster.js';
import type { AgentPresetPort } from '../../agent-preset-port.js';
import type { AgentPresetTranslate } from '../../agent-preset-context.js';

/** One row the person can expand; the main agent is pinned first. */
export type AgentRowKey = 'main' | number;

export interface BoardAgentsController {
  readonly draft: AgentsDraft;
  readonly problems: ReadonlyArray<{ readonly id: string; readonly message: string }>;
  /** The stages that name each agent, by agent id, which the removal reason lists. */
  readonly stageUsage: ReadonlyMap<string, readonly string[]>;
  readonly expanded: ReadonlySet<AgentRowKey>;
  /** Whether the main agent asks for a specific route instead of the host default. */
  readonly mainModelMode: 'host' | 'specific';
  /** The specialist rows that ask for a specific route instead of the main agent's. */
  readonly specificAgents: ReadonlySet<number>;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly canSave: boolean;
  readonly pending: boolean;
  readonly saved: boolean;
  readonly error: Problem | null;
  readonly catalog: ModelCatalogState;
  readonly roster: RosterState;
  readonly translate: AgentPresetTranslate | undefined;
  toggle(key: AgentRowKey): void;
  chooseMainModelMode(mode: 'host' | 'specific'): void;
  chooseAgentModelMode(index: number, mode: 'inherit' | 'specific'): void;
  changeMainName(value: string): void;
  changeMainPreset(value: string): void;
  changeMainModel(value: ModelSelection | undefined): void;
  addAgent(): void;
  removeAgent(index: number): void;
  changeAgent(index: number, patch: { name?: string; id?: string; preset?: string; model?: ModelSelection | undefined }): void;
  retryPresets(): void;
  save(): Promise<void>;
}

/**
 * The Agents tab's one draft: the board's agents, their presets and their models.
 * Saving writes the authored `agents` section and retires the legacy root fields,
 * so the first save of this surface is also the board's migration.
 */
export function useBoardAgents(options: {
  hub: HubState;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  yaml: string;
  baseRevision: number;
  workflowEditing: boolean;
  presetPort: AgentPresetPort | null;
  translate?: AgentPresetTranslate;
}): BoardAgentsController {
  const { hub, board, run, api, yaml, baseRevision, workflowEditing, presetPort, translate } = options;
  const baseline = useMemo(
    () => agentsDraft(board.workflow, { preset: effectiveBoardPreset(board).preset, model: effectiveBoardModel(board.workflow) }),
    [board],
  );
  const baselineKey = JSON.stringify(baseline);
  const [draft, setDraft] = useState<AgentsDraft>(() => baseline);
  const [expanded, setExpanded] = useState<ReadonlySet<AgentRowKey>>(() => new Set());
  const [mainSpecific, setMainSpecific] = useState(() => baseline.mainModel !== undefined);
  const [specificAgents, setSpecificAgents] = useState<ReadonlySet<number>>(() => new Set(baseline.others.flatMap((agent, index) => agent.model === undefined ? [] : [index])));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const catalog = useModelCatalog(api);
  const roster = useAgentPresetRoster(presetPort);

  const dirty = agentsDraftChanged(draft, baseline);
  const problems = agentsDraftProblems(draft);
  // A specific main model needs a route; the host default needs none.
  const valid = problems.length === 0 && (!mainSpecific || draft.mainModel !== undefined);
  const canSave = dirty && valid && !pending && !workflowEditing;
  const stageUsage = useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const column of board.workflow.columns) {
      if (column.agent === undefined) continue;
      const stages = usage.get(column.agent) ?? [];
      stages.push(column.name);
      usage.set(column.agent, stages);
    }
    return usage as ReadonlyMap<string, readonly string[]>;
  }, [board]);

  // A pristine draft follows the board; a dirty one keeps the person's work until it is
  // saved. Only the saved document feeds this sync, never the catalog or the roster.
  useEffect(() => {
    if (dirty) return;
    setDraft(baseline);
    setExpanded(new Set());
    setMainSpecific(baseline.mainModel !== undefined);
    setSpecificAgents(new Set(baseline.others.flatMap((agent, index) => agent.model === undefined ? [] : [index])));
  }, [baselineKey, dirty]);

  const toggle = useCallback((key: AgentRowKey) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const reset = useCallback(() => { setSaved(false); setError(null); }, []);
  const changeMainName = useCallback((value: string) => { setDraft(current => ({ ...current, mainName: value })); reset(); }, [reset]);
  const changeMainPreset = useCallback((value: string) => { setDraft(current => ({ ...current, mainPreset: value })); reset(); }, [reset]);
  const changeMainModel = useCallback((value: ModelSelection | undefined) => { setDraft(current => ({ ...current, mainModel: value })); reset(); }, [reset]);
  const chooseAgentModelMode = useCallback((index: number, mode: 'inherit' | 'specific') => {
    setSpecificAgents(current => {
      const next = new Set(current);
      if (mode === 'specific') next.add(index); else next.delete(index);
      return next;
    });
    if (mode === 'inherit') setDraft(current => ({ ...current, others: current.others.map((agent, position) => position === index ? { ...agent, model: undefined } : agent) }));
    reset();
  }, [reset]);
  const chooseMainModelMode = useCallback((mode: 'host' | 'specific') => {
    setMainSpecific(mode === 'specific');
    if (mode === 'host') setDraft(current => ({ ...current, mainModel: undefined }));
    reset();
  }, [reset]);
  const addAgent = useCallback(() => {
    setDraft(current => {
      const index = current.others.length;
      setExpanded(open => new Set(open).add(index));
      return { ...current, others: [...current.others, { id: '', name: '', preset: '', model: undefined, stored: false, idTouched: false }] };
    });
    reset();
  }, [reset]);
  const removeAgent = useCallback((index: number) => {
    setDraft(current => ({ ...current, others: current.others.filter((_, position) => position !== index) }));
    setExpanded(current => { const next = new Set<AgentRowKey>(); for (const key of current) if (typeof key === 'number' && key < index) next.add(key); return next; });
    setSpecificAgents(current => new Set([...current].flatMap(position => position === index ? [] : position < index ? [position] : [position - 1])));
    reset();
  }, [reset]);
  const changeAgent = useCallback((index: number, patch: { name?: string; id?: string; preset?: string; model?: ModelSelection | undefined }) => {
    setDraft(current => ({
      ...current,
      others: current.others.map((agent, position) => {
        if (position !== index) return agent;
        const next: AgentDraft = { ...agent, ...patch };
        // The identifier follows the name until the person edits it or the document
        // stores the agent; after the first save it is a key, not a second name.
        const derived = patch.name !== undefined && !agent.idTouched && !agent.stored;
        return {
          ...next,
          ...(derived ? { id: agentIdFromName(next.name) } : {}),
          ...(patch.id === undefined ? {} : { idTouched: true }),
        };
      }),
    }));
    reset();
  }, [reset]);

  async function save(): Promise<void> {
    if (!canSave || pending) return;
    setPending(true); setError(null);
    try {
      // The authored agents section replaces the legacy root choices: the main agent's
      // preset and model are materialized here, and the root fields stop deciding.
      let nextYaml = writeBoardModelField(yaml, undefined);
      nextYaml = writeBoardAgentPresetField(nextYaml, undefined);
      nextYaml = writeBoardAgentsField(nextYaml, agentsFromDraft(draft));
      await run({ type: 'board.workflow.save', hubId: hub.id, boardId: board.id, yaml: nextYaml, expectedRevision: baseRevision });
      setSaved(true);
    } catch (failure) {
      setError(asProblem(failure));
    } finally {
      setPending(false);
    }
  }

  return {
    draft, problems, stageUsage, expanded, mainModelMode: mainSpecific ? 'specific' : 'host', specificAgents, dirty, valid, canSave, pending, saved, error,
    catalog, roster: roster.state, translate,
    toggle, chooseMainModelMode, chooseAgentModelMode, changeMainName, changeMainPreset, changeMainModel,
    addAgent, removeAgent, changeAgent, retryPresets: roster.retry, save,
  };
}
