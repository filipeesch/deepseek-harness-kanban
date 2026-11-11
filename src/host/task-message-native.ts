import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { TaskMessageDeliveryPort } from '../shared/ports.js';
import { createTaskMessageDelivery } from './task-message-delivery.js';
import { TASK_MESSAGE_SOURCE_KIND } from './task-message.js';
import type { SessionHistoryReader } from './session-history.js';

/** Compose the task-message delivery over the live host: resume the target, read its log, steer it. */
export function createNativeTaskMessageDelivery(ctx: Context, history: SessionHistoryReader): TaskMessageDeliveryPort {
  return createTaskMessageDelivery({
    resolveAgent: async sessionId => {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(sessionId));
      if ('error' in resolved) throw resolved.error;
      return resolved.agent;
    },
    pending: (agent, requestId) => [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => {
      const source = message.source as { readonly kind?: unknown; readonly requestId?: unknown };
      return source.kind === TASK_MESSAGE_SOURCE_KIND && source.requestId === requestId;
    }),
    events: async sessionId => (await history.read(sessionId)).events,
    steer: (agent, message) => { agent.steer(message); },
  });
}
