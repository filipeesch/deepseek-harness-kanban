import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { BoardStore } from '../domain/store.js';
import type { Task, Workflow } from '../shared/types.js';

/** Producer marker for the model-facing task context injected on a conversation's first turn. */
export interface KanbanTaskContextSource {
  readonly kind: 'kanban-task';
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'kanban-task': KanbanTaskContextSource;
  }
}

export type TaskContextStore = Pick<BoardStore, 'snapshot'>;
export type TaskContextInspect = (sessionId: string, signal?: AbortSignal) => Promise<{ events: readonly unknown[] }>;

export interface TaskContextOptions {
  inspect?: TaskContextInspect;
  report?: (error: unknown) => void;
}

/** The task envelope injected once before the first user message of a task conversation. */
export function buildTaskContextText(task: Task, stageName: string): string {
  return [
    'Kanban task context for this conversation.',
    '',
    `Task: ${task.title} (${task.id})`,
    '',
    'Description:',
    task.description.trim() || '(no description)',
    '',
    `Workflow stage at first contact: ${stageName}`,
  ].join('\n');
}

export function createTaskContextMessage(task: Task, workflow: Workflow): UserMessage {
  const column = workflow.columns.find(value => value.id === task.columnId);
  return createUserMessage({
    content: [{ type: 'text', text: buildTaskContextText(task, column?.name ?? task.columnId) }],
    source: { kind: 'kanban-task' },
  });
}

function isUserMessage(event: unknown): boolean {
  return Boolean(event && typeof event === 'object' && 'type' in event && event.type === 'user/message');
}

/**
 * Inject the task context into the first pre-step with user input, once per live Agent.
 * The listener calls `next()` first so the existing execution guards keep their decision.
 */
export function registerTaskContextInjection(ctx: Context, store: TaskContextStore, options: TaskContextOptions = {}): () => void {
  const checked = new WeakSet<Agent>();
  const inspect: TaskContextInspect = options.inspect ?? ((sessionId, signal) => ctx.sessionController.inspect(SessionId(sessionId), signal));
  const report = options.report ?? ((error: unknown) => {
    try { ctx.logger?.warn?.(`Kanban task context injection failed: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* logging is best effort */ }
  });

  const offStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || decision.messages.length === 0 || checked.has(payload.agent) || payload.signal.aborted) return decision;

    const state = store.snapshot();
    const task = state.tasks.find(value => value.sessionIds.includes(payload.agent.id));
    if (!task) return decision;

    let events: readonly unknown[];
    try {
      events = (await inspect(payload.agent.id, payload.signal)).events;
    } catch (error) {
      report(error);
      return decision;
    }
    if (payload.signal.aborted) return decision;

    // Only a durable user message proves the context was already delivered. Do not
    // memo an injection that may be discarded with an aborted decision.
    if (events.some(isUserMessage)) { checked.add(payload.agent); return decision; }
    return { ...decision, messages: [createTaskContextMessage(task, state.workflow), ...decision.messages] };
  }, { prepend: true });

  const offCreated = ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') checked.delete(agent);
    return undefined;
  });

  return () => { offStep(); offCreated(); };
}
