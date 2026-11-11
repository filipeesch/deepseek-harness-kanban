import type { Problem, Project, RetainedCheckout, Task } from '../../shared/types.js';
import { describeOperation } from '../operation-description.js';
import { recoveryActionDescriptors } from '../operation-recovery-actions.js';

/** Where the board presents a notice; the group order below is the presentation order. */
export type NoticeGroup = 'failure' | 'relocation' | 'operations' | 'retained';

export type NoticeTone = 'neutral' | 'failure';

/** One piece of a notice sentence; a code segment renders as inline code. */
export type NoticeSegment = { text: string } | { code: string };

export interface NoticeAction {
  id: string;
  label: string;
  run: () => void;
  tone?: 'danger';
}

/** The single dismiss affordance a notice may carry. */
export interface NoticeDismiss {
  /** Accessible name of the control; it identifies the notice it removes. */
  label: string;
  /** Visible tooltip. */
  hint: string;
  run: () => void;
}

/** One entry of an aggregate notice, such as the tasks a running operation belongs to. */
export interface NoticeItem { id: string; label: string; suffix?: string; run: () => void }

/** A board notice as data; only the presentation decides how it is drawn. */
export interface BoardNotice {
  id: string;
  group: NoticeGroup;
  tone: NoticeTone;
  title?: string;
  segments: readonly NoticeSegment[];
  /** Secondary line, such as a recorded failure message. */
  hint?: string;
  items?: readonly NoticeItem[];
  actions: readonly NoticeAction[];
  /** Absent exactly when the notice must not be dismissed. */
  dismiss?: NoticeDismiss;
}

export interface NoticeHandlers {
  openTask: (taskId: string) => void;
  retryOperation: (taskId: string) => void;
  forceOperation: (taskId: string) => void;
  returnToProject: (taskId: string) => void;
  retryRelocation: (projectId: string) => void;
}

/** The group order the board renders, dismissible and non-dismissible notices mixed by role. */
export const GROUP_ORDER: readonly NoticeGroup[] = ['failure', 'relocation', 'operations', 'retained'];

/** The reasons a deletion keeps a checkout, as the retained group states them. */
const RETAINED_REASONS: Record<RetainedCheckout['reason'], string> = {
  folder: ' because the project is not Git-managed.',
  unresolved: ' because its project path or Git root could not be resolved.',
};

/** One retained checkout, stating the path and why the directory is still there. */
export function retainedNotices(entries: readonly RetainedCheckout[], dismiss: (path: string) => void): BoardNotice[] {
  return entries.map(entry => ({
    id: 'retained:' + entry.path,
    group: 'retained' as const,
    tone: 'neutral' as const,
    segments: [
      { text: 'Task deleted. The checkout at ' },
      { code: entry.path },
      { text: ' was left on disk' + RETAINED_REASONS[entry.reason] },
    ],
    actions: [],
    dismiss: {
      label: 'Dismiss the retained checkout at ' + entry.path,
      hint: 'Dismiss',
      run: () => dismiss(entry.path),
    },
  }));
}

/** The board command failure, which the user may dismiss until the next failure replaces it. */
export function commandFailureNotice(problem: Problem | null, dismiss: () => void): BoardNotice | null {
  if (!problem) return null;
  return {
    id: 'command-failure',
    group: 'failure',
    tone: 'failure',
    title: problem.code,
    segments: [{ text: problem.message }],
    actions: [],
    dismiss: { label: 'Dismiss the board failure notice', hint: 'Dismiss', run: dismiss },
  };
}

function destructiveOperation(task: Task) {
  const operation = task.operation;
  return operation && (operation.request.kind === 'delete' || operation.request.kind === 'remove') ? operation : null;
}

/** The aggregate row states a running or queued operation in one word or phrase. */
function operationStateLabel(task: Task): string {
  const operation = destructiveOperation(task)!;
  if (operation.phase === 'queued') return 'Queued';
  if (operation.phase === 'waiting') return 'Waiting for idle';
  if (operation.phase === 'preflight') return 'Checking…';
  return operation.request.kind === 'delete' ? 'Deleting…' : 'Removing worktree…';
}

/**
 * Running, queued, and failed destructive operations. The aggregate line lists the
 * affected tasks; a failure keeps its own row with the recovery actions it permits.
 */
export function operationNotices(tasks: readonly Task[], handlers: NoticeHandlers): BoardNotice[] {
  const entries = tasks.filter(task => destructiveOperation(task) !== null);
  const active = entries.filter(task => task.operation!.phase !== 'failed');
  const failed = entries.filter(task => task.operation!.phase === 'failed');
  const notices: BoardNotice[] = [];
  if (active.length > 0) {
    notices.push({
      id: 'operations:active',
      group: 'operations',
      tone: 'neutral',
      title: active.length === 1 ? '1 destructive operation' : active.length + ' destructive operations',
      segments: [],
      items: active.map(task => ({ id: task.id, label: task.title, suffix: operationStateLabel(task), run: () => handlers.openTask(task.id) })),
      actions: [],
    });
  }
  for (const task of failed) {
    const operation = task.operation!;
    const description = describeOperation(task, operation);
    const actions: NoticeAction[] = recoveryActionDescriptors(description, ' — ' + task.title).map(action => ({
      id: action.id,
      label: action.label,
      ...(action.tone === 'danger' ? { tone: 'danger' as const } : {}),
      run: action.id === 'force' ? () => handlers.forceOperation(task.id) : action.id === 'retry' ? () => handlers.retryOperation(task.id) : () => handlers.returnToProject(task.id),
    }));
    actions.push({ id: 'open', label: 'Open task — ' + task.title, run: () => handlers.openTask(task.id) });
    notices.push({
      id: 'operation:' + task.id,
      group: 'operations',
      tone: 'failure',
      title: description.title + ': ' + task.title,
      segments: [],
      hint: operation.error?.message ?? description.detail,
      actions,
    });
  }
  return notices;
}

/** A relocation that is waiting for conversations or has failed; retry is offered only when it failed. */
export function relocationNotices(projects: readonly Project[], handlers: Pick<NoticeHandlers, 'retryRelocation'>): BoardNotice[] {
  return projects
    .filter(project => project.operation?.phase === 'waiting' || project.operation?.phase === 'failed')
    .map(project => {
      const operation = project.operation!;
      const failed = operation.phase === 'failed';
      return {
        id: 'relocation:' + project.id,
        group: 'relocation' as const,
        tone: failed ? 'failure' as const : 'neutral' as const,
        title: (failed ? 'Project relocation needs attention: ' : 'Project relocation: ') + project.name,
        segments: [],
        hint: failed ? operation.error?.message ?? 'The relocation failed.' : 'Waiting for current work to finish.',
        actions: failed ? [{ id: 'retry-relocation', label: 'Retry relocation — ' + project.name, run: () => handlers.retryRelocation(project.id) }] : [],
      };
    });
}

/** Every notice in presentation order. */
export function boardNotices(input: {
  commandFailure: BoardNotice | null;
  operations: readonly BoardNotice[];
  relocations: readonly BoardNotice[];
  retained: readonly BoardNotice[];
}): BoardNotice[] {
  const all = [
    ...(input.commandFailure === null ? [] : [input.commandFailure]),
    ...input.relocations,
    ...input.operations,
    ...input.retained,
  ];
  return all.sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
}

/** The notices the user may dismiss, in the order their controls appear. */
export function dismissible(notices: readonly BoardNotice[]): BoardNotice[] {
  return notices.filter(notice => notice.dismiss !== undefined);
}
