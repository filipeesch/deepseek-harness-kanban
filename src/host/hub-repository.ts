import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { KanbanError, invariant } from '../shared/errors.js';
import type { Board, BoardSettings, HubState, HubTask, KanbanMeta, KanbanState, Note, Project, ProjectInput, Workflow } from '../shared/types.js';
import type { HubStorage } from '../shared/ports.js';
import { HubStateSchema, initialHubState, defaultHubState } from '../domain/hub-schema.js';
import type { NoteInput, OperationDeps, TaskTextPatch } from '../domain/hub-operations.js';
import * as operations from '../domain/hub-operations.js';
import { assertRevision, isDomainId } from '../domain/validation.js';

export interface HubRepositoryOptions { id?: () => string; now?: () => string }
export interface LocatedTask { hubId: string; hub: HubState; board: Board; project: Project; task: HubTask }

function storageFailure(operation: 'load' | 'save' | 'delete', error: unknown): KanbanError {
  const detail = error instanceof Error ? error.message : String(error);
  const code = operation === 'load' ? 'STORAGE_LOAD_FAILED' : operation === 'delete' ? 'STORAGE_DELETE_FAILED' : 'STORAGE_SAVE_FAILED';
  return new KanbanError(code, 'Could not durably ' + operation + ' Kanban state: ' + detail);
}

function nameKey(value: string): string { return value.trim().toLocaleLowerCase(); }
function parseHub(value: unknown, message: string): HubState {
  try { return HubStateSchema.parse(value); }
  catch (error) { throw new KanbanError('INVALID_STATE', message, { cause: error instanceof Error ? error.message : String(error) }); }
}

/**
 * One authoritative Hub-record writer. Writes are serialized through a single
 * tail so names, the last-Hub invariant, settings, and cross-Hub ownership have
 * one ordering. The storage adapter still persists one Hub record per write.
 */
export class HubRepository {
  private readonly hubs = new Map<string, HubState>();
  private meta: KanbanMeta;
  private readonly listeners = new Set<() => void>();
  private readonly mutationContext = new AsyncLocalStorage<{ active: boolean }>();
  private tail: Promise<void> = Promise.resolve();
  private readonly id: () => string;
  private readonly now: () => string;
  private disposed = false;

  private constructor(private readonly storage: HubStorage, hubs: HubState[], meta: KanbanMeta, options: HubRepositoryOptions = {}) {
    this.hubs = new Map(hubs.map(hub => [hub.id, hub]));
    this.meta = meta;
    this.id = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  static async open(storage: HubStorage, options: HubRepositoryOptions = {}): Promise<HubRepository> {
    invariant(storage && typeof storage.loadAll === 'function', 'INVALID_STORAGE', 'HubStorage must provide loadAll.');
    let loaded: Awaited<ReturnType<HubStorage['loadAll']>>;
    try { loaded = await storage.loadAll(); }
    catch (error) { throw storageFailure('load', error); }
    const hubIds = new Set<string>();
    for (const hub of loaded.hubs) { invariant(!hubIds.has(hub.id), 'INVALID_STATE', 'A Hub identifier is duplicated in storage.'); hubIds.add(hub.id); }
    const hubs = loaded.hubs.map(hub => parseHub(hub, 'Stored Hub data is invalid.'));
    const repository = new HubRepository(storage, hubs, loaded.meta, options);
    if (repository.hubs.size === 0) {
      const at = repository.now();
      const hub = parseHub(defaultHubState(repository.allocateId('default', new Set()), 'My Hub', repository.allocateId('board', new Set()), 'Kanban', at), 'Could not create the default Hub.');
      await repository.persistHub(hub);
      repository.hubs.set(hub.id, hub);
      await repository.persistMeta({ ...repository.meta, initializedAt: at });
      repository.meta = { ...repository.meta, initializedAt: at };
    }
    repository.assertLoadedOwnership();
    return repository;
  }

  private allocateId(prefix: string, existing: Set<string>): string {
    if (isDomainId(prefix) && !existing.has(prefix)) return prefix;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = this.id();
      if (isDomainId(candidate) && !existing.has(candidate)) return candidate;
    }
    throw new KanbanError('ID_COLLISION', 'Could not allocate a unique identifier.');
  }

