import React, { useState } from 'react';
import type { BoardState, Column, Task } from '../shared/types.js';
import { ErrorNotice, Markdown, Modal, useAction, type RunCommand } from './ui.js';

export function MoveDialog({ task, column, beforeTaskId, state, run, onClose }: { task: Task; column: Column; beforeTaskId: string | null; state: BoardState; run: RunCommand; onClose: () => void }) {
  const action = useAction(run);
  const [target, setTarget] = useState(task.sessionIds.find(id => !task.closedSessionIds.includes(id)) ?? task.sessionIds[0] ?? 'new');
  const [instruction] = useState(() => column.onEnterPrompt ?? '');
  const hasInstruction = Boolean(instruction.trim());
  const blocked = Boolean(task.operation || task.pendingTransition);
  async function move(mode: 'move' | 'run') {
    if (blocked || (mode === 'run' && !hasInstruction)) return;
    const result = await action.execute({
      type: 'task.move', taskId: task.id, columnId: column.id, mode,
      ...(beforeTaskId !== null ? { beforeTaskId } : {}),
      ...(mode === 'run' ? { expectedInstruction: instruction, ...(target === 'new' ? { newConversation: true } : { sessionId: target }) } : {}),
    });
    if (result) onClose();
  }
  return <Modal title={'Move to ' + column.name} onClose={onClose} busy={action.pending}><div className="kb-form">
    <p>Move <strong>{task.title}</strong> from {state.workflow.columns.find(value => value.id === task.columnId)?.name ?? task.columnId} to {column.name}.</p>
    {hasInstruction && <><section className="kb-instruction" aria-label="Entry instruction"><h3>Suggested entry instruction</h3><Markdown>{instruction}</Markdown></section><label className="kb-field">Run in conversation<select className="kb-input" value={target} disabled={action.pending || blocked} onChange={event => setTarget(event.target.value)}>{task.sessionIds.map((id, index) => <option value={id} key={id}>Agent {index + 1}{task.closedSessionIds.includes(id) ? ' (closed tab)' : ''}</option>)}<option value="new">New conversation</option></select></label><p className="kb-hint">Move only organizes the task. No instruction runs unless you choose Move and run.</p></>}
    {blocked && <p role="status">Resolve the current task operation before moving this task.</p>}
    <ErrorNotice problem={action.error} />
    <div className="kb-actions"><button type="button" className="kb-button" disabled={action.pending} onClick={onClose}>Cancel</button><button type="button" className="kb-button" disabled={action.pending || blocked} onClick={() => void move('move')}>{action.pending ? 'Moving…' : 'Move only'}</button>{hasInstruction && <button type="button" className="kb-button kb-primary" disabled={action.pending || blocked || !target} onClick={() => void move('run')}>Move and run</button>}</div>
  </div></Modal>;
}
