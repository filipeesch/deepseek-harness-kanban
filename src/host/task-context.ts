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

/**
 * The attachment listing's own byte budget. It is separate from the workflow
 * snapshot's budget on purpose: a task's files are context, not a replacement for
 * the stage and transition facts the agent needs to navigate.
 */
export const TASK_ATTACHMENT_BUDGET = 8 * 1024;

/** One attachment the task context reports, with the path an agent reads it by. */
export interface TaskContextAttachment {
  readonly name: string;
  readonly bytes: number;
  readonly path: string;
}

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

/** One attachment line: the name, its size, and the path an agent can read. */
function attachmentLine(attachment: TaskContextAttachment): string {
  return '- ' + attachment.name + ' (' + attachment.bytes + ' bytes): ' + attachment.path;
}

/**
 * Render the attachment section under its own budget. Files are never dropped
 * silently: when the section cannot hold them all, it states how many are left.
 */
export function buildAttachmentSection(attachments: readonly TaskContextAttachment[], budget = TASK_ATTACHMENT_BUDGET): string {
  if (attachments.length === 0) return '';
  const header = 'Task attachments (read each with your file tools):';
  const omittedLine = (count: number): string => '- ' + count + ' more attachments omitted for length; read the task with get_card.';
  const lines = attachments.map(attachmentLine);
  const render = (kept: number): string => {
    const omitted = attachments.length - kept;
    const body = kept === 0 ? [] : [lines.slice(0, kept).join('\n')];
    const footer = omitted === 0 ? [] : [omittedLine(omitted)];
    return [header, ...body, ...footer].join('\n');
  };
  // Everything fits: no footer and no reservation, so the common case spends nothing
  // on a line it does not need.
  const complete = render(attachments.length);
  if (Buffer.byteLength(complete) <= budget) return complete;
  // Otherwise keep the longest prefix whose rendered section, footer included, fits.
  // A single line that cannot fit is simply not kept: continuing past it lets a later
  // short name still be listed instead of hiding every file after one long path.
  // Otherwise keep every line that fits beside the footer, in order. An oversized line
  // is skipped rather than ending the list, so one long path cannot hide the short
  // names that follow it.
  const footerReserve = Buffer.byteLength(omittedLine(attachments.length)) + 1;
  const keptLines: string[] = [];
  let used = Buffer.byteLength(header) + 1;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + 1;
    if (used + footerReserve + size > budget) continue;
    used += size;
    keptLines.push(line);
  }
  const omitted = attachments.length - keptLines.length;
  const body = keptLines.length === 0 ? [] : [keptLines.join('\n')];
  return [header, ...body, omittedLine(omitted)].join('\n');
}

export function createTaskContextMessage(task: Task, workflow: Workflow, hubName: string, board: Board, hubId = '', state: { sharing: WorkflowSharing; held: WorkflowHeldState } = { sharing: 'unavailable', held: 'unavailable' }, attachments: readonly TaskContextAttachment[] = []): UserMessage {
  const { sharing, held } = state;
  const column = workflow.columns.find(value => value.id === task.columnId);
  const label = 'Workflow first-contact snapshot (not live; use get_workflow_summary for current details):\n';
  const page = workflowSummaryPage(projectWorkflowSummary(board, { id: hubId, name: hubName }, sharing, task, held), undefined, WORKFLOW_SUMMARY_BUDGET - Buffer.byteLength(label));
  // The attachment section keeps its own budget, so listing files never evicts the
  // workflow snapshot the agent needs to know its stage and transitions.
  const attachmentSection = buildAttachmentSection(attachments);
  const envelope = buildTaskContextText(task, column?.name ?? task.columnId, hubName, board);
  return createUserMessage({
    content: [{ type: 'text', text: envelope + (attachmentSection === '' ? '' : '\n\n' + attachmentSection) + '\n\n' + label + JSON.stringify(page, null, 2) }],
    source: { kind: 'kanban-task' },
  });
}

function isUserMessage(event: unknown): boolean {
  return Boolean(event && typeof event === 'object' && 'type' in event && event.type === 'user/message');
}

/**
 * Inject the task context into the first pre-step with user input, once per live Agent.
 * The listener calls next() first so the existing execution guards keep their decision.
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
    // A failing attachment read must not withhold the task envelope: the listing is
    // context, and its absence is less harmful than no context at all.
    let attachments: readonly TaskContextAttachment[] = [];
    try { attachments = options.attachments?.(task) ?? []; }
    catch (error) { report(error); }
    return { ...decision, messages: [createTaskContextMessage(task, located.board.workflow, located.hub.name, located.board, located.hubId, { sharing, held }, attachments), ...decision.messages] };
  }, { prepend: true });

  const offCreated = ctx.on('agent/created', ({ agent, source }) => {
    if (source === 'clear') checked.delete(agent);
    return undefined;
  });

  return () => { offStep(); offCreated(); };
}
