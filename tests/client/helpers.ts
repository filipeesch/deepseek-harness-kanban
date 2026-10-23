import { vi } from 'vitest';
import type { BoardSnapshot, ClientApi, Command, Task } from '../../src/shared/types.js';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';

const FIXTURE_WORKFLOW_YAML = ['name: Delivery', 'initial_column: intake', 'columns:', '  - id: intake', '    label: Intake', '    allowed_transitions: [doing, review]', '  - id: doing', '    label: Doing', '  - id: review', '    label: Review', '    on_enter_prompt: |', '      Review **carefully**.', 'groups:', '  - id: plan', '    label: Planning', '    columns: [intake, review]', ''].join(String.fromCharCode(10));
export function fixture(): BoardSnapshot {
  return { sequence: 1, attention: { t1: { running: true, background: [{ kind: 'job', label: 'Run tests' }], unread: true, awaitingReply: true, failed: true } }, state: { schemaVersion: 2, revision: 1, workflowYaml: FIXTURE_WORKFLOW_YAML, workflow: { name: 'Delivery', initialColumnId: 'intake', columns: [{ id: 'intake', name: 'Intake', allowedTransitions: ['doing', 'review'] }, { id: 'doing', name: 'Doing' }, { id: 'review', name: 'Review', onEnterPrompt: 'Review **carefully**.' }], groups: [{ id: 'plan', name: 'Planning', columnIds: ['intake', 'review'] }] }, projects: [{ id: 'p1', name: 'API', projectPath: '/repo/apps/api', gitRootPath: '/repo', defaultBranch: 'main' }, { id: 'p2', name: 'Web', projectPath: '/web', gitRootPath: '/web', defaultBranch: 'main' }], tasks: [task('t1', 'Alpha task', 'p1', 'intake'), { ...task('t2', 'Beta task', 'p2', 'doing'), description: 'Searchable documentation', worktree: { path: '/trees/beta', branch: 'beta', owned: true, status: 'ready' }, effectiveCwd: '/trees/beta' }], notes: [] } };
}
export function task(id: string, title: string, projectId: string, columnId: string): Task { return { id, title, description: 'Task description', projectId, columnId, position: 1, sessionIds: id === 't1' ? ['s1', 's2'] : ['s-beta'], closedSessionIds: [], effectiveCwd: projectId === 'p1' ? '/repo/apps/api' : '/web', worktree: null, operation: null, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' }; }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function fakeApi(initial = fixture()) {
  let value = clone(initial); delete value.commandReceipt; let next = 3; const listeners = new Set<(snapshot: BoardSnapshot) => void>();
  const publish = (snapshot?: BoardSnapshot) => { if (snapshot) { value = clone(snapshot); delete value.commandReceipt; } else { value.sequence++; value.state.revision++; } const result = clone(value); for (const listener of listeners) listener(result); return result; };
  const command = vi.fn(async (input: Command): Promise<BoardSnapshot> => {
    const current = 'taskId' in input ? value.state.tasks.find(item => item.id === input.taskId) : undefined;
    let receipt: BoardSnapshot['commandReceipt'];
    switch (input.type) {
      case 'task.create': { const id = 't' + next; const created = { ...task(id, input.title, input.projectId, value.state.workflow.initialColumnId), description: input.description, sessionIds: ['created-' + next++] }; const initial = value.state.workflow.columns.find(column => column.id === created.columnId); if (initial?.onEnterPrompt?.trim()) created.instructionPending = { columnId: initial.id, enteredAt: Date.now() }; value.state.tasks.push(created); receipt = { kind: 'task', id }; break; }
      case 'task.edit': if (current) { if (input.title !== undefined) current.title = input.title; if (input.description !== undefined) current.description = input.description; } break;
      case 'task.move': if (current) { const previous = current.columnId; current.columnId = input.columnId; if (previous !== input.columnId) { const destination = value.state.workflow.columns.find(column => column.id === input.columnId); if (destination?.onEnterPrompt?.trim()) current.instructionPending = { columnId: input.columnId, enteredAt: Date.now() }; else delete current.instructionPending; } if (input.newConversation) current.sessionIds.push('s' + next++); if (input.worktree) { current.worktree = { path: input.worktree.path, branch: input.worktree.branchName, status: 'ready', owned: true }; current.effectiveCwd = input.worktree.path + (current.projectId === 'p1' ? '/apps/api' : ''); } } break;
      case 'task.runInstruction': if (current) delete current.instructionPending; break;
      case 'conversation.create': if (current) { const id = 's' + next++; current.sessionIds.push(id); receipt = { kind: 'conversation', id }; } break;
      case 'conversation.close': current?.closedSessionIds.push(input.sessionId); break;
      case 'conversation.reopen': if (current) current.closedSessionIds = current.closedSessionIds.filter(id => id !== input.sessionId); break;
      case 'task.delete': value.state.tasks = value.state.tasks.filter(item => item.id !== input.taskId); value.state.notes = value.state.notes.filter(note => note.taskId !== input.taskId); break;
      case 'worktree.create': if (current) { current.worktree = { path: input.path, branch: input.branchName, owned: true, status: 'ready' }; current.effectiveCwd = input.path + '/apps/api'; } break;
      case 'worktree.attach': if (current) { current.worktree = { path: input.path, branch: 'external', owned: false, status: 'ready' }; current.effectiveCwd = input.path + '/apps/api'; } break;
      case 'worktree.remove': if (current) { current.worktree = null; current.effectiveCwd = value.state.projects.find(project => project.id === current.projectId)?.projectPath ?? ''; } break;
      case 'operation.retry': case 'operation.return': if (current) current.operation = null; break;
      case 'note.save': { const note = value.state.notes.find(note => note.id === input.noteId); if (note) note.content = input.content; else { const id = 'n' + next++; value.state.notes.push({ id, taskId: input.taskId, content: input.content, createdAt: 'now', updatedAt: 'now' }); receipt = { kind: 'note', id }; } break; }
      case 'workflow.save': value.state.workflowYaml = input.yaml; break;
      case 'project.save': { const project = value.state.projects.find(project => project.id === input.project.id); if (project) Object.assign(project, input.project); else { const id = 'p' + next++; value.state.projects.push({ ...input.project, id }); receipt = { kind: 'project', id }; } break; }
      case 'project.delete': value.state.projects = value.state.projects.filter(project => project.id !== input.projectId); receipt = { kind: 'project', id: input.projectId }; break;
      case 'settings.save': value.state.settings = { ...input.settings }; break;
    }
    const snapshot = publish();
    return receipt ? { ...snapshot, commandReceipt: receipt } : snapshot;
  });
  const worktreeDefault = vi.fn(async (taskId: string) => {
    const task = value.state.tasks.find(item => item.id === taskId);
    const branchName = task ? taskTitleSlug(task.title) : 'task';
    return { branchName, path: worktreePathForBranch(value.state.settings?.worktreeBasePath, branchName) };
  });
  const api: ClientApi = { snapshot: vi.fn(async () => clone(value)), command, branches: vi.fn(async () => ['main', 'feature']), worktreeDefault, inferProject: vi.fn(async (path: string) => ({ projectPath: path, gitRootPath: path })), subscribe: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener); }) };
  return { api, command, publish, get: () => clone(value), listeners };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
