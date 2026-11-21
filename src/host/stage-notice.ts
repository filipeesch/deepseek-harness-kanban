import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import type { Column, Workflow } from '../shared/types.js';
import { stageKind } from '../domain/stage-kind.js';
import { orientStage } from '../domain/stage-orientation.js';
import { renderOrientationBlock } from './stage-orientation-text.js';
import { registerPreStepInjection, type PlacedMessage } from './pre-step-injection.js';
import { appendedMessages } from './plugin-message-delivery.js';
import { createSessionHistory, type SessionEventsReader } from './session-history.js';
import type { TaskLocator } from './task-locator.js';

/** Durable source kind that marks a stage notice injected as conversation context. */
export const STAGE_NOTICE_SOURCE_KIND = 'stage-notice';

/** Producer marker of the model-facing notice that a task changed stage without an instruction delivery. */
export interface KanbanStageNoticeSource {
  readonly kind: 'stage-notice';
  /** One-off account the host shows on the collapsed context row. */
  readonly form: 'notice';
  readonly summary: string;
  /** The stage entry the notice announces; a conversation is told about an entry at most once. */
  readonly entryId: string;
  readonly columnId: string;
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'stage-notice': KanbanStageNoticeSource;
  }
}

/** The message kinds whose durable source records which stage entry a conversation was told about. */
const ENTRY_SOURCE_KINDS: ReadonlySet<string> = new Set(['kanban-task', 'stage-instruction', STAGE_NOTICE_SOURCE_KIND]);

/** Why no entry instruction accompanied the change, stated as a fact about the stage. */
export type StageNoticeStatus = 'no-instruction' | 'decision' | 'scripted' | 'undelivered';

/** Said when the last stage message before the notice names an earlier entry. */
const OUT_OF_DATE_TEXT = 'The stage message just before it names an earlier entry and is out of date.';

const STATUS_TEXT: Record<StageNoticeStatus, string> = {
  'no-instruction': 'It has no entry instruction, so none was sent.',
  decision: 'It is a decision gate that waits for a person, so no entry instruction was sent.',
  scripted: 'It runs a program, so no entry instruction was sent.',
  undelivered: 'Its entry instruction has not been sent in this conversation.',
};

/** The stage entry a durable or pending message says its conversation was told about, if any. */
export function announcedEntry(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const source = (message as { source?: unknown }).source;
  if (typeof source !== 'object' || source === null) return undefined;
  const { kind, entryId } = source as { kind?: unknown; entryId?: unknown };
  return typeof kind === 'string' && ENTRY_SOURCE_KINDS.has(kind) && typeof entryId === 'string' && entryId !== '' ? entryId : undefined;
}

/**
 * Every stage entry the conversation was shown, whatever the order it was shown in. It
 * reads the messages the log appended and not the inbox insertions, because a delivery
 * a cancel undid was admitted but never reached the conversation.
 */
export function announcedEntries(events: readonly unknown[]): Set<string> {
  const entries = new Set<string>();
  for (const message of appendedMessages(events)) {
    const entry = announcedEntry(message);
    if (entry !== undefined) entries.add(entry);
  }
  return entries;
}

/** The status of a stage whose entry reached a conversation without its instruction. */
export function stageNoticeStatus(column: Pick<Column, 'decision' | 'scripted' | 'onEnterPrompt'>): StageNoticeStatus {
  const kind = stageKind(column);
  return kind === 'agent-instruction' ? 'undelivered' : kind;
}

/**
 * The notice for the entry a task is now in: what changed, why no instruction came, and the
 * stage's orientation. When the conversation was already told about the entry, the notice is a
 * correction instead: it names the stage and carries the orientation, with no status line.
 */
