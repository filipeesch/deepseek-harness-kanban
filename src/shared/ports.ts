import type { BoardState, ConversationFacts, CreateWorktree, GitProject, HubState, KanbanMeta, ProjectLocation } from './types.js';
export interface StateStorage { load(): Promise<unknown | null>; save(state: BoardState): Promise<void> }
/** Durable Hub-record storage. The adapter owns the DSH domain; the repository owns the write chain. */
export interface HubStorage {
  loadAll(): Promise<{ hubs: HubState[]; meta: KanbanMeta }>;
  saveHub(state: HubState): Promise<void>;
  deleteHub(id: string): Promise<void>;
  saveMeta(meta: KanbanMeta): Promise<void>;
  close(): Promise<void>;
}
/** Read-only access to the legacy single-board document used for one-time migration. */
export interface LegacyStateReader {
  read(): Promise<BoardState>;
  close(): Promise<void>;
}
export interface WorkspaceInfo { id: string; path: string; title: string; sessionIds: string[] }
export interface WorkspacePort {
  ensure(path: string, title: string): Promise<{ workspace: WorkspaceInfo; owned: boolean }>;
  get(id: string): WorkspaceInfo | undefined;
  delete(id: string): Promise<void>;
}
export interface SessionLineage { sessionId: string; parentSessionId?: string; origin?: 'subagent' }
export interface SessionDirectory { sessionId: string; directory: string }
export interface SessionTopology { related: SessionDirectory[]; lineage: SessionLineage[] }
/** Read-only view used by ownership-sensitive cleanup; no execution or mutation. */
export interface SessionTopologyPort {
  /** Include related directories when `within` is set; lineage is always global. */
  topology(within?: string): Promise<SessionTopology>;
}
export interface SessionPort extends SessionTopologyPort {
  create(projectPath: string, workspaceId?: string): Promise<string>;
  /** Raw recorded native directory; recovery must still see a missing current worktree. */
  directory(sessionId: string): Promise<string>;
  /** Fail closed unless the expected canonical directory exists and the native effective directory resolves to it. Never recover or grant access. */
  validateDirectory(sessionId: string, expected: string): Promise<void>;
  setDirectory(sessionId: string, directory: string, signal?: AbortSignal): Promise<void>;
  isIdle(sessionId: string): Promise<boolean>;
  send(sessionId: string, text: string, requestId?: string): Promise<void>;
  archive(sessionId: string): Promise<void>;
  /** Native execution facts: running agents, background work, pending interaction, and the last settled turn. */
  facts(sessionId: string): Promise<ConversationFacts>;
  /** Includes cold sessions' projected effective directories where available. */
  directories(within?: string): Promise<Array<{ sessionId: string; directory: string }>>;
}
export interface GitTree { path: string; branch: string; dirty: boolean; commonDirectory: string }
export interface GitPort {
  branches(project: GitProject, sessionIds: string[]): Promise<string[]>;
  inspect(project: GitProject, path: string, sessionIds: string[]): Promise<GitTree>;
  create(project: GitProject, request: CreateWorktree, sessionIds: string[], signal?: AbortSignal): Promise<GitTree>;
  remove(project: GitProject, path: string, discardChanges: boolean, sessionIds: string[], signal?: AbortSignal): Promise<void>;
  assertPolicy(project: GitProject, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
  projectDirectory(project: GitProject, worktreeRoot?: string): Promise<string>;
}
/** Non-persistent inspection of a folder for project registration. */
export interface ProjectProbe {
  inspect(path: string): Promise<ProjectLocation>;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export interface GitExecutor {
  run(project: GitProject, args: string[], sessionIds: string[], signal?: AbortSignal): Promise<CommandResult>;
  assertPolicy(project: GitProject, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
}
