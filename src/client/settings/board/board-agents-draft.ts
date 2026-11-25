import type { ModelSelection, Workflow, WorkflowAgent } from '../../../shared/types.js';
import { MAIN_AGENT_ID } from '../../../shared/types.js';
import { isDomainId } from '../../../domain/validation.js';

/** One agent other than the main one, as the Agents tab edits it. */
export interface AgentDraft {
  readonly id: string;
  readonly name: string;
  /** The preset identity; an empty string keeps the host default preset. */
  readonly preset: string;
  /** The route this agent asks for; absent inherits the main agent's model. */
  readonly model: ModelSelection | undefined;
  /** The document already authors this agent, so its identifier is a stable key. */
  readonly stored: boolean;
  /** The person edited the identifier, so the name no longer derives it. */
  readonly idTouched: boolean;
}

/** The whole agents draft: the main agent's choices and every other agent. */
export interface AgentsDraft {
  readonly mainName: string;
  readonly mainPreset: string;
  readonly mainModel: ModelSelection | undefined;
  readonly others: readonly AgentDraft[];
}

/** The display name a main agent the document does not author still has. */
export const DEFAULT_MAIN_AGENT_NAME = 'Main';

/**
 * The identifier a name suggests: lowercased, ASCII, hyphenated, and valid as a
 * document id. The person still edits it before the first save.
 */
export function agentIdFromName(name: string): string {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 256);
  if (slug.length === 0) return '';
  return /^[a-z0-9]/.test(slug) ? slug : 'agent-' + slug;
}

/** The draft a board opens with: authored agents, materializing the main's effective choices. */
export function agentsDraft(workflow: Workflow, effective: { preset?: string; model?: ModelSelection }): AgentsDraft {
  const main = (workflow.agents ?? []).find(agent => agent.id === MAIN_AGENT_ID);
  return {
    mainName: main?.name ?? DEFAULT_MAIN_AGENT_NAME,
    mainPreset: main?.preset ?? effective.preset ?? '',
    mainModel: main?.model ?? effective.model,
    others: (workflow.agents ?? [])
      .filter(agent => agent.id !== MAIN_AGENT_ID)
      .map(agent => ({ id: agent.id, name: agent.name, preset: agent.preset ?? '', model: agent.model, stored: true, idTouched: true })),
  };
}

/** The agents list one save writes: the main agent first, then the others in draft order. */
export function agentsFromDraft(draft: AgentsDraft): WorkflowAgent[] {
  const entries: WorkflowAgent[] = [{
    id: MAIN_AGENT_ID,
    name: draft.mainName.trim(),
    ...(draft.mainPreset.trim() === '' ? {} : { preset: draft.mainPreset.trim() }),
    ...(draft.mainModel === undefined ? {} : { model: { ...draft.mainModel } }),
  }];
  for (const agent of draft.others) {
    entries.push({
      id: agent.id.trim(),
      name: agent.name.trim(),
      ...(agent.preset.trim() === '' ? {} : { preset: agent.preset.trim() }),
      ...(agent.model === undefined ? {} : { model: { ...agent.model } }),
    });
  }
  return entries;
}

/** True when the draft authors something its baseline does not. */
export function agentsDraftChanged(draft: AgentsDraft, baseline: AgentsDraft): boolean {
  return JSON.stringify(agentsFromDraft(draft)) !== JSON.stringify(agentsFromDraft(baseline));
}

/** Every problem that stops the draft from being saved, named for its field. */
export function agentsDraftProblems(draft: AgentsDraft): Array<{ id: string; message: string }> {
  const problems: Array<{ id: string; message: string }> = [];
  if (draft.mainName.trim().length === 0) problems.push({ id: MAIN_AGENT_ID, message: 'The main agent needs a name.' });
  const seen = new Set<string>([MAIN_AGENT_ID]);
  for (const [index, agent] of draft.others.entries()) {
    const id = agent.id.trim();
    const key = id === '' ? 'agent-' + index : id;
    if (!isDomainId(id)) { problems.push({ id: key, message: 'An agent identifier must be a nonempty safe identifier.' }); continue; }
    if (seen.has(id)) { problems.push({ id: key, message: 'Two agents cannot share an identifier.' }); continue; }
    seen.add(id);
    if (agent.name.trim().length === 0) problems.push({ id: key, message: 'An agent needs a name.' });
  }
  return problems;
}
