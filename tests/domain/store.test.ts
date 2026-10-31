import { describe, expect, it } from 'vitest';
import type { BoardState, Project, Task } from '../../src/shared/types.js';
import { BoardStore } from '../../src/domain/store.js';
import { initialState } from '../../src/domain/schema.js';
import { DEFAULT_WORKFLOW_YAML } from '../../src/domain/workflow.js';
import { deferred, MemoryStorage, populatedState, sampleProject } from './helpers.js';

async function fixture() {
  const storage = new MemoryStorage();
  const store = await BoardStore.open(storage);
  const project = await store.saveProject(sampleProject());
  return { storage, store, project };
}

const newTask = { projectId: 'project-1', title: 'Add API', description: '**Spec**' };

/** Legacy storage fixture: create a task, then associate an explicit session when the test needs one. */
async function seedTask(store: BoardStore, sessionId: string, input = newTask): Promise<Task> {
  const task = await store.createTask(input);
  await store.addSession(task.id, sessionId);
  return store.requireTask(task.id);
}

describe('durable board transactions', () => {
  it('persists initial revision zero once and reopens without resetting or writing', async () => {
    const storage = new MemoryStorage();
    const store = await BoardStore.open(storage);
    expect(storage.writes).toHaveLength(1);
    expect(store.snapshot()).toEqual(initialState());
    await store.saveProject(sampleProject());
    const reopened = await BoardStore.open(storage);
    expect(reopened.snapshot()).toEqual(store.snapshot());
    expect(storage.writes).toHaveLength(2);
  });

  it('does not publish or expose a commit before storage resolves', async () => {
    const { storage, store } = await fixture();
    const barrier = deferred();
    const entered = deferred();
    storage.nextSave = barrier;
    storage.enteredSave = entered;
    const before = store.snapshot();
    const notifications: BoardState[] = [];
    store.subscribe(snapshot => notifications.push(snapshot));
    const pending = store.createTask(newTask);
    await entered.promise;
    expect(store.snapshot()).toEqual(before);
    expect(notifications).toEqual([]);
    barrier.resolve();
    await pending;
    expect(store.snapshot().revision).toBe(before.revision + 1);
    expect(notifications).toHaveLength(1);
    expect(storage.data).toEqual(notifications[0]);
  });

  it('keeps memory and observers unchanged on save failure and recovers the write chain', async () => {
    const { storage, store } = await fixture();
    const before = store.snapshot();
    let published = 0;
    store.subscribe(() => { published++; });
    storage.failSave = true;
    await expect(store.createTask(newTask)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(store.snapshot()).toEqual(before);
    expect(storage.data).toEqual(before);
    expect(published).toBe(0);
    storage.failSave = false;
    const task = await store.createTask(newTask);
    expect(task.sessionIds).toEqual([]);
    expect(published).toBe(1);
    expect(store.snapshot().revision).toBe(before.revision + 1);
  });

  it('serializes asynchronous writers without lost updates', async () => {
    const { store } = await fixture();
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const first = store.transact(async state => {
      order.push('first:start');
      entered.resolve();
      await release.promise;
      state.projects[0]!.name = 'First';
      order.push('first:end');
    });
    await entered.promise;
    const second = store.transact(state => {
      order.push('second');
      expect(state.projects[0]!.name).toBe('First');
      state.projects[0]!.name = 'Second';
    });
    expect(order).toEqual(['first:start']);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(store.snapshot().projects[0]!.name).toBe('Second');
    expect(store.snapshot().revision).toBe(3);
  });

  it('checks expected revisions when queued writes execute', async () => {
    const { store } = await fixture();
    const revision = store.snapshot().revision;
    const results = await Promise.allSettled([
      store.saveProject({ ...sampleProject(), name: 'Winner' }, revision),
      store.saveProject({ ...sampleProject(), name: 'Stale' }, revision),
    ]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'REVISION_CONFLICT' } });
    expect(store.snapshot().projects[0]!.name).toBe('Winner');
    expect(store.snapshot().revision).toBe(revision + 1);
  });

  it('isolates snapshots, mutator results, retained drafts, and each subscriber', async () => {
    const { store, storage } = await fixture();
    const received: string[] = [];
    store.subscribe(state => { state.projects[0]!.name = 'Observer mutation'; });
    store.subscribe(state => { received.push(state.projects[0]!.name); });
    const barrier = deferred();
    const entered = deferred();
    storage.nextSave = barrier;
    storage.enteredSave = entered;
    let retained!: BoardState;
    const pending = store.transact(state => { retained = state; state.projects[0]!.name = 'Committed'; return state.projects[0]!; });
    await entered.promise;
    retained.projects[0]!.name = 'Late draft mutation';
    barrier.resolve();
    const result = await pending;
    expect(result.name).toBe('Committed');
    result.name = 'Result mutation';
    const snapshot = store.snapshot();
    snapshot.projects[0]!.name = 'Snapshot mutation';
    expect(store.snapshot().projects[0]!.name).toBe('Committed');
    expect(received).toEqual(['Committed']);
    expect((storage.data as BoardState).projects[0]!.name).toBe('Committed');
  });

  it('does not let a retained storage argument mutate live state', async () => {
    let persisted: BoardState | null = null;
    const store = await BoardStore.open({ load: async () => null, save: async value => { persisted = value; } });
    await store.saveProject(sampleProject());
    (persisted as unknown as BoardState).projects[0]!.name = 'Storage mutation';
    expect(store.snapshot().projects[0]!.name).toBe('API');
  });

  it('isolates throwing and rejecting subscribers and supports unsubscription', async () => {
    const { store } = await fixture();
    let calls = 0;
    store.subscribe(() => { throw new Error('Observer failed.'); });
    store.subscribe(async () => { throw new Error('Async observer failed.'); });
    const unsubscribe = store.subscribe(() => { calls++; });
    await store.createTask(newTask);
    unsubscribe();
    unsubscribe();
    await store.createTask(newTask);
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(store.snapshot().tasks).toHaveLength(2);
  });

  it('permits a subscriber to enqueue a subsequent transaction', async () => {
    const { store } = await fixture();
    let followup: Promise<Project> | undefined;
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      followup = store.saveProject({ ...sampleProject('project-2'), name: 'Follow-up' });
    });
    await store.createTask(newTask);
    await followup;
    expect(store.snapshot().projects).toHaveLength(2);
  });

  it('rejects nested transactions rather than deadlocking', async () => {
    const { store } = await fixture();
    await expect(store.transact(async () => { await store.transact(() => undefined); })).rejects.toMatchObject({ code: 'REENTRANT_TRANSACTION' });
    await store.createTask(newTask);
    expect(store.snapshot().tasks).toHaveLength(1);
  });

  it('does not write mutation failures or invalid state', async () => {
    const { store, storage } = await fixture();
    const before = store.snapshot();
    const writes = storage.writes.length;
    await expect(store.transact(() => { throw new Error('Mutation failed.'); })).rejects.toThrow('Mutation failed.');
    await expect(store.transact(state => { state.projects = []; state.tasks = populatedState().tasks; })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(store.transact(state => { state.revision = 10; })).rejects.toMatchObject({ code: 'INVALID_REVISION' });
    await expect(store.transact(state => { (state as unknown as { schemaVersion: number }).schemaVersion = 3; })).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    await expect(store.transact(() => () => undefined)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(store.snapshot()).toEqual(before);
    expect(storage.writes).toHaveLength(writes);
  });

  it.each([-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected revision %s', async revision => {
    const { store } = await fixture();
    await expect(store.transact(() => undefined, revision)).rejects.toMatchObject({ code: 'INVALID_REVISION' });
  });

  it('does not overflow a safe revision', async () => {
    const storage = new MemoryStorage();
    storage.data = { ...initialState(), revision: Number.MAX_SAFE_INTEGER };
    const store = await BoardStore.open(storage);
    await expect(store.transact(() => undefined)).rejects.toMatchObject({ code: 'REVISION_EXHAUSTED' });
    expect(storage.writes).toEqual([]);
  });

  it('propagates startup storage failures without exposing an initialized store', async () => {
    const storage = new MemoryStorage();
    storage.failLoad = true;
    await expect(BoardStore.open(storage)).rejects.toMatchObject({ code: 'STORAGE_LOAD_FAILED' });
    storage.failLoad = false;
    storage.failSave = true;
    await expect(BoardStore.open(storage)).rejects.toMatchObject({ code: 'STORAGE_SAVE_FAILED' });
    expect(storage.data).toBeNull();
  });

  it.each([{ ...initialState(), schemaVersion: 3 }, { ...initialState(), schemaVersion: 0 }, undefined, {}, { ...initialState(), revision: -1 }])('never resets unsupported or malformed stored data %#', async persisted => {
    const storage = new MemoryStorage();
    storage.data = persisted;
    await expect(BoardStore.open(storage)).rejects.toBeInstanceOf(Error);
    expect(storage.writes).toEqual([]);
    expect(storage.data).toEqual(persisted);
  });
});