  private hubId(name: string): string {
    const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    return this.allocateId(slug || 'hub', new Set(this.hubs.keys()));
  }

  private assertLoadedOwnership(): void {
    const taskIds = new Set<string>();
    const sessionIds = new Set<string>();
    const projectIds = new Set<string>();
    const boardIds = new Set<string>();
    const names = new Set<string>();
    for (const hub of this.hubs.values()) {
      invariant(!names.has(nameKey(hub.name)), 'INVALID_STATE', 'A Hub name is owned by more than one Hub.');
      names.add(nameKey(hub.name));
      for (const board of hub.boards) {
        invariant(!boardIds.has(board.id), 'INVALID_STATE', 'A board identifier is owned by more than one Hub.');
        boardIds.add(board.id);
      }
      for (const project of hub.projects) {
        invariant(!projectIds.has(project.id), 'INVALID_STATE', 'A project identifier is owned by more than one Hub.');
        projectIds.add(project.id);
      }
      for (const task of hub.tasks) {
        invariant(!taskIds.has(task.id), 'INVALID_STATE', 'A task identifier is owned by more than one Hub.');
        taskIds.add(task.id);
        for (const sessionId of task.sessionIds) {
          invariant(!sessionIds.has(sessionId), 'INVALID_STATE', 'A native session is owned by more than one Hub.');
          sessionIds.add(sessionId);
        }
      }
    }
  }

  private assertCrossHubOwnership(next: HubState): void {
    const taskIds = new Set<string>();
    const sessionIds = new Set<string>();
    const projectIds = new Set<string>();
    const boardIds = new Set<string>();
    for (const hub of this.hubs.values()) {
      if (hub.id === next.id) continue;
      for (const project of hub.projects) projectIds.add(project.id);
      for (const board of hub.boards) boardIds.add(board.id);
      for (const task of hub.tasks) {
        taskIds.add(task.id);
        for (const sessionId of task.sessionIds) sessionIds.add(sessionId);
      }
    }
    for (const project of next.projects) invariant(!projectIds.has(project.id), 'PROJECT_ID_CONFLICT', 'A project identifier is already owned by another Hub.');
    for (const board of next.boards) invariant(!boardIds.has(board.id), 'BOARD_ID_CONFLICT', 'A board identifier is already owned by another Hub.');
    for (const task of next.tasks) {
      invariant(!taskIds.has(task.id), 'TASK_ID_CONFLICT', 'A task identifier is already owned by another Hub.');
      for (const sessionId of task.sessionIds) invariant(!sessionIds.has(sessionId), 'SESSION_IN_USE', 'A native session is already owned by another Hub.');
    }
  }

  private async persistHub(hub: HubState): Promise<void> {
    try { await this.storage.saveHub(structuredClone(hub)); }
    catch (error) { throw storageFailure('save', error); }
  }

