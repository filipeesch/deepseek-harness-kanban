import path from 'node:path';
import { ownedSessionIds } from '../domain/session-lineage.js';
import type { SessionPort, WorkspacePort } from '../shared/ports.js';
import type { HubTask, Project } from '../shared/types.js';
import { requireProjectPath } from '../shared/project.js';

/** One task/project pair the coordinator may provision a workspace for. */
export interface WorkspaceTaskRef {
  hubId: string;
  task: HubTask;
  project: Project;
}

/** Durable workspace bindings owned by the Kanban state. */
export interface WorkspaceBindingStore {
  all(): WorkspaceTaskRef[];
  setProjectWorkspace(hubId: string, projectId: string, workspaceId: string, owned: boolean): Promise<void>;
  setTaskWorktreeWorkspace(hubId: string, taskId: string, workspaceId: string, owned: boolean): Promise<void>;
}

export interface WorkspaceCoordinatorOptions {
  workspaces: WorkspacePort;
  sessions: SessionPort;
  store: WorkspaceBindingStore;
  report?: (error: unknown) => void;
}

/**
 * Owns native workspace provisioning for the board: the shared project workspace,
 * task worktree workspaces, session-directory repair, and owned cleanup.
 */
export class WorkspaceCoordinator {
  constructor(private readonly options: WorkspaceCoordinatorOptions) {}

  async ensureProject(hubId: string, project: Project): Promise<string | undefined> {
    const existing = project.workspaceId;
    if (existing) {
      const info = this.options.workspaces.get(existing);
      if (info) {
        if (info.hidden) await this.setVisibility(existing, false);
        return existing;
      }
    }
    return this.rebindProject(hubId, project);
  }

  /** Bind the project to a workspace for its current path even when the previous binding still resolves. */
  async rebindProject(hubId: string, project: Project): Promise<string | undefined> {
    const ensured = await this.options.workspaces.ensure(requireProjectPath(project), { title: project.name });
    if (ensured.workspace.hidden) await this.setVisibility(ensured.workspace.id, false);
    if (project.workspaceId !== ensured.workspace.id || project.workspaceOwned !== ensured.owned) {
      await this.options.store.setProjectWorkspace(hubId, project.id, ensured.workspace.id, ensured.owned);
    }
    return ensured.workspace.id;
  }

  async ensureTaskWorkspace(hubId: string, task: HubTask, project: Project): Promise<string | undefined> {
    if (task.effectiveCwd === requireProjectPath(project)) return this.ensureProject(hubId, project);
    const existing = task.worktreeWorkspaceId;
    if (existing && this.options.workspaces.get(existing)) return existing;
    const title = project.name + ' · ' + (task.worktree?.branch ?? path.basename(task.effectiveCwd));
    const ensured = await this.options.workspaces.ensure(task.effectiveCwd, { title, hidden: true });
    if (!ensured.workspace.hidden) await this.setVisibility(ensured.workspace.id, true);
    if (task.worktreeWorkspaceId !== ensured.workspace.id || task.worktreeWorkspaceOwned !== ensured.owned) {
      await this.options.store.setTaskWorktreeWorkspace(hubId, task.id, ensured.workspace.id, ensured.owned);
    }
    return ensured.workspace.id;
  }

  async reconcile(): Promise<void> {
    for (const { hubId, task, project } of this.options.store.all()) {
      if (task.sessionIds.length > 0) {
        try {
          await this.ensureProject(hubId, project);
          await this.ensureTaskWorkspace(hubId, task, project);
        } catch (error) {
          this.options.report?.(error);
        }
      }
      for (const sessionId of task.sessionIds) {
        try {
          const directory = await this.options.sessions.directory(sessionId);
          if (directory !== project.projectPath) {
            await this.options.workspaces.ensure(directory, { title: project.name + ' · ' + path.basename(directory), hidden: true });
          }
        } catch (error) {
          this.options.report?.(error);
        }
      }
    }
  }

  async cleanup(task: HubTask): Promise<void> {
    const workspaceId = task.worktreeWorkspaceId;
    if (!workspaceId || !task.worktreeWorkspaceOwned) return;
    const info = this.options.workspaces.get(workspaceId);
    if (!info) return;
    const owned = ownedSessionIds(task.sessionIds, (await this.options.sessions.topology()).lineage);
    if (info.sessionIds.some(sessionId => !owned.has(sessionId))) return;
    if (this.options.store.all().some(({ task: other }) => other.id !== task.id && other.worktreeWorkspaceId === workspaceId)) return;
    await this.options.workspaces.delete(workspaceId);
  }

  /** Visibility is presentation: a failed write is reported and never blocks the caller. */
  private async setVisibility(id: string, hidden: boolean): Promise<void> {
    try {
      await this.options.workspaces.setHidden(id, hidden);
    } catch (error) {
      this.options.report?.(error);
    }
  }
}
