import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { KanbanError } from '../shared/errors.js';
import type { ScheduleModelCatalog, ScheduleModelSelection } from '../shared/types.js';

/** Host model catalog and session-only model application for schedules. */
export interface ScheduleModelPort {
  /** The selectable providers and the deployment default; cached briefly by the host. */
  catalog(refresh?: boolean): Promise<ScheduleModelCatalog>;
  /** Apply one selection to a conversation only; throws when the host cannot do that safely. */
  apply(sessionId: string, selection: ScheduleModelSelection): Promise<void>;
}

export interface ScheduleModelPortOptions {
  /** How long one catalog read satisfies later editor opens. */
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;

function project(catalog: ModelCatalog): ScheduleModelCatalog {
  return {
    default: {
      provider: catalog.default.provider,
      model: catalog.default.model,
      ...(catalog.default.reasoningEffort === undefined ? {} : { reasoningEffort: catalog.default.reasoningEffort }),
    },
    providers: catalog.groups.map(group => ({
      id: group.id, name: group.name,
      models: group.models.map(model => ({
        id: model.id, name: model.name,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(model.reasoning === undefined ? {} : {
          reasoning: {
            efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
            ...(model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
          },
        }),
      })),
    })),
    failures: catalog.failures.map(failure => ({ id: failure.id, name: failure.name, message: failure.message })),
  };
}

/** The host's session-only selection face; the 0.2.2 Agent exposes it publicly. */
interface SessionModelFace { readonly model?: { select?: (selection: ScheduleModelSelection) => void } }

/**
 * Read the live model catalog and apply a schedule's model to one conversation.
 *
 * The plugin never writes the installation default. It validates the route and
 * its catalog membership, resumes the live Agent, and installs the selection
 * through the Agent's session-scoped model face, which records it on the Session
 * without touching the default. A host without that face fails the occurrence
 * before any prompt is sent.
 */
export function createScheduleModelPort(ctx: Context, options: ScheduleModelPortOptions = {}): ScheduleModelPort {
  let cache: { at: number; value: ScheduleModelCatalog } | undefined;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  return {
    async catalog(refresh = false) {
      if (!refresh && cache !== undefined && now() - cache.at < ttl) return cache.value;
      const value = project(await ctx.sessionController.modelCatalog());
      cache = { at: now(), value };
      return value;
    },
    async apply(sessionId, selection) {
      const resolved = await ctx.llm.resolveCallConfig({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
      });
      const chosen: ScheduleModelSelection = {
        provider: resolved.provider,
        model: resolved.model,
        ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
      };
      const catalog = await ctx.sessionController.modelCatalog();
      const available = catalog.groups.some(group => group.id === chosen.provider && group.models.some(model => model.id === chosen.model));
      if (!available) throw new KanbanError('SESSION_MODEL_UNAVAILABLE', 'The stored model is no longer available in the host catalog.');
      const result = await ctx.sessionController.resolveAgent(SessionId(sessionId));
      if ('error' in result) throw result.error;
      const face = result.agent as unknown as SessionModelFace;
      if (typeof face.model?.select !== 'function') {
        throw new KanbanError('SESSION_MODEL_SELECTION_UNSUPPORTED', 'This host cannot apply a model to one conversation without changing the installation default.');
      }
      face.model.select(chosen);
    },
  };
}
