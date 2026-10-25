import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { StateStorage } from '../shared/ports.js';
import type { BoardSettings, BoardState, NewTask, Note, Project, ProjectInput, Task, Workflow } from '../shared/types.js';
import { DATA_VERSION } from '../shared/types.js';
import { KanbanError, invariant } from '../shared/errors.js';
import { BoardStateSchema, initialState } from './schema.js';
import { parseWorkflow } from './workflow.js';
import { entryInstruction, nextEnteredAt } from './stage-entry.js';
import { assertId, assertRevision, isAbsolutePath } from './validation.js';

export interface NoteInput { id?: string; content: string; tags?: string[] }
export interface TaskTextPatch { title?: string; description?: string }
export type BoardListener = (state: BoardState) => void;

function clone<T>(value: T): T {
  try { return structuredClone(value); }
  catch { throw new KanbanError('INVALID_INPUT', 'Domain values must be structured-cloneable.'); }
}

function invalidState(value: unknown): BoardState {
  let result: ReturnType<typeof BoardStateSchema.safeParse>;
  try { result = BoardStateSchema.safeParse(value); }
  catch { throw new KanbanError('INVALID_STATE', 'Board state contains invalid or cyclic data.'); }
  if (!result.success) {
    throw new KanbanError('INVALID_STATE', 'Board state is invalid.', {
      issues: result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

function requiredText(value: unknown, label: string): string {
  invariant(typeof value === 'string' && value.trim().length > 0, 'INVALID_INPUT', label + ' must be nonempty text.');
  return value;
}

function storageFailure(operation: 'load' | 'save', error: unknown): KanbanError {
  const detail = error instanceof Error ? error.message : String(error);
  return new KanbanError(operation === 'load' ? 'STORAGE_LOAD_FAILED' : 'STORAGE_SAVE_FAILED',
    'Could not durably ' + operation + ' board state: ' + detail);
}

function nextId(values: { id: string }[]): string {
  const existing = new Set(values.map(value => value.id));
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomUUID();
    if (!existing.has(candidate)) return candidate;
  }
  throw new KanbanError('ID_COLLISION', 'Could not allocate a unique identifier.');
}

/** One authoritative writer: validate, await storage durability, then publish isolated snapshots. */
export class BoardStore {
  private state: BoardState;
  private tail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<BoardListener>();
  private readonly mutationContext = new AsyncLocalStorage<{ active: boolean }>();

  private constructor(private readonly storage: StateStorage, state: BoardState) {
    this.state = clone(state);
  }

  static async open(storage: StateStorage): Promise<BoardStore> {
    invariant(storage && typeof storage.load === 'function' && typeof storage.save === 'function', 'INVALID_STORAGE', 'StateStorage must provide load and save.');
    let loaded: unknown;
    try { loaded = await storage.load(); }
    catch (error) { throw storageFailure('load', error); }
    if (loaded === null) {
      const state = invalidState(initialState());
      try { await storage.save(clone(state)); }
      catch (error) { throw storageFailure('save', error); }
      return new BoardStore(storage, state);
    }
    if (typeof loaded === 'object' && loaded !== null && 'schemaVersion' in loaded && (loaded as { schemaVersion?: unknown }).schemaVersion === 1) {
      const migrated = clone(loaded) as Record<string, unknown>;
      const tasks = Array.isArray(migrated.tasks) ? migrated.tasks : [];
      for (const item of tasks) {
        if (!item || typeof item !== 'object' || !('archivedAt' in item)) continue;
        const archive = (item as Record<string, unknown>).archivedAt;
        if (archive !== null && archive !== undefined) {
          throw new KanbanError('LEGACY_ARCHIVED_TASK', 'Stored task archive metadata is not supported by the delete-only lifecycle.', { taskId: (item as { id?: unknown }).id });
        }
      }
      migrated.schemaVersion = DATA_VERSION;
      if (Array.isArray(migrated.tasks)) {
        migrated.tasks = migrated.tasks.map(item => {
          if (!item || typeof item !== 'object') return item;
          const copy = { ...(item as Record<string, unknown>) };
          delete copy.archivedAt;
          return copy;
        });
      }
      const state = invalidState(migrated);
      try { await storage.save(clone(state)); }
      catch (error) { throw storageFailure('save', error); }
      return new BoardStore(storage, state);
    }
    if (typeof loaded === 'object' && loaded !== null && 'schemaVersion' in loaded && loaded.schemaVersion !== DATA_VERSION) {
      throw new KanbanError('UNSUPPORTED_VERSION', 'Stored board schema version is not supported.', { supportedVersion: DATA_VERSION });
    }
    return new BoardStore(storage, invalidState(clone(loaded)));
  }

  snapshot(): BoardState { return clone(this.state); }

  /** Listeners receive commits only, never drafts or a shared mutable instance. */
  subscribe(listener: BoardListener): () => void {
    invariant(typeof listener === 'function', 'INVALID_INPUT', 'A subscription requires a listener.');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  transact<T>(fn: (draft: BoardState) => T | Promise<T>, expectedRevision?: number): Promise<T> {
    if (this.mutationContext.getStore()?.active) {
      return Promise.reject(new KanbanError('REENTRANT_TRANSACTION', 'A transaction cannot await another transaction on the same store.'));
    }
    const execution = this.tail.then(async () => {
      invariant(typeof fn === 'function', 'INVALID_INPUT', 'A transaction requires a mutation function.');
      if (expectedRevision !== undefined) {
        assertRevision(expectedRevision);
        invariant(expectedRevision === this.state.revision, 'REVISION_CONFLICT', 'Board state has changed since this revision.');
      }
      invariant(this.state.revision < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED', 'Board revision cannot be incremented safely.');
      const previousRevision = this.state.revision;
      const draft = clone(this.state);
      const scope = { active: true };
      let result: T;
      try { result = await this.mutationContext.run(scope, () => fn(draft)); }
      finally { scope.active = false; }
      invariant(draft.revision === previousRevision, 'INVALID_REVISION', 'Transactions cannot change their own revision.');
      invariant(draft.schemaVersion === DATA_VERSION, 'UNSUPPORTED_VERSION', 'Transactions cannot change the schema version.');
      draft.revision = previousRevision + 1;
      const next = clone(invalidState(draft));
      const isolatedResult = clone(result);
      try { await this.storage.save(clone(next)); }
      catch (error) { throw storageFailure('save', error); }
      this.state = next;
      for (const listener of [...this.listeners]) {
        try {
          const pending: unknown = (listener as (state: BoardState) => unknown)(clone(next));
          if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(pending).catch(() => undefined);
          }
        } catch { /* An observer cannot roll back or poison a durable commit. */ }
      }
      return isolatedResult;
    });
    this.tail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  requireTask(taskId: string, state: BoardState = this.snapshot()): Task {
    assertId(taskId, 'Task ID');
    const task = state.tasks.find(value => value.id === taskId);
    invariant(task, 'TASK_NOT_FOUND', 'Task does not exist.');
    return task;
  }

  requireProject(projectId: string, state: BoardState = this.snapshot()): Project {
    assertId(projectId, 'Project ID');
    const project = state.projects.find(value => value.id === projectId);
    invariant(project, 'PROJECT_NOT_FOUND', 'Project does not exist.');
    return project;
  }

  async saveProject(input: ProjectInput, expectedRevision?: number): Promise<Project> {
    const value = clone(input);
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Project input must be a mapping.');
    requiredText(value.name, 'Project name');
    if (value.id !== undefined) assertId(value.id, 'Project ID');
    return this.transact(state => {
      const projectId = value.id ?? nextId(state.projects);
      const current = state.projects.find(project => project.id === projectId);
      if (current && (current.projectPath !== value.projectPath || current.gitRootPath !== value.gitRootPath)) {
        invariant(!state.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Project paths cannot change while tasks reference the project.');
      }
      const project: Project = { id: projectId, name: value.name.trim(), projectPath: value.projectPath, gitRootPath: value.gitRootPath, ...(current?.workspaceId ? { workspaceId: current.workspaceId } : {}), ...(current?.workspaceOwned !== undefined ? { workspaceOwned: current.workspaceOwned } : {}) };
      if (value.defaultBranch !== undefined) {
        invariant(typeof value.defaultBranch === 'string', 'INVALID_INPUT', 'Default branch must be text.');
        if (value.defaultBranch.trim()) project.defaultBranch = value.defaultBranch.trim();
      }
      if (current) state.projects[state.projects.indexOf(current)] = project;
      else state.projects.push(project);
      return project;
    }, expectedRevision);
  }

  async saveSettings(input: BoardSettings, expectedRevision?: number): Promise<BoardSettings> {
    const value = clone(input);
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Settings input must be a mapping.');
    invariant(Object.keys(value).every(key => key === 'worktreeBasePath'), 'INVALID_INPUT', 'Unsupported board setting.');
    const raw = value.worktreeBasePath;
    invariant(raw === undefined || typeof raw === 'string', 'INVALID_INPUT', 'Worktree base path must be text.');
    const base = raw?.trim();
    invariant(!base || isAbsolutePath(base), 'INVALID_INPUT', 'Worktree base path must be an absolute path.');
    return this.transact(state => {
      const next: BoardSettings = base ? { worktreeBasePath: base } : {};
      state.settings = next;
      return next;
    }, expectedRevision);
  }

  async deleteProject(projectId: string, expectedRevision?: number): Promise<Project> {
    assertId(projectId, 'Project ID');
    return this.transact(state => {
      const project = this.requireProject(projectId, state);
      invariant(!state.tasks.some(task => task.projectId === projectId), 'PROJECT_IN_USE', 'Move or delete the tasks in this project before deleting the project.');
      state.projects.splice(state.projects.indexOf(project), 1);
      return project;
    }, expectedRevision);
  }

  async setProjectWorkspace(projectId: string, workspaceId: string, owned: boolean): Promise<Project> {
    assertId(workspaceId, 'Workspace ID');
    return this.transact(state => {
      const project = this.requireProject(projectId, state);
      project.workspaceId = workspaceId;
      project.workspaceOwned = owned;
      return project;
    });
  }

  async setTaskWorktreeWorkspace(taskId: string, workspaceId: string, owned: boolean): Promise<Task> {
    assertId(workspaceId, 'Workspace ID');
    return this.transact(state => {
      const task = this.requireTask(taskId, state);
      task.worktreeWorkspaceId = workspaceId;
      task.worktreeWorkspaceOwned = owned;
      return task;
    });
  }

  async createTask(input: NewTask, sessionId: string): Promise<Task> {
    const value = clone(input);
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'New task input must be a mapping.');
    assertId(sessionId, 'Session ID');
    requiredText(value.title, 'Task title');
    invariant(typeof value.description === 'string', 'INVALID_INPUT', 'Task description must be text.');
    return this.transact(state => {
      const project = this.requireProject(value.projectId, state);
      this.assertAvailableSession(state, sessionId);
      const peers = state.tasks.filter(task => task.columnId === state.workflow.initialColumnId);
      let position = peers.length ? peers.reduce((minimum, task) => Math.min(minimum, task.position), Infinity) - 1 : 0;
      if (!Number.isFinite(position) || peers.some(task => task.position === position)) {
        peers.sort((left, right) => left.position - right.position).forEach((task, index) => { task.position = index; });
        position = -1;
      }
      const timestamp = new Date().toISOString();
      const initialColumn = state.workflow.columns.find(column => column.id === state.workflow.initialColumnId);
      const initialInstruction = entryInstruction(initialColumn);
      const task: Task = {
        id: nextId(state.tasks), projectId: project.id, title: value.title.trim(), description: value.description,
        columnId: state.workflow.initialColumnId, position, sessionIds: [sessionId], closedSessionIds: [], effectiveCwd: project.projectPath,
        worktree: null, operation: null, ...(initialInstruction !== undefined ? { instructionPending: { columnId: initialColumn!.id, enteredAt: nextEnteredAt() } } : {}), createdAt: timestamp, updatedAt: timestamp,
      };
      state.tasks.push(task);
      return task;
    });
  }

  async editTask(taskId: string, patch: TaskTextPatch, expectedRevision?: number): Promise<Task> {
    const value = clone(patch);
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Task edits must be a mapping.');
    invariant(Object.keys(value).every(key => key === 'title' || key === 'description'), 'INVALID_INPUT', 'Only task title and description can be edited here.');
    invariant(value.title !== undefined || value.description !== undefined, 'INVALID_INPUT', 'Provide a task title or description to edit.');
    if (value.title !== undefined) requiredText(value.title, 'Task title');
    if (value.description !== undefined) invariant(typeof value.description === 'string', 'INVALID_INPUT', 'Task description must be text.');
    return this.transact(state => {
      const task = this.requireTask(taskId, state);
      if (value.title !== undefined) task.title = value.title.trim();
      if (value.description !== undefined) task.description = value.description;
      task.updatedAt = new Date().toISOString();
      return task;
    }, expectedRevision);
  }

  async addSession(taskId: string, sessionId: string): Promise<Task> {
    assertId(sessionId, 'Session ID');
    return this.transact(state => {
      const task = this.requireTask(taskId, state);
      invariant(!task.operation, 'TASK_BUSY', 'Cannot add a conversation during a context operation.');
      this.assertAvailableSession(state, sessionId);
      task.sessionIds.push(sessionId);
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  async closeSession(taskId: string, sessionId: string): Promise<Task> {
    return this.changeSessionVisibility(taskId, sessionId, true);
  }

  async reopenSession(taskId: string, sessionId: string): Promise<Task> {
    return this.changeSessionVisibility(taskId, sessionId, false);
  }

  async setWorkflow(yaml: string, expectedRevision?: number): Promise<Workflow> {
    const workflow = parseWorkflow(yaml);
    return this.transact(state => {
      const ids = new Set(workflow.columns.map(column => column.id));
      const referencedColumns = state.tasks.flatMap(task => task.pendingTransition ? [task.columnId, task.pendingTransition.fromColumnId, task.pendingTransition.columnId] : [task.columnId]);
      const orphaned = [...new Set(referencedColumns.filter(columnId => !ids.has(columnId)))];
      invariant(orphaned.length === 0, 'WORKFLOW_ORPHAN_COLUMNS', 'Workflow update would orphan existing task columns: ' + orphaned.join(', ') + '.');
      state.workflowYaml = yaml;
      state.workflow = workflow;
      return workflow;
    }, expectedRevision);
  }

  async saveNote(taskId: string, input: NoteInput): Promise<Note> {
    const value = clone(input);
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Note input must be a mapping.');
    requiredText(value.content, 'Note content');
    if (value.id !== undefined) assertId(value.id, 'Note ID');
    if (value.tags !== undefined) invariant(Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string' && tag.trim()), 'INVALID_INPUT', 'Note tags must be nonempty text values.');
    return this.transact(state => {
      this.requireTask(taskId, state);
      const timestamp = new Date().toISOString();
      let note: Note;
      if (value.id !== undefined) {
        const current = state.notes.find(item => item.id === value.id && item.taskId === taskId);
        invariant(current, 'NOTE_NOT_FOUND', 'Note does not exist for the target task.');
        note = { ...current, content: value.content, updatedAt: timestamp };
        state.notes[state.notes.indexOf(current)] = note;
      } else {
        note = { id: nextId(state.notes), taskId, content: value.content, createdAt: timestamp, updatedAt: timestamp };
        state.notes.push(note);
      }
      if (value.tags !== undefined) note.tags = [...new Set(value.tags.map(tag => tag.trim()))];
      return note;
    });
  }

  private assertAvailableSession(state: BoardState, sessionId: string): void {
    invariant(!state.tasks.some(task => task.sessionIds.includes(sessionId)), 'SESSION_IN_USE', 'Native session is already associated with a task.');
  }

  private async changeSessionVisibility(taskId: string, sessionId: string, closed: boolean): Promise<Task> {
    assertId(sessionId, 'Session ID');
    return this.transact(state => {
      const task = this.requireTask(taskId, state);
      invariant(task.sessionIds.includes(sessionId), 'SESSION_NOT_FOUND', 'Conversation does not belong to the task.');
      if (closed && !task.closedSessionIds.includes(sessionId)) task.closedSessionIds.push(sessionId);
      if (!closed) task.closedSessionIds = task.closedSessionIds.filter(id => id !== sessionId);
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }
}
