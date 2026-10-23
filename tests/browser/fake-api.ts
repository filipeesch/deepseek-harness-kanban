import type { BoardSnapshot, ClientApi, Command, Task } from '../../src/shared/types.js';
import { taskTitleSlug, worktreePathForBranch } from '../../src/shared/worktree-name.js';

export interface HarnessApi {
  api: ClientApi;
  snapshot(): BoardSnapshot;
  commands(): readonly Command[];
}

export function createHarnessApi(): HarnessApi {
  const tasks: Task[] = [
    ...Array.from({ length: 12 }, (_, index) => task('long-' + index, 'Long column task ' + index, 'explore', index)),
    task('short', 'Short task', 'propose', 40),
    task('other', 'Other task', 'apply', 41),
  ];
  let value: BoardSnapshot = {
    sequence: 1, attention: {},
    state: {
      schemaVersion: 2, revision: 1, workflowYaml: workflowYaml(),
      workflow: { name: 'Harness flow', initialColumnId: 'explore', columns: [
        { id: 'explore', name: 'Explore' }, { id: 'propose', name: 'Propose' }, { id: 'apply', name: 'Apply' },
      ], groups: [{ id: 'planning', name: 'Planning', columnIds: ['explore', 'propose'] }] },
      projects: [{ id: 'p', name: 'Project', projectPath: '/repo', gitRootPath: '/repo', defaultBranch: 'main' }],
      tasks, notes: [], settings: { worktreeBasePath: '/worktrees' },
    },
  };
  const listeners = new Set<(snapshot: BoardSnapshot) => void>();
  const commands: Command[] = [];
  const publish = () => { value = { ...value, sequence: value.sequence + 1 }; const copy = structuredClone(value); for (const listener of listeners) listener(copy); return structuredClone(value); };
  const api: ClientApi = {
    snapshot: async () => structuredClone(value),
    command: async (command: Command) => {
      commands.push(structuredClone(command));
      if (command.type === 'workflow.save') { value.state.workflowYaml = command.yaml; value.state.revision += 1; }
      if (command.type === 'worktree.create') {
        const task = value.state.tasks.find(item => item.id === command.taskId);
        if (task) { task.worktree = { path: command.path, branch: command.branchName, owned: true, status: 'ready' }; task.effectiveCwd = command.path; }
      }
      return publish();
    },
    branches: async () => ['main', 'feature'],
    worktreeDefault: async taskId => {
      const task = value.state.tasks.find(item => item.id === taskId);
      const branchName = taskTitleSlug(task?.title ?? 'task');
      return { branchName, path: worktreePathForBranch(value.state.settings?.worktreeBasePath, branchName) };
    },
    inferProject: async path => ({ projectPath: path, gitRootPath: path }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { api, snapshot: () => structuredClone(value), commands: () => structuredClone(commands) };
}

export function workflowYaml(): string {
  return ['name: Harness flow', 'initial_column: explore', 'columns:', '  - id: explore', '    label: Explore', '  - id: propose', '    label: Propose', '  - id: apply', '    label: Apply', 'groups:', '  - id: planning', '    label: Planning', '    columns: [explore, propose]', ''].join(String.fromCharCode(10));
}

function task(id: string, title: string, columnId: string, position: number): Task {
  return { id, projectId: 'p', title, description: 'Harness task', columnId, position, sessionIds: ['s-' + id], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: '', updatedAt: '' };
}
