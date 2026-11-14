import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { PresetApplyReason } from '../shared/types.js';

/**
 * The outcome of one preset application. The port states what happened and the
 * caller decides what it costs: an explicit card selection reports its failure
 * in the drawer, while a board default that cannot be honoured leaves the
 * conversation on the host default preset and informs the person who opens it.
 */
export type PresetApplyOutcome =
  | { applied: true }
  | { applied: false; reason: PresetApplyReason };

/** The one mechanism by which the plugin puts a conversation on an agent preset. */
export interface SessionPresetPort {
  /**
   * Select one preset for exactly one blank conversation, before its first turn.
   * It never rejects: every refusal comes back as an outcome with its reason, so
   * each caller chooses the cost of that reason instead of catching it.
   */
  apply(sessionId: string, presetId: string): Promise<PresetApplyOutcome>;
}

/** The optional native registry face this port reads; absent keeps the host surface. */
interface AgentPresetsFace {
  select(agent: unknown, presetId: string): Promise<string>;
}

/** The host's Agent resolution face; a refusal arrives as a plain object. */
interface ResolveAgentFace {
  resolveAgent(sessionId: SessionId): Promise<{ agent?: unknown; error?: unknown }>;
}

function presetsOf(ctx: Context): AgentPresetsFace | undefined {
  let value: unknown;
  try { value = ctx.get('agentPresets'); } catch { value = undefined; }
  const face = value as Partial<AgentPresetsFace> | undefined;
  return typeof face?.select === 'function' ? (face as AgentPresetsFace) : undefined;
}

/** The stable failure code the preset registry reports, when it carries one. */
function refusalCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/** A choice the host does not offer is a fact about the preset, not about the conversation. */
function unavailableReason(code: unknown): PresetApplyReason {
  return code === 'agent-preset/not-found' || code === 'agent-preset/invalid' ? 'unavailable' : 'failed';
}

/**
 * Select the board's default agent preset on a new conversation.
 *
 * The plugin never changes the installation's default preset. It resolves the
 * conversation's live Agent and installs the selection through the native
 * registry, which records the choice on that Session alone. The registry is an
 * optional host service: a deployment without it reports `unsupported` and the
 * conversation keeps the host default preset.
 */
export function createSessionPresetPort(ctx: Context): SessionPresetPort {
  return {
    async apply(sessionId, presetId) {
      const presets = presetsOf(ctx);
      if (presets === undefined) return { applied: false, reason: 'unsupported' };
      let agent: unknown;
      try {
        const result = await (ctx.sessionController as unknown as ResolveAgentFace).resolveAgent(SessionId(sessionId));
        if (result.error !== undefined || result.agent === undefined) return { applied: false, reason: 'failed' };
        agent = result.agent;
      } catch {
        return { applied: false, reason: 'failed' };
      }
      try {
        await presets.select(agent, presetId);
        return { applied: true };
      } catch (error) {
        return { applied: false, reason: unavailableReason(refusalCode(error)) };
      }
    },
  };
}
