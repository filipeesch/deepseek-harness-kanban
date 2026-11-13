import type { Command } from '../shared/types.js';

export function scopedCommand(command: Command, hubId: string | undefined, boardId: string | undefined, multiHub: boolean, multiBoard: boolean): Command {
  // The timed/manual instruction is task-scoped; the host resolves its Hub by task id.
  if (command.type === 'task.runInstruction' || command.type === 'task.deterministicPlay' || command.type === 'task.deterministicRunAgain' || command.type === 'task.deterministicCancelJob' || command.type === 'task.deterministicStop' || command.type === 'task.deterministicApprove' || command.type === 'task.deterministicVariable' || command.type === 'task.deterministicRetryDelivery' || command.type === 'task.deterministicParameters' || command.type === 'board.deterministicApprove') return command;
  if (command.type === 'settings.save' || command.type === 'hub.create' || command.type === 'hub.rename' || command.type === 'hub.delete' || command.type === 'retainedCheckout.dismiss' || command.type.startsWith('board.')) return command;
  if (command.type === 'task.create') return { ...command, ...(multiHub && hubId ? { hubId } : {}), ...(multiBoard && boardId ? { boardId } : {}) };
  return multiHub && hubId ? { ...command, hubId } : command;
}
