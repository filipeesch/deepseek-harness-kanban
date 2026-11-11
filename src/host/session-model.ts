import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog as HostModelCatalog } from '@deepseek-ai/dsh-api-session-controller';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ModelApplyReason, ModelCatalog, ModelSelection } from '../shared/types.js';

/**
 * The outcome of one model application. The port states what happened and the
 * caller decides what it costs: a schedule's own model fails its occurrence,
 * while a board default that cannot be honoured leaves the conversation on the
 * deployment model and only informs the person who opens it.
 *
 * The reason vocabulary is the shared one, because the same value travels to the
 * client on the creation receipt; a second copy here would be free to drift.
 */
export type ModelApplyOutcome =
  | { applied: true }
  | { applied: false; reason: ModelApplyReason; message: string; inUse?: ModelSelection };

/** The one mechanism by which the plugin puts a conversation on a model. */
export interface SessionModelPort {
  /** The selectable providers and the deployment default; cached briefly by the host. */
  catalog(refresh?: boolean): Promise<ModelCatalog>;
  /**
   * Apply one selection to exactly one conversation, never to the installation
   * default. It never rejects: every refusal — an unknown route, a host without a
   * per-conversation face, or a host that could not be asked at all — comes back as
   * an outcome with its reason, so each caller chooses the cost of that reason
   * instead of catching it. Only `catalog` may reject, and its callers read that as
   * "unknown", never as "unavailable".
   */
  apply(sessionId: string, selection: ModelSelection): Promise<ModelApplyOutcome>;
}

export interface SessionModelPortOptions {
  /** How long one catalog read satisfies later editor opens. */
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;
const UNAVAILABLE = 'The stored model is no longer available in the host catalog.';
const UNSUPPORTED = 'This host cannot apply a model to one conversation without changing the installation default.';
const FAILED = 'The host could not apply the stored model to this conversation.';

/** What the host said when it refused, or a standing sentence when it said nothing. */
function hostMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : FAILED;
}

function project(catalog: HostModelCatalog): ModelCatalog {
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

/** The host's session-only selection face; the Agent exposes it publicly. */
interface SessionModelFace { readonly model?: { select?: (selection: ModelSelection) => void } }

/**
 * Read the live model catalog and put one conversation on a model.
 *
 * The plugin never writes the installation default. It validates the route and
 * its catalog membership, resumes the live Agent, and installs the selection
 * through the Agent's session-scoped model face, which records the choice on the
 * Session alone. The host's own `selectModel` command also saves the choice as
 * the deployment default, which the plugin must never do, so it goes through the
 * Agent face instead. A host without that face reports `unsupported`.
 */
export function createSessionModelPort(ctx: Context, options: SessionModelPortOptions = {}): SessionModelPort {
  let cache: { at: number; value: ModelCatalog } | undefined;
  let inFlight: Promise<ModelCatalog> | undefined;
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  /**
   * One host read at a time. The board form and the first-execution preparation can
   * ask in the same tick, and two reads of the same moment answering in either order
   * is one catalog too many. A refresh is deliberately not coalesced: whoever asked
   * for fresh data gets a read that started after they asked for it.
   */
  function readCatalog(refresh = false): Promise<ModelCatalog> {
    if (!refresh && inFlight !== undefined) return inFlight;
    if (!refresh && cache !== undefined && now() - cache.at < ttl) return Promise.resolve(cache.value);
    const read = ctx.sessionController.modelCatalog().then(value => {
      const projected = project(value);
      cache = { at: now(), value: projected };
      return projected;
    });
    inFlight = read;
    // Whoever finishes last may not clear a read that started after it, and a failed
    // read must leave nothing behind: the next caller retries instead of inheriting
    // an unreachable host.
    void read.catch(() => undefined).then(() => { if (inFlight === read) inFlight = undefined; });
    return read;
  }
  /** The route a conversation falls back to; unknown when the catalog itself cannot be read. */
  async function deploymentDefault(): Promise<{ inUse: ModelSelection } | Record<string, never>> {
    try { return { inUse: (await readCatalog()).default }; }
    catch { return {}; }
  }
  /** The one refusal path that is a fact about the route rather than about the host. */
  async function unavailable(): Promise<ModelApplyOutcome> {
    return { applied: false, reason: 'unavailable', message: UNAVAILABLE, ...(await deploymentDefault()) };
  }
  /** What applying looks like when every host call answers. */
  async function select(sessionId: string, selection: ModelSelection): Promise<ModelApplyOutcome> {
    let resolved: { provider: string; model: string; reasoningEffort?: string };
    try {
      resolved = await ctx.llm.resolveCallConfig({
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
      });
    } catch {
      // A route this host cannot name, an effort it does not advertise, and any
      // other refusal to resolve it all mean the same thing to a caller.
      return unavailable();
    }
    const chosen: ModelSelection = {
      provider: resolved.provider,
      model: resolved.model,
      ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
    };
    const catalog = await ctx.sessionController.modelCatalog();
    const available = catalog.groups.some(group => group.id === chosen.provider && group.models.some(model => model.id === chosen.model));
    if (!available) return { applied: false, reason: 'unavailable', message: UNAVAILABLE, inUse: project(catalog).default };
    const result = await ctx.sessionController.resolveAgent(SessionId(sessionId));
    if ('error' in result) {
      // The host reports a refusal as a plain `{ code, message }`, not an Error, so
      // saying what it said takes one look at the shape rather than stringifying it.
      const refusal = result.error as { code?: unknown; message?: unknown } | undefined;
      const message = typeof refusal?.message === 'string' && refusal.message.trim() !== ''
        ? refusal.message
        : `The host could not resolve this conversation (code ${String(refusal?.code ?? 'unknown')}).`;
      throw new Error(message);
    }
    const face = result.agent as unknown as SessionModelFace;
    if (typeof face.model?.select !== 'function') return { applied: false, reason: 'unsupported', message: UNSUPPORTED, inUse: project(catalog).default };
    face.model.select(chosen);
    return { applied: true };
  }
  return {
    catalog: readCatalog,
    async apply(sessionId, selection) {
      try {
        return await select(sessionId, selection);
      } catch (error) {
        // A broken catalog, an unreachable session, and a refused selection are
        // not the caller's exceptions to catch. They come back as a reason, so
        // the schedule fails its occurrence and the board default falls back
        // without either of them needing a second, undocumented failure channel.
        return { applied: false, reason: 'failed', message: hostMessage(error), ...(await deploymentDefault()) };
      }
    },
  };
}
