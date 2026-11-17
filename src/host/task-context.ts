import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { Board, ConversationFacts, HubSharingView, Task, Workflow } from '../shared/types.js';
import { projectWorkflowSummary, readWorkflowSummaryState, workflowSummaryPage, WORKFLOW_SUMMARY_BUDGET, type WorkflowHeldState, type WorkflowSharing } from './workflow-summary.js';
import type { TaskLocator } from './task-locator.js';
import { createSessionHistory, type SessionEventsReader } from './session-history.js';

/** Producer marker for the model-facing task context injected on a conversation's first turn. */
export interface KanbanTaskContextSource {
  readonly kind: 'kanban-task';
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'kanban-task': KanbanTaskContextSource;
  }
}

export interface TaskContextOptions {
  history?: SessionEventsReader;
  report?: (error: unknown) => void;
  sharingView?: (hubId: string) => HubSharingView | undefined;
  conversationFacts?: (sessionId: string) => Promise<ConversationFacts>;
}

/** The task envelope injected once before the first user message of a task conversation. */
export function buildTaskContextText(task: Task, stageName: string, hubName: string, board: Board): string {
  return [
    'Kanban task context for this conversation.',
    '',
    `Hub: ${hubName}`,
    `Board: ${board.name}`,
    `Task: ${task.title} (${task.id})`,
    '',
    'Description:',
    task.description.trim() || '(no description)',
    '',
    `Workflow stage at first contact: ${stageName}`,
  ].join('\n');
}

export function createTaskContextMessage(task: Task, workflow: Workflow, hubName: string, board: Board, hubId = '', state: { sharing: WorkflowSharing; held: WorkflowHeldState } = { sharing: 'unavailable', held: 'unavailable' }): UserMessage {
  const { sharing, held } = state;
  const column = workflow.columns.find(value => value.id === task.columnId);
  const label = 'Workflow first-contact snapshot (not live; use get_workflow_summary for current details):\n';
  const page = workflowSummaryPage(projectWorkflowSummary(board, { id: hubId, name: hubName }, sharing, task, held), undefined, WORKFLOW_SUMMARY_BUDGET - Buffer.byteLength(label));
  return createUserMessage({
    content: [{ type: 'text', text: buildTaskContextText(task, column?.name ?? task.columnId, hubName, board) + '\n\n' + label + JSON.stringify(page, null, 2) }],
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
export function registerTaskContextInjection(ctx: Context, locator: Pick<TaskLocator, 'bySession'>, options: TaskContextOptions = {}): () => void {
  const checked = new WeakSet<Agent>();
  const history = options.history ?? createSessionHistory(ctx);
  const report = options.report ?? ((error: unknown) => {
    try { ctx.logger?.warn?.(`Kanban task context injection failed: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* logging is best effort */ }
  });

  const offStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || decision.messages.length === 0 || checked.has(payload.agent) || payload.signal.aborted) return decision;

    const located = locator.bySession(payload.agent.id);
    if (!located) return decision;
    const task = located.task;

    let events: readonly unknown[];
    try {
      events = (await history.read(payload.agent.id, { signal: payload.signal })).events;
    } catch (error) {
      report(error);
      return decision;
    }
    if (payload.signal.aborted) return decision;

    // Only a durable user message proves the context was already delivered. Do not
    // memo an injection that may be discarded with an aborted decision.
    if (events.some(isUserMessage)) { checked.add(payload.agent); return decision; }
    const { sharing, held } = await readWorkflowSummaryState(located.hubId, task, { ...options, report });
    if (payload.signal.aborted) return decision;
    return { ...decision, messages: [createTaskContextMessage(task, located.board.workflow, located.hub.name, located.board, located.hubId, { sharing, held }), ...decision.messages] };
  }, { prepend: true });

  const offCreated = ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') checked.delete(agent);
    return undefined;
  });

  return () => { offStep(); offCreated(); };
}
