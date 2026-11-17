import { createHash } from 'node:crypto';
import type { Board, ConversationFacts, HubSharingView, HubState, Task } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';
import { hasPendingUserWork } from '../domain/pending-user-work.js';
import { readPendingUserWork } from './pending-source.js';

/** A bounded, safe projection. Each record is independent of authored executable content. */
export type WorkflowSummaryRecord = Record<string, unknown>;
export const WORKFLOW_SUMMARY_BUDGET = 6 * 1024;

export type WorkflowHeldState = boolean | 'unavailable';
export type WorkflowSharing = HubSharingView | undefined | 'unavailable';

/** Shared live inputs for the tool and first-contact snapshot. An absent port is unknown. */
export interface WorkflowSummaryPorts {
  sharingView?: (hubId: string) => HubSharingView | undefined;
  conversationFacts?: (sessionId: string) => Promise<ConversationFacts>;
  report?: (error: unknown) => void;
}

export async function readWorkflowSummaryState(hubId: string, task: Task | undefined, ports: WorkflowSummaryPorts): Promise<{ sharing: WorkflowSharing; held: WorkflowHeldState }> {
  let sharing: WorkflowSharing = 'unavailable';
  try { if (ports.sharingView) sharing = ports.sharingView(hubId); }
  catch (error) { ports.report?.(error); }
  return { sharing, held: task ? await workflowHeldState(task, ports.conversationFacts) : 'unavailable' };
}

/** Read all task conversations, including closed ones, as the advance gate does. */
export async function workflowHeldState(task: Task, facts?: (sessionId: string) => Promise<ConversationFacts>): Promise<WorkflowHeldState> {
  if (!facts) return 'unavailable';
  try { return hasPendingUserWork(await readPendingUserWork({ read: facts }, task.sessionIds)); }
  catch { return 'unavailable'; }
}

export function projectWorkflowSummary(board: Board, hub: Pick<HubState, 'id' | 'name'>, sharing: WorkflowSharing, task?: Task, held: WorkflowHeldState = 'unavailable'): WorkflowSummaryRecord[] {
  const workflow = board.workflow;
  const stage = task && workflow.columns.find(value => value.id === task.columnId);
  const records: WorkflowSummaryRecord[] = [];
  if (task) records.push({ kind: 'task', id: task.id, currentStage: stage ? { id: stage.id, name: stage.name } : { id: task.columnId, status: 'unavailable' }, autoMode: { enabled: task.autoMode?.enabled ?? false, paused: Boolean(task.autoMode?.pause || task.autoMode?.hold), held } });
  records.push({ kind: 'workflow', name: workflow.name, board: { id: board.id, name: board.name }, hub: { id: hub.id, name: hub.name }, initialStageId: workflow.initialColumnId, ...(workflow.description?.trim() ? { description: workflow.description } : {}) });
  const binding = sharing && sharing !== 'unavailable' ? sharing.boards.find(value => value.boardId === board.id) : undefined;
  records.push({ kind: 'sharing', status: sharing === 'unavailable' ? 'unavailable' : sharing?.status ?? 'not-published', bound: sharing === 'unavailable' ? null : binding?.bound === true, ...(binding ? { boardState: binding.state } : {}) });
  records.push({ kind: 'projectScope', mode: board.allowedProjectKeys === undefined ? 'all' : 'restricted', projectCount: board.allowedProjectKeys?.length ?? null });
  for (const key of board.allowedProjectKeys ?? []) records.push({ kind: 'project', key });
  for (const column of workflow.columns) {
    const routePolicy = column.decision ? 'decision' : column.scripted ? 'scripted' : column.allowedTransitions === undefined ? 'unrestricted' : column.allowedTransitions.length === 0 ? 'empty' : 'configured';
    records.push({ kind: 'stage', id: column.id, name: column.name, ...(column.description?.trim() ? { description: column.description } : {}), type: column.decision ? 'decision' : column.scripted ? 'scripted' : column.onEnterPrompt?.trim() ? 'agent-instruction' : 'no-instruction', routePolicy });
    if (column.decision) {
      // The gate's destinations are authored options, not candidate routes; the
      // question is documentary context and the projection never answers it.
      records.push({ kind: 'decision', stage: column.id, question: column.decision.question });
      for (const option of column.decision.options) records.push({ kind: 'decisionOption', stage: column.id, id: option.id, title: option.title, to: option.to });
    } else if (column.scripted) {
      for (const [exit, to] of Object.entries(column.scripted.exits)) records.push({ kind: 'scriptExit', from: column.id, exit, to });
    } else {
      for (const route of column.allowedTransitions ?? []) records.push({ kind: 'route', from: column.id, to: route.to, ...(route.when?.trim() ? { condition: route.when } : {}) });
    }
  }
  return records;
}

interface Cursor { hash: string; index: number; offset: number }
export interface WorkflowSummaryPage {
  records: WorkflowSummaryRecord[];
  omittedRecords: number;
  nextCursor: string | null;
}
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');
const token = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Pages use the rendered JSON budget, including indentation, continuation and escaping. */
export function workflowSummaryPage(records: WorkflowSummaryRecord[], cursor?: string, budget = WORKFLOW_SUMMARY_BUDGET): WorkflowSummaryPage {
  const hash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  let index = 0; let offset = 0;
  if (cursor !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
      if (parsed.hash !== hash || !Number.isSafeInteger(parsed.index) || parsed.index < 0 || parsed.index >= records.length || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error();
      index = parsed.index; offset = parsed.offset;
    } catch { throw new KanbanError('INVALID_SUMMARY_CURSOR', 'The summary changed or the cursor is invalid; start again without a cursor.'); }
  }
  const page: WorkflowSummaryPage = { records: [], omittedRecords: 0, nextCursor: null };
  const setNext = (i: number, o: number) => {
    page.omittedRecords = records.length - i;
    page.nextCursor = i < records.length ? token({ hash, index: i, offset: o }) : null;
  };
  while (index < records.length) {
    if (offset === 0) {
      page.records.push(records[index]!);
      setNext(index + 1, 0);
      if (size(page) <= budget) { index++; continue; }
      page.records.pop();
      if (page.records.length) { setNext(index, 0); return page; }
    }
    // An oversized record is serialized exactly and reconstructed by concatenating
    // its fragments before JSON.parse. Split only at Unicode code point boundaries.
    const chars = Array.from(JSON.stringify(records[index]));
    if (offset >= chars.length) throw new KanbanError('INVALID_SUMMARY_CURSOR', 'The summary cursor is invalid; start again without a cursor.');
    let low = offset + 1; let high = chars.length; let best = offset;
    while (low <= high) {
      const end = Math.floor((low + high) / 2);
      page.records = [{ kind: 'oversizedRecordFragment', recordIndex: index, offset, text: chars.slice(offset, end).join(''), complete: end === chars.length }];
      setNext(end === chars.length ? index + 1 : index, end === chars.length ? 0 : end);
      if (size(page) <= budget) { best = end; low = end + 1; } else high = end - 1;
    }
    if (best === offset) throw new Error('Workflow summary budget cannot hold a fragment.');
    page.records = [{ kind: 'oversizedRecordFragment', recordIndex: index, offset, text: chars.slice(offset, best).join(''), complete: best === chars.length }];
    setNext(best === chars.length ? index + 1 : index, best === chars.length ? 0 : best);
    return page;
  }
  setNext(index, 0);
  return page;
}
