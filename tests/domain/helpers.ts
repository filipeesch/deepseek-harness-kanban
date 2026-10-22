import type { StateStorage } from '../../src/shared/ports.js';
import type { BoardState, Project, Task } from '../../src/shared/types.js';
import { initialState } from '../../src/domain/schema.js';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class MemoryStorage implements StateStorage {
  data: unknown | null = null;
  writes: BoardState[] = [];
  failSave = false;
  failLoad = false;
  nextSave: ReturnType<typeof deferred<void>> | undefined;
  enteredSave: ReturnType<typeof deferred<void>> | undefined;

  async load(): Promise<unknown | null> {
    if (this.failLoad) throw new Error('Load failed.');
    return structuredClone(this.data);
  }

  async save(state: BoardState): Promise<void> {
    const wait = this.nextSave;
    this.nextSave = undefined;
    this.enteredSave?.resolve();
    this.enteredSave = undefined;
    if (wait) await wait.promise;
    if (this.failSave) throw new Error('Disk is full.');
    this.data = structuredClone(state);
    this.writes.push(structuredClone(state));
  }
}

export const sampleProject = (id = 'project-1'): Project => ({
  id, name: 'API', projectPath: '/repos/platform/services/api', gitRootPath: '/repos/platform',
});

export function sampleTask(id = 'task-1', sessionId = 'session-1'): Task {
  return {
    id, projectId: 'project-1', title: 'Ship endpoint', description: '**Acceptance** criteria',
    columnId: 'backlog', position: 0, sessionIds: [sessionId], closedSessionIds: [],
    effectiveCwd: '/repos/platform/services/api', worktree: null, operation: null,
    createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z',
  };
}

export function populatedState(): BoardState {
  const state = initialState();
  state.projects.push(sampleProject());
  state.tasks.push(sampleTask());
  state.notes.push({ id: 'note-1', taskId: 'task-1', content: '# Shared note', createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z' });
  return state;
}
