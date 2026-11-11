import { KanbanError } from '../shared/errors.js';
import type { SessionPort } from '../shared/ports.js';
import type { Task } from '../shared/types.js';
import type { ConversationProbe } from './conversation-probe.js';
import type { DestructiveJournal } from './destructive-journal.js';

/** The archiver stopped because a conversation is still running; the operation waits. */
export class WaitingForIdle extends KanbanError {
  constructor() { super('SESSION_ACTIVE', 'Wait for the conversation and all owned activity before archiving it.'); }
}

export interface SessionArchiverDependencies {
  sessions: Pick<SessionPort, 'archive'>;
  probe: ConversationProbe;
  journal: DestructiveJournal;
}

/**
 * Archives a task's conversations one at a time, recording each archived id
 * immediately so a restart never archives the same conversation twice. A running
 * conversation stops the step and asks the operation to wait instead of failing.
 */
export class SessionArchiver {
  constructor(private readonly dependencies: SessionArchiverDependencies) {}

  async archive(input: { task: Task; operationId: string }): Promise<'done'> {
    const { journal, probe, sessions } = this.dependencies;
    // A resumed execution may only have archiving left; then it owns the phase now.
    // During an overlap the checkout step advances the phase when it finishes.
    if (journal.read().task.operation?.gitCompleted) {
      await journal.update(input.operationId, (_task, operation) => { operation.phase = 'archiving'; });
    }
    for (const sessionId of input.task.sessionIds) {
      const latest = journal.read().task.operation;
      if (!latest) throw new KanbanError('OPERATION_CHANGED', 'The deletion operation changed.');
      if (latest.archivedSessionIds.includes(sessionId)) continue;
      if (!await probe.allIdle([sessionId])) throw new WaitingForIdle();
      journal.assertOpen();
      await sessions.archive(sessionId);
      await journal.update(input.operationId, (_task, operation) => { operation.archivedSessionIds.push(sessionId); });
    }
    return 'done';
  }
}
