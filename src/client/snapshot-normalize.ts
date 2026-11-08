import type { HubState, KanbanSnapshot, Task, Workflow } from '../shared/types.js';

export function allTasks(snapshot: Pick<KanbanSnapshot, 'state'>): Task[] { return snapshot.state.hubs.flatMap(hub => hub.tasks); }
export function normalizeSnapshot(snapshot: KanbanSnapshot): KanbanSnapshot {
  const legacy = snapshot.state as unknown as Record<string, unknown>;
  const hasLegacy = ['tasks', 'projects', 'notes', 'workflow', 'workflowYaml', 'revision'].some(key => Object.prototype.hasOwnProperty.call(legacy, key));
  if (!hasLegacy) return snapshot;
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      settings: snapshot.state.settings ?? { revision: 0 },
      hubs: snapshot.state.hubs.map((hub, index) => index !== 0 ? hub : {
        ...hub,
        ...(Array.isArray(legacy.tasks) ? { tasks: legacy.tasks as HubState['tasks'] } : {}),
        ...(Array.isArray(legacy.projects) ? { projects: legacy.projects as HubState['projects'] } : {}),
        ...(Array.isArray(legacy.notes) ? { notes: legacy.notes as HubState['notes'] } : {}),
        ...(typeof legacy.revision === 'number' ? { revision: legacy.revision } : {}),
        boards: hub.boards.map((board, boardIndex) => boardIndex !== 0 ? board : {
          ...board,
          ...(typeof legacy.workflowYaml === 'string' ? { workflowYaml: legacy.workflowYaml } : {}),
          ...(legacy.workflow && typeof legacy.workflow === 'object' ? { workflow: legacy.workflow as Workflow } : {}),
        }),
      }),
    },
  };
}