describe('task and project behavior', () => {
  it('creates tasks in the configured first stage at the exact project path without a native session', async () => {
    const { store } = await fixture();
    const first = await store.createTask(newTask);
    const second = await store.createTask(newTask);
    expect(first).toMatchObject({ projectId: 'project-1', columnId: 'backlog', position: 0, effectiveCwd: '/repos/platform/services/api', sessionIds: [], worktree: null, operation: null });
    expect(second.position).toBeLessThan(first.position);
    expect(second.id).not.toBe(first.id);
    await store.setWorkflow('initial_column: done\ncolumns:\n  - id: backlog\n    label: Backlog\n  - id: done\n    label: Done\n');
    expect((await store.createTask(newTask)).columnId).toBe('done');
  });

  it('rejects missing projects, invalid session IDs, and native-session reuse', async () => {
    const { store } = await fixture();
    await expect(store.createTask({ ...newTask, projectId: 'missing' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    const task = await store.createTask(newTask);
    await expect(store.addSession(task.id, '../session')).rejects.toMatchObject({ code: 'INVALID_ID' });
    await store.addSession(task.id, 'session-1');
    await expect(store.addSession(task.id, 'session-1')).rejects.toMatchObject({ code: 'SESSION_IN_USE' });
    expect(store.snapshot().tasks).toHaveLength(1);
  });

  it('edits text outside Backlog and with a worktree without changing session bindings or column', async () => {
    const { store } = await fixture();
    const task = await seedTask(store, 'session-1');
    await store.transact(state => {
      const draft = store.requireTask(task.id, state);
      draft.columnId = 'in_progress';
      draft.worktree = { path: '/worktrees/task', branch: 'feature', owned: true, status: 'ready' };
      draft.effectiveCwd = '/worktrees/task/services/api';
    });
    const updated = await store.editTask(task.id, { title: ' Refined title ', description: '' });
    expect(updated).toMatchObject({ title: 'Refined title', description: '', columnId: 'in_progress', sessionIds: ['session-1'], effectiveCwd: '/worktrees/task/services/api' });
    await expect(store.editTask(task.id, { title: ' ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.editTask(task.id, {})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.editTask(task.id, { projectId: 'other' } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps native session identity while tabs close/reopen and new tabs are associated', async () => {
    const { store, storage } = await fixture();
    const task = await seedTask(store, 'session-1');
    await store.addSession(task.id, 'session-2');
    await store.closeSession(task.id, 'session-1');
    await store.closeSession(task.id, 'session-1');
    expect(store.requireTask(task.id).closedSessionIds).toEqual(['session-1']);
    expect(store.requireTask(task.id).sessionIds).toEqual(['session-1', 'session-2']);
    const reopened = await BoardStore.open(storage);
    await reopened.reopenSession(task.id, 'session-1');
    expect(reopened.requireTask(task.id).closedSessionIds).toEqual([]);
    await expect(store.closeSession(task.id, 'unknown-session')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(store.addSession(task.id, 'session-2')).rejects.toMatchObject({ code: 'SESSION_IN_USE' });
  });

  it('blocks adding sessions while a context operation is unresolved', async () => {
    const { store } = await fixture();
    const task = await store.createTask(newTask);
    await store.transact(state => {
      store.requireTask(task.id, state).operation = { id: 'operation-1', request: { kind: 'return' }, phase: 'waiting', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: new Date().toISOString() };
    });
    await expect(store.addSession(task.id, 'session-2')).rejects.toMatchObject({ code: 'TASK_BUSY' });
  });

  it('rejects orphaning active tasks and preserves the previous YAML on failure', async () => {
    const { store } = await fixture();
    await store.createTask(newTask);
    const before = store.snapshot();
    await expect(store.setWorkflow('columns: [{id: replacement, label: Replacement}]')).rejects.toMatchObject({ code: 'WORKFLOW_ORPHAN_COLUMNS' });
    expect(store.snapshot()).toEqual(before);
    await expect(store.setWorkflow('columns: [{id: backlog, label: Backlog, limit: 1}]')).rejects.toMatchObject({ code: 'INVALID_WORKFLOW' });
    expect(store.snapshot().workflowYaml).toBe(DEFAULT_WORKFLOW_YAML);
  });

  it('durably preserves pending confirmed transitions and rejects orphaned pending columns', async () => {
    const { store, storage } = await fixture();
    const task = await seedTask(store, 'session-1');
    await store.transact(state => {
      store.requireTask(task.id, state).pendingTransition = { id: 'transition-1', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', sessionId: 'session-1', status: 'waiting' };
    });
    const reopened = await BoardStore.open(storage);
    expect(reopened.requireTask(task.id).pendingTransition).toEqual(store.requireTask(task.id).pendingTransition);
    await expect(reopened.setWorkflow('columns: [{id: backlog, label: Backlog}, {id: done, label: Done}]')).rejects.toMatchObject({ code: 'WORKFLOW_ORPHAN_COLUMNS' });
    await expect(reopened.transact(state => { store.requireTask(task.id, state).pendingTransition!.sessionId = 'foreign'; })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(reopened.requireTask(task.id).pendingTransition?.sessionId).toBe('session-1');
  });

  it('retains the exact approved pending instruction across restart, task edits, and workflow edits', async () => {
    const { store, storage } = await fixture();
    const task = await seedTask(store, 'session-1');
    const approved = 'Approved instruction\nPreserve this exact text.';
    await store.transact(state => {
      store.requireTask(task.id, state).pendingTransition = { id: 'transition-text', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', sessionId: 'session-1', text: approved, status: 'waiting' };
    });
    const reopened = await BoardStore.open(storage);
    await reopened.editTask(task.id, { description: 'Edited after approval' });
    await reopened.setWorkflow(DEFAULT_WORKFLOW_YAML.replace('label: In Progress', 'label: In Progress\n    on_enter_prompt: A newly edited instruction'));
    expect(reopened.requireTask(task.id).pendingTransition?.text).toBe(approved);
    await expect(reopened.transact(state => { (store.requireTask(task.id, state).pendingTransition as unknown as { text: number }).text = 12; })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(reopened.requireTask(task.id).pendingTransition?.text).toBe(approved);
  });

  it('persists a confirmed worktree prerequisite before any operation journal exists', async () => {
    const { store, storage } = await fixture();
    const task = await seedTask(store, 'session-1');
    const request = { mode: 'new' as const, path: '/worktrees/approved', branchName: 'approved-feature', sourceBranch: 'main' };
    let published: BoardState | undefined;
    store.subscribe(state => { published = state; });
    await store.transact(state => {
      store.requireTask(task.id, state).pendingTransition = { id: 'transition-tree', fromColumnId: 'backlog', columnId: 'in_progress', mode: 'run', sessionId: 'session-1', text: 'Approved prompt', worktreeRequest: request, status: 'waiting' };
    });
    expect(published?.tasks[0]?.operation).toBeNull();
    expect(published?.tasks[0]?.worktree).toBeNull();
    expect(published?.tasks[0]?.pendingTransition?.worktreeRequest).toEqual(request);
    const reopened = await BoardStore.open(storage);
    expect(reopened.requireTask(task.id).pendingTransition?.worktreeRequest).toEqual(request);
    expect(reopened.requireTask(task.id).effectiveCwd).toBe('/repos/platform/services/api');
  });

  it('reports invalid mapping inputs instead of leaking low-level property errors', async () => {
    const { store } = await fixture();
    await expect(store.saveProject(null as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.createTask(null as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.saveNote('missing', null as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('deletes only project registrations that have no tasks', async () => {
    const { store, project } = await fixture();
    const unused = await store.saveProject(sampleProject('project-unused'));
    await store.createTask(newTask);
    await expect(store.deleteProject(project.id)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
    await expect(store.deleteProject(unused.id)).resolves.toMatchObject({ id: unused.id });
    expect(store.snapshot().projects.map(value => value.id)).toEqual([project.id]);
  });
  it('protects project paths referenced by tasks while permitting name/default-branch edits', async () => {
    const { store } = await fixture();
    await store.createTask(newTask);
    await expect(store.saveProject({ ...sampleProject(), projectPath: '/other/project' })).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });
    const project = await store.saveProject({ ...sampleProject(), name: 'Renamed', defaultBranch: 'main' });
    expect(project).toMatchObject({ name: 'Renamed', defaultBranch: 'main', projectPath: '/repos/platform/services/api', gitRootPath: '/repos/platform' });
    project.name = 'Caller mutation';
    expect(store.requireProject(project.id).name).toBe('Renamed');
  });

  it('allows unreferenced project paths to be updated after host canonicalization', async () => {
    const { store } = await fixture();
    expect((await store.saveProject({ ...sampleProject(), projectPath: '/repos/new-project' })).projectPath).toBe('/repos/new-project');
    await expect(store.saveProject({ ...sampleProject(), projectPath: 'relative' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('returns detached lookup results unless an explicit transaction draft is supplied', async () => {
    const { store } = await fixture();
    const task = await store.createTask(newTask);
    store.requireTask(task.id).title = 'Ignored mutation';
    store.requireProject('project-1').name = 'Ignored mutation';
    expect(store.requireTask(task.id).title).toBe(newTask.title);
    expect(store.requireProject('project-1').name).toBe('API');
    expect(() => store.requireTask('missing')).toThrow(expect.objectContaining({ code: 'TASK_NOT_FOUND' }));
    expect(() => store.requireProject('missing')).toThrow(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
  });
});

describe('shared notes and reversible archive', () => {
  it('shares notes by task, preserves Markdown formatting, and rejects another task note ID', async () => {
    const { store } = await fixture();
    const first = await seedTask(store, 'session-1');
    const second = await seedTask(store, 'session-2');
    await store.addSession(first.id, 'session-3');
    const content = '    indented Markdown\n\nBody\n';
    const note = await store.saveNote(first.id, { content, tags: [' api ', 'api', 'review'] });
    expect(note.content).toBe(content);
    expect(note.tags).toEqual(['api', 'review']);
    const edited = await store.saveNote(first.id, { id: note.id, content: '# Updated', tags: [] });
    expect(edited).toMatchObject({ taskId: first.id, content: '# Updated', tags: [] });
    expect(store.snapshot().notes).toHaveLength(1);
    await expect(store.saveNote(second.id, { id: note.id, content: 'Wrong owner' })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(store.saveNote('missing', { content: 'No target' })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    await expect(store.saveNote(first.id, { content: ' ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps notes across worktree context changes and restart', async () => {
    const { store, storage } = await fixture();
    const task = await seedTask(store, 'session-1');
    const note = await store.saveNote(task.id, { content: '# Persistent context' });
    await store.transact(state => {
      const value = store.requireTask(task.id, state);
      value.worktree = { path: '/worktrees/feature', branch: 'feature', owned: false, status: 'ready' };
      value.effectiveCwd = '/worktrees/feature/services/api';
    });
    const reopened = await BoardStore.open(storage);
    expect(reopened.requireTask(task.id)).toMatchObject({ columnId: task.columnId, sessionIds: ['session-1'], effectiveCwd: '/worktrees/feature/services/api', worktree: { path: '/worktrees/feature', branch: 'feature', owned: false, status: 'ready' } });
    expect(reopened.snapshot().notes).toEqual([note]);
  });
});

describe('board settings', () => {
  it('saves, replaces, clears, and persists the worktree base path', async () => {
    const { store, storage } = await fixture();
    await store.saveSettings({ worktreeBasePath: '/worktrees' });
    expect(store.snapshot().settings).toEqual({ worktreeBasePath: '/worktrees' });
    expect((storage.data as BoardState).settings).toEqual({ worktreeBasePath: '/worktrees' });
    await store.saveSettings({ worktreeBasePath: '/other/trees' });
    expect(store.snapshot().settings).toEqual({ worktreeBasePath: '/other/trees' });
    await store.saveSettings({});
    expect(store.snapshot().settings).toEqual({});
    const reopened = await BoardStore.open(storage);
    expect(reopened.snapshot().settings).toEqual({});
  });

  it('rejects relative, duplicate, and unknown settings values', async () => {
    const { store } = await fixture();
    await expect(store.saveSettings({ worktreeBasePath: 'relative/trees' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.saveSettings({ worktreeBasePath: '' })).resolves.toEqual({});
    await expect(store.saveSettings({ worktreeBasePath: '/trees', engine: 'legacy' } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.saveSettings({ worktreeBasePath: 12 } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('honors expectedRevision for settings saves', async () => {
    const { store } = await fixture();
    const revision = store.snapshot().revision;
    await store.saveSettings({ worktreeBasePath: '/worktrees' }, revision);
    await expect(store.saveSettings({ worktreeBasePath: '/other' }, revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(store.snapshot().settings).toEqual({ worktreeBasePath: '/worktrees' });
  });

  it('loads a stored board that predates the settings field', async () => {
    const storage = new MemoryStorage();
    const legacy = initialState() as unknown as Record<string, unknown>;
    delete legacy.settings;
    storage.data = legacy;
    const store = await BoardStore.open(storage);
    expect(store.snapshot().settings).toBeUndefined();
  });
});
