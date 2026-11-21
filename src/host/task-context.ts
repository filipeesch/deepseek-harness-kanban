import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { Board, ConversationFacts, HubSharingView, HubState, Task } from '../shared/types.js';
import { readWorkflowSummaryState, type WorkflowHeldState, type WorkflowSharing } from './workflow-summary.js';
import { renderWorkflowMap } from './workflow-map.js';
import { buildAttachmentSection, type TaskContextAttachment } from './task-attachment-section.js';
import { registerPreStepInjection } from './pre-step-injection.js';
import type { TaskLocator } from './task-locator.js';
import { createSessionHistory, type SessionEventsReader } from './session-history.js';

/** Producer marker for the model-facing task context injected on a conversation's first turn. */
export interface KanbanTaskContextSource {
  readonly kind: 'kanban-task';
  /** The stage entry the context describes; absent for a task without one and for a message recorded before entries were tracked. */
  readonly entryId?: string;
  readonly columnId?: string;
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'kanban-task': KanbanTaskContextSource;
  }
}

/** The label that tells an agent the workflow map is a first-contact snapshot, not a live policy. */
export const FIRST_CONTACT_LABEL = 'Workflow first-contact snapshot (not live; use get_workflow_summary for current details):\n';

export interface TaskContextOptions {
  history?: SessionEventsReader;
  report?: (error: unknown) => void;
  sharingView?: (hubId: string) => HubSharingView | undefined;
  conversationFacts?: (sessionId: string) => Promise<ConversationFacts>;
  /** The readable attachments of one task, in the task order. */
  attachments?: (task: Task) => readonly TaskContextAttachment[];
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

/** What the first-contact message is built from; state that is not known yet is stated as unavailable. */
export interface TaskContextInput {
  readonly task: Task;
  readonly board: Board;
  readonly hub: Pick<HubState, 'id' | 'name'>;
  readonly sharing?: WorkflowSharing;
  readonly held?: WorkflowHeldState;
  readonly attachments?: readonly TaskContextAttachment[];
}

/**
 * The first-contact message: the task envelope, the attachment listing under its own
 * budget, and the workflow map under its own, so listing files never evicts the stages
 * and exits the agent needs to navigate.
 */
export function createTaskContextMessage(input: TaskContextInput): UserMessage {
  const { task, board, hub } = input;
  const column = board.workflow.columns.find(value => value.id === task.columnId);
  const attachmentSection = buildAttachmentSection(input.attachments ?? []);
  const envelope = buildTaskContextText(task, column?.name ?? task.columnId, hub.name, board);
  // An absent sharing view means the board was never published; only a missing input is unknown.
  const sharing: WorkflowSharing = 'sharing' in input ? input.sharing : 'unavailable';
  const map = renderWorkflowMap({ board, hub, sharing, task, held: input.held ?? 'unavailable' });
  return createUserMessage({
    content: [{ type: 'text', text: envelope + (attachmentSection === '' ? '' : '\n\n' + attachmentSection) + '\n\n' + FIRST_CONTACT_LABEL + map }],
    source: { kind: 'kanban-task', ...(task.stageEntry === undefined ? {} : { entryId: task.stageEntry.id, columnId: task.columnId }) },
  });
}

function isUserMessage(event: unknown): boolean {
  return Boolean(event && typeof event === 'object' && 'type' in event && event.type === 'user/message');
}

/**
 * Inject the task context into the first pre-step with user input, once per live Agent.
 * The listener lets the existing execution guards decide first.
 */
export function registerTaskContextInjection(ctx: Context, locator: Pick<TaskLocator, 'bySession'>, options: TaskContextOptions = {}): () => void {
  const checked = new WeakSet<Agent>();
  const history = options.history ?? createSessionHistory(ctx);
  const report = options.report ?? ((error: unknown) => {
    try { ctx.logger?.warn?.(`Kanban task context injection failed: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* logging is best effort */ }
  });

  return registerPreStepInjection(ctx, {
    reset: agent => { checked.delete(agent); },
    async select({ agent, signal }) {
      if (checked.has(agent)) return undefined;
      const located = locator.bySession(agent.id);
      if (!located) return undefined;
      const task = located.task;

      let events: readonly unknown[];
      try {
        events = (await history.read(agent.id, { signal })).events;
      } catch (error) {
        report(error);
        return undefined;
      }
      if (signal.aborted) return undefined;

      // Only a durable user message proves the context was already delivered. Do not
      // memo an injection that may be discarded with an aborted decision.
      if (events.some(isUserMessage)) { checked.add(agent); return undefined; }
      const { sharing, held } = await readWorkflowSummaryState(located.hubId, task, { ...options, report });
      if (signal.aborted) return undefined;
      // A failing attachment read must not withhold the task envelope: the listing is
      // context, and its absence is less harmful than no context at all.
      let attachments: readonly TaskContextAttachment[] = [];
      try { attachments = options.attachments?.(task) ?? []; }
      catch (error) { report(error); }
      return createTaskContextMessage({ task, board: located.board, hub: { id: located.hubId, name: located.hub.name }, sharing, held, attachments });
    },
  });
}
