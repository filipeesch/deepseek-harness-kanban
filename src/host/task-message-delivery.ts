import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { TaskMessageDeliveryPort } from '../shared/ports.js';
import type { TaskMessageDelivery } from '../shared/task-message.js';
import { createPluginMessageDelivery } from './plugin-message-delivery.js';
import { createTaskMessage, TASK_MESSAGE_SOURCE_KIND } from './task-message.js';

/** Everything the task-message delivery adapter needs from the host, injected for tests. */
export interface TaskMessageDeliveryDeps {
  resolveAgent(sessionId: string): Promise<Agent>;
  /** Whether the resolved conversation's inbox already holds this delivery identity. */
  pending(agent: Agent, requestId: string): boolean;
  events(sessionId: string): Promise<readonly unknown[]>;
  steer(agent: Agent, message: UserMessage): void;
}

/** One native task-message delivery: resolve the target, deduplicate, then steer it. */
export function createTaskMessageDelivery(deps: TaskMessageDeliveryDeps): TaskMessageDeliveryPort {
  const deliver = createPluginMessageDelivery<{ agent: Agent; pending(deliveryId: string): boolean }, TaskMessageDelivery>({
    sourceKind: TASK_MESSAGE_SOURCE_KIND,
    resolve: async sessionId => {
      const agent = await deps.resolveAgent(sessionId);
      return { agent, pending: requestId => deps.pending(agent, requestId) };
    },
    events: sessionId => deps.events(sessionId),
    deliver: (target, delivery) => { deps.steer(target.agent, createTaskMessage(delivery)); },
  });
  return { deliver };
}
