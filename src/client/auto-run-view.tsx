import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Column, Task } from '../shared/types.js';
import { firstOpenSessionId } from '../shared/conversations.js';
import { entryInstruction, hasUnresolvedEntry } from '../domain/stage-entry.js';
import { AUTO_RUN_DELAY_MS, autoRunEntryForColumn, RUN_FAILURE_FALLBACK, type AutoRunController, type AutoRunEntry } from './auto-run.js';
import { conversationLabel, type SessionTitleSource } from './conversation-label.js';
import { PlayIcon } from './icons.js';

export function useAutoRunEntry(controller: AutoRunController, taskId: string): AutoRunEntry | undefined {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)[taskId];
}

/** Whole seconds remaining at the deadline; recomputed locally so the controller never ticks. */
export function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= deadline) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function CardInstructionAction({ task, column, controller }: { task: Task; column: Column; controller: AutoRunController }) {
  const entry = useAutoRunEntry(controller, task.id);
  const current = autoRunEntryForColumn(entry, column.id);
  const unresolved = hasUnresolvedEntry(task, column.id);
  const instruction = entryInstruction(column);
  const seconds = useCountdown(current?.status === 'counting' ? current.deadline : null);
  if (!unresolved) return null;
  const counting = current?.status === 'counting';
  const sending = current?.status === 'sending';
  const failed = current?.status === 'failed';
  const playable = instruction !== undefined;
  const showButton = counting || sending || playable;
  if (!showButton) return null;
  const blocked = Boolean(task.operation || (task.pendingTransition && !(task.pendingTransition.origin === 'auto' && task.pendingTransition.status === 'failed')));
  const mode = counting ? 'counting' : sending ? 'sending' : 'play';
  const label = counting ? 'Cancel automatic ' + column.name + ' instruction' : sending ? 'Sending ' + column.name + ' instruction' : 'Run ' + column.name + ' instruction';
  const marker = task.instructionPending!;
  const activate = mode === 'counting'
    ? () => controller.cancel(task.id)
    : mode === 'play' && playable
      ? () => void controller.runNow({ taskId: task.id, columnId: column.id, enteredAt: marker.enteredAt, instruction })
      : undefined;
  return <div className="kb-card-run" data-auto-run={mode === 'play' && failed ? 'failed' : mode}>
    <button
      type="button"
      className={'kb-button ' + (counting ? 'kb-card-countdown' : 'kb-card-action' + (mode === 'play' ? ' kb-icon-button' : ''))}
      aria-label={label}
      aria-busy={sending ? true : undefined}
      aria-disabled={sending ? true : undefined}
      title={counting ? 'Cancel the automatic ' + column.name + ' instruction.' : sending ? 'The ' + column.name + ' instruction is being admitted.' : 'Run ' + column.name + ' instruction in the first open conversation'}
      disabled={mode === 'play' && blocked}
      onClick={() => activate?.()}
    >
      {counting ? <>
        <span className="kb-countdown-bar" aria-hidden="true" style={{ width: Math.max(0, Math.min(100, (seconds / (AUTO_RUN_DELAY_MS / 1000)) * 100)) + '%' }} />
        <span className="kb-countdown-label">{seconds}s</span>
        <span className="kb-countdown-cancel" aria-hidden="true">×</span>
      </> : sending ? '…' : <PlayIcon size={15} />}
    </button>
    {counting && <span className="kb-sr" role="status">Automatic {column.name} instruction armed.</span>}
  </div>;
}

export function DrawerAutoRunNotice({ task, controller, columns, sessionTitles }: {
  task: Task; controller: AutoRunController; columns: readonly Column[]; sessionTitles?: SessionTitleSource;
}) {
  const entry = useAutoRunEntry(controller, task.id);
  const seconds = useCountdown(entry?.status === 'counting' ? entry.deadline : null);
  if (!entry) return null;
  const column = columns.find(value => value.id === entry.columnId);
  const stage = column?.name ?? entry.columnId;
  const open = firstOpenSessionId(task);
  const target = open === undefined ? 'a new conversation' : conversationLabel(task, open, sessionTitles);
  if (entry.status === 'failed') return <div className="kb-drawer-autorun kb-drawer-autorun-failed" data-status="failed">
    <p role="alert"><strong>Automatic {stage} instruction failed</strong><span>{entry.error?.message ?? RUN_FAILURE_FALLBACK}</span></p>
  </div>;
  return <div className={'kb-drawer-autorun kb-drawer-autorun-' + entry.status} data-status={entry.status}>
    <p role={entry.status === 'sending' ? 'status' : undefined}>
      {entry.status === 'sending' ? 'Sending the ' + stage + ' instruction to ' + target + '…' : 'Sending the ' + stage + ' instruction to ' + target + ' in ' + seconds + 's.'}
    </p>
    {entry.status === 'counting' && <>
      <button type="button" className="kb-button" aria-label={'Cancel automatic ' + stage + ' instruction'} onClick={() => controller.cancel(task.id)}>Cancel</button>
      <span className="kb-sr" role="status">Automatic {stage} instruction armed.</span>
    </>}
  </div>;
}
