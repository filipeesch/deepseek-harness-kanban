import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';

/** A selected message and where it goes among the step's own messages. */
export interface PlacedMessage {
  readonly message: UserMessage;
  /** How many of the step's own messages come before it; zero puts it first. */
  readonly after: number;
}

/** What one conversation-context injector decides at a pre-step that enters with messages. */
export interface PreStepInjection {
  /**
   * The message to put before the step's own messages, or a placed message to put among
   * them, or undefined for none. It runs only after the existing decision entered with
   * messages and the step is still live, and a message it returns is dropped when the
   * step was aborted while it decided. The step's own messages are never dropped or edited.
   */
  select(input: { readonly agent: Agent; readonly messages: readonly unknown[]; readonly signal: AbortSignal }): Promise<UserMessage | PlacedMessage | undefined>;
  /** Forget what is known about an agent that a clear recreated, so the next step decides afresh. */
  reset?(agent: Agent): void;
}

/**
 * Register one injector on the pre-step hook. It lets the existing execution guards
 * answer first, leaves a rejected, empty, or aborted step untouched, and puts the
 * message the injector selects before the step's messages, or where the injector places it. Per-agent state belongs to the injector.
 */
export function registerPreStepInjection(ctx: Context, injection: PreStepInjection): () => void {
  const offStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || decision.messages.length === 0 || payload.signal.aborted) return decision;
    const selected = await injection.select({ agent: payload.agent, messages: decision.messages, signal: payload.signal });
    if (selected === undefined || payload.signal.aborted) return decision;
    const placed: PlacedMessage = 'message' in selected ? selected : { message: selected, after: 0 };
    const at = Math.min(Math.max(placed.after, 0), decision.messages.length);
    return { ...decision, messages: [...decision.messages.slice(0, at), placed.message, ...decision.messages.slice(at)] };
  }, { prepend: true });

  const offCreated = ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') injection.reset?.(agent);
    return undefined;
  });

  return () => { offStep(); offCreated(); };
}