  private async persistMeta(meta: KanbanMeta): Promise<void> {
    try { await this.storage.saveMeta(structuredClone(meta)); }
    catch (error) { throw storageFailure('save', error); }
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* An observer cannot roll back or poison a durable commit. */ }
    }
  }

  subscribe(listener: () => void): () => void {
    invariant(typeof listener === 'function', 'INVALID_INPUT', 'A subscription requires a listener.');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  list(): HubState[] {
    return [...this.hubs.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(hub => structuredClone(hub));
  }

  snapshot(): KanbanState {
    return {
      hubs: this.list(),
      settings: { revision: this.meta.settingsRevision, ...(this.meta.worktreeBasePath ? { worktreeBasePath: this.meta.worktreeBasePath } : {}) },
    };
  }

  settingsView(): BoardSettings {
    return this.meta.worktreeBasePath ? { worktreeBasePath: this.meta.worktreeBasePath } : {};
  }

  get(hubId: string): HubState | undefined {
    const hub = this.hubs.get(hubId);
    return hub ? structuredClone(hub) : undefined;
  }

  requireHub(hubId: string): HubState {
    const hub = this.hubs.get(hubId);
    invariant(hub, 'HUB_NOT_FOUND', 'Hub does not exist.');
    return hub;
  }

  defaultHubId(): string {
    const first = this.list()[0];
    invariant(first, 'HUB_NOT_FOUND', 'No Hub exists.');
    return first.id;
  }

  resolveHubId(hubId?: string): string {
    if (hubId !== undefined) { this.requireHub(hubId); return hubId; }
    const hubs = this.list();
    invariant(hubs.length === 1, 'HUB_CONTEXT_REQUIRED', 'Choose a Hub explicitly when more than one exists.');
    return hubs[0]!.id;
  }

  hub(hubId: string): HubStore { return new HubStore(this, hubId); }

  defaultHub(): HubStore { return this.hub(this.defaultHubId()); }

  requireTask(taskId: string): LocatedTask {
    const found = this.findTask(taskId);
    invariant(found, 'TASK_NOT_FOUND', 'Task does not exist.');
    return found;
  }

  findTask(taskId: string): LocatedTask | undefined {
    for (const hub of this.hubs.values()) {
      const task = hub.tasks.find(value => value.id === taskId);
      if (!task) continue;
      const board = hub.boards.find(value => value.id === task.boardId);
      const project = hub.projects.find(value => value.id === task.projectId);
      if (!board || !project) return undefined;
      return { hubId: hub.id, hub: structuredClone(hub), board: structuredClone(board), project: structuredClone(project), task: structuredClone(task) };
    }
    return undefined;
  }

  findBoard(boardId: string): { hubId: string; hub: HubState; board: Board } | undefined {
    for (const hub of this.hubs.values()) {
      const board = hub.boards.find(value => value.id === boardId);
      if (board) return { hubId: hub.id, hub: structuredClone(hub), board: structuredClone(board) };
    }
    return undefined;
  }

  findTaskBySession(sessionId: string): LocatedTask | undefined {
    for (const hub of this.hubs.values()) {
      const task = hub.tasks.find(value => value.sessionIds.includes(sessionId));
      if (!task) continue;
      const board = hub.boards.find(value => value.id === task.boardId);
      const project = hub.projects.find(value => value.id === task.projectId);
      if (!board || !project) return undefined;
      return { hubId: hub.id, hub: structuredClone(hub), board: structuredClone(board), project: structuredClone(project), task: structuredClone(task) };
    }
    return undefined;
  }

  allTasks(): LocatedTask[] {
    const result: LocatedTask[] = [];
    for (const hub of this.hubs.values()) {
      for (const task of hub.tasks) {
        const board = hub.boards.find(value => value.id === task.boardId);
        const project = hub.projects.find(value => value.id === task.projectId);
        if (board && project) result.push({ hubId: hub.id, hub: structuredClone(hub), board: structuredClone(board), project: structuredClone(project), task: structuredClone(task) });
      }
    }
    return result;
  }

  async createHub(name: string): Promise<HubState> {
    return this.mutate(async () => {
      const value = name.trim();
      invariant(value.length > 0, 'INVALID_INPUT', 'Hub name must be nonempty text.');
      const key = nameKey(value);
      invariant(![...this.hubs.values()].some(hub => nameKey(hub.name) === key), 'HUB_NAME_CONFLICT', 'A Hub with this name already exists.');
      const at = this.now();
      const hub = parseHub(initialHubState(this.hubId(value), value, at), 'Could not create a valid Hub.');
      await this.persistHub(hub);
      this.hubs.set(hub.id, hub);
      this.changed();
      return structuredClone(hub);
    });
  }

  async renameHub(hubId: string, name: string, expectedRevision?: number): Promise<HubState> {
    return this.transact(hubId, draft => { operations.renameHub(draft, name, this.deps()); return draft; }, expectedRevision, draft => {
      const key = draft.name.trim().toLocaleLowerCase();
      invariant(![...this.hubs.values()].some(hub => hub.id !== draft.id && hub.name.trim().toLocaleLowerCase() === key), 'HUB_NAME_CONFLICT', 'A Hub with this name already exists.');
    });
  }

  async deleteHub(hubId: string): Promise<HubState> {
    return this.mutate(async () => {
      const hub = this.requireHub(hubId);
      invariant(this.hubs.size > 1, 'LAST_HUB', 'At least one Hub must exist.');
      invariant(hub.tasks.length === 0, 'HUB_IN_USE', 'Delete the tasks in every board before deleting the Hub.');
      try { await this.storage.deleteHub(hubId); }
      catch (error) { throw storageFailure('delete', error); }
      this.hubs.delete(hubId);
      this.changed();
      return structuredClone(hub);
    });
  }

  async saveSettings(input: BoardSettings, expectedRevision?: number): Promise<BoardSettings> {
    return this.mutate(async () => {
      if (expectedRevision !== undefined) {
        assertRevision(expectedRevision);
        invariant(expectedRevision === this.meta.settingsRevision, 'REVISION_CONFLICT', 'Kanban settings have changed since this revision.');
      }
      invariant(this.meta.settingsRevision < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED', 'Settings revision cannot be incremented safely.');
      const next = operations.normalizeSettings(input);
      const meta: KanbanMeta = { ...this.meta, settingsRevision: this.meta.settingsRevision + 1, ...(next.worktreeBasePath ? { worktreeBasePath: next.worktreeBasePath } : {}) };
      if (!next.worktreeBasePath) delete meta.worktreeBasePath;
      await this.persistMeta(meta);
      this.meta = meta;
      this.changed();
      return next;
    });
  }

  async transact<T>(hubId: string, change: (draft: HubState) => T | Promise<T>, expectedRevision?: number, validate?: (draft: HubState) => void): Promise<T> {
    return this.mutate(async () => {
      const current = this.requireHub(hubId);
      if (expectedRevision !== undefined) {
        assertRevision(expectedRevision);
        invariant(expectedRevision === current.revision, 'REVISION_CONFLICT', 'Hub state has changed since this revision.');
      }
      invariant(current.revision < Number.MAX_SAFE_INTEGER, 'REVISION_EXHAUSTED', 'Hub revision cannot be incremented safely.');
      const draft = structuredClone(current);
      const scope = { active: true };
      let result: T;
      try { result = await this.mutationContext.run(scope, () => change(draft)); }
      finally { scope.active = false; }
      validate?.(draft);
      invariant(draft.id === current.id && draft.createdAt === current.createdAt, 'INVALID_STATE', 'A transaction cannot change the Hub identity.');
      invariant(draft.revision === current.revision, 'INVALID_REVISION', 'Transactions cannot change their own revision.');
      draft.revision = current.revision + 1;
      draft.updatedAt = this.now();
      const next = parseHub(draft, 'Kanban state is invalid.');
      this.assertCrossHubOwnership(next);
      await this.persistHub(next);
      this.hubs.set(hubId, next);
      this.changed();
      return structuredClone(result);
    });
  }

  private deps(): OperationDeps { return { id: this.id, now: this.now }; }

  /** Operation dependencies are exposed to a Hub facade so IDs and clocks stay injectable. */
  operationDeps(): OperationDeps { return this.deps(); }

  private async mutate<T>(run: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new KanbanError('PLUGIN_DISPOSED', 'The Kanban repository is disposed.');
    if (this.mutationContext.getStore()?.active) throw new KanbanError('REENTRANT_TRANSACTION', 'A transaction cannot await another transaction on the same repository.');
    const execution = this.tail.then(() => run());
    this.tail = execution.then(() => undefined, () => undefined);
    return execution;
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.tail;
    this.listeners.clear();
    await this.storage.close();
  }
}

/** One Hub-scoped facade over the repository. It owns no state and no write chain of its own. */
export class HubStore {
  constructor(private readonly repository: HubRepository, readonly hubId: string) {}

  /** Single-board compatibility view for the first board; the persisted HubState does not carry these aliases. */
  snapshot(): HubState & { schemaVersion: 2; workflow: Workflow; workflowYaml: string; settings: BoardSettings } {
    const hub = this.repository.requireHub(this.hubId);
    const board = hub.boards[0];
    return {
      ...structuredClone(hub),
      schemaVersion: 2 as const,
      workflow: structuredClone(board?.workflow ?? { name: 'Workflow', initialColumnId: '', columns: [], groups: [] }),
      workflowYaml: board?.workflowYaml ?? '',
      settings: this.repository.settingsView(),
    };
  }

  subscribe(listener: (state: HubState) => void): () => void {
    return this.repository.subscribe(() => listener(this.snapshot()));
  }

  transact<T>(change: (draft: HubState) => T | Promise<T>, expectedRevision?: number): Promise<T> {
    return this.repository.transact(this.hubId, change, expectedRevision);
  }

  requireTask(taskId: string, state: HubState = this.snapshot()): HubTask { return operations.requireTask(state, taskId); }
  requireProject(projectId: string, state: HubState = this.snapshot()): Project { return operations.requireProject(state, projectId); }
  requireBoard(boardId: string, state: HubState = this.snapshot()): Board { return operations.requireBoard(state, boardId); }

  async saveProject(input: ProjectInput, expectedRevision?: number): Promise<Project> {
    return this.transact(draft => operations.saveProject(draft, input, this.deps()), expectedRevision);
  }
  async deleteProject(projectId: string, expectedRevision?: number): Promise<Project> {
    return this.transact(draft => operations.deleteProject(draft, projectId, this.deps()), expectedRevision);
  }
  async setProjectWorkspace(projectId: string, workspaceId: string, owned: boolean): Promise<Project> {
    return this.transact(draft => operations.setProjectWorkspace(draft, projectId, workspaceId, owned, this.deps()));
  }
  async setTaskWorktreeWorkspace(taskId: string, workspaceId: string, owned: boolean): Promise<HubTask> {
    return this.transact(draft => operations.setTaskWorktreeWorkspace(draft, taskId, workspaceId, owned, this.deps()));
  }
  async createTask(input: { projectId: string; title: string; description: string; boardId?: string }, sessionId: string): Promise<HubTask> {
    return this.transact(draft => {
      const boardId = input.boardId ?? draft.boards[0]?.id;
      invariant(boardId, 'BOARD_NOT_FOUND', 'The Hub has no board.');
      return operations.createTask(draft, { ...input, boardId }, sessionId, this.deps());
    });
  }
  async editTask(taskId: string, patch: TaskTextPatch, expectedRevision?: number): Promise<HubTask> {
    return this.transact(draft => operations.editTask(draft, taskId, patch, this.deps()), expectedRevision);
  }
  async addSession(taskId: string, sessionId: string): Promise<HubTask> {
    return this.transact(draft => operations.addSession(draft, taskId, sessionId, this.deps()));
  }
  async closeSession(taskId: string, sessionId: string): Promise<HubTask> {
    return this.transact(draft => operations.closeSession(draft, taskId, sessionId, this.deps()));
  }
  async reopenSession(taskId: string, sessionId: string): Promise<HubTask> {
    return this.transact(draft => operations.reopenSession(draft, taskId, sessionId, this.deps()));
  }
  async saveNote(taskId: string, input: NoteInput): Promise<Note> {
    return this.transact(draft => operations.saveNote(draft, taskId, input, this.deps()));
  }
  async deleteTask(taskId: string): Promise<HubTask> {
    return this.transact(draft => operations.deleteTask(draft, taskId));
  }
  async addBoard(name: string): Promise<Board> { return this.transact(draft => operations.addBoard(draft, name, this.deps())); }
  async renameBoard(boardId: string, name: string, expectedRevision?: number): Promise<Board> {
    return this.transact(draft => operations.renameBoard(draft, boardId, name, this.deps()), expectedRevision);
  }
  async deleteBoard(boardId: string, expectedRevision?: number): Promise<Board> {
    return this.transact(draft => operations.deleteBoard(draft, boardId, this.deps()), expectedRevision);
  }
  async saveBoardWorkflow(boardId: string, yaml: string, expectedRevision?: number): Promise<Workflow> {
    return this.transact(draft => operations.saveBoardWorkflow(draft, boardId, yaml, this.deps()), expectedRevision);
  }
  async setWorkflow(yaml: string, expectedRevision?: number): Promise<Workflow> {
    return this.transact(draft => {
      const board = draft.boards[0];
      invariant(board, 'BOARD_NOT_FOUND', 'The Hub has no board.');
      return operations.saveBoardWorkflow(draft, board.id, yaml, this.deps());
    }, expectedRevision);
  }
  async rename(name: string, expectedRevision?: number): Promise<HubState> {
    return this.transact(draft => { operations.renameHub(draft, name, this.deps()); return draft; }, expectedRevision);
  }
  private deps(): OperationDeps { return this.repository.operationDeps(); }
}