export function createStageNoticeMessage(workflow: Workflow, columnId: string, entryId: string, options: { supersedes?: boolean; told?: boolean } = {}): UserMessage | undefined {
  const column = workflow.columns.find(value => value.id === columnId);
  const orientation = orientStage(workflow, columnId);
  if (column === undefined || orientation === undefined) return undefined;
  const lead = options.told === true
    ? 'the task is in the ' + column.name + ' stage.'
    : 'the task moved to the ' + column.name + ' stage. ' + STATUS_TEXT[stageNoticeStatus(column)];
  const text = 'Stage notice: ' + lead + (options.supersedes === true ? ' ' + OUT_OF_DATE_TEXT : '') + '\n\n' + renderOrientationBlock(orientation);
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: STAGE_NOTICE_SOURCE_KIND, form: 'notice', summary: boundContextSummary('Stage: ' + column.name), entryId, columnId },
  });
}

export interface StageNoticeOptions {
  history?: SessionEventsReader;
  report?: (error: unknown) => void;
}

/** What one live conversation is known to have been told. */
interface Told {
  /** The entries the durable log shows the conversation was told about; empty when its history records none. */
  known: ReadonlySet<string>;
  /** Whether a message of this process, sent in a batch or injected, is expected to tell it about an entry the log does not show yet. */
  unconfirmed: boolean;
}

/**
 * Tell a task conversation when its task changed stage without a stage instruction
 * reaching it, so it never keeps acting on an earlier stage. The notice goes before the
 * step's messages, or after the last stage message that names an earlier entry. It runs on the same
 * pre-step hook as the first-contact context and keeps per-conversation memory of the
 * entry it was last told about, seeded once from the durable log. What a step carries
 * is only tentative, because a step can be aborted after this decision and before its
 * messages are appended: the entry a step announces, by a notice or by any message in
 * its batch, is confirmed against the log once before the next decision, and a message
 * the log never recorded is announced again. The log is not read at any other time.
 */
export function registerStageNotice(ctx: Context, locator: Pick<TaskLocator, 'bySession'>, options: StageNoticeOptions = {}): () => void {
  const history = options.history ?? createSessionHistory(ctx);
  const report = options.report ?? ((error: unknown) => {
    try { ctx.logger?.warn?.(`Kanban stage notice failed: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* logging is best effort */ }
  });
  const told = new WeakMap<Agent, Told>();

  return registerPreStepInjection(ctx, {
    reset: agent => { told.delete(agent); },
    async select({ agent, messages, signal }) {
      // Only a task conversation is told anything, and only it costs a read.
      if (!locator.bySession(agent.id)) return undefined;

      let state = told.get(agent);
      if (state === undefined || state.unconfirmed) {
        try {
          const recorded = announcedEntries((await history.read(agent.id, { signal })).events);
          state = { known: new Set([...(state?.known ?? []), ...recorded]), unconfirmed: false };
        } catch (error) {
          report(error);
          return undefined;
        }
        if (signal.aborted) return undefined;
        told.set(agent, state);
      }

      // The read can outlive a move or a workflow edit, so the task is resolved again after it.
      const located = locator.bySession(agent.id);
      const entry = located?.task.stageEntry;
      if (located === undefined || entry === undefined) return undefined;
      // The batch is tentative until the log shows it, whichever entry its messages name and whether or not
      // the current entry is known, so the next decision confirms it.
      const named = messages.map(announcedEntry);
      const carried = new Set(named.filter((value): value is string => value !== undefined));
      if (carried.size > 0) state.unconfirmed = true;
      const last = named.findLastIndex(value => value !== undefined);
      // The last stage statement the conversation would read names an earlier entry, because the task moved
      // after that message was composed. Whether or not the current entry was announced, the conversation
      // must end on the current one.
      const stale = last >= 0 && named[last] !== entry.id;
      const announced = state.known.has(entry.id) || carried.has(entry.id);
      if (!stale) {
        // A message that names the current entry tells the conversation about it.
        if (announced) return undefined;
        // Nothing to compare: an earlier conversation records no entry and this batch carries none.
        if (state.known.size === 0) return undefined;
      }
      const notice = createStageNoticeMessage(located.board.workflow, located.task.columnId, entry.id, { supersedes: stale, told: announced });
      if (notice === undefined) return undefined;
      state.unconfirmed = true;
      // It follows the last stage message of the batch, so the stage statement the conversation ends on is the
      // current one. None of the step's own messages is dropped or edited.
      const placed: PlacedMessage = { message: notice, after: last + 1 };
      return placed;
    },
  });
}
