import type { Attention, BoardState, CreateWorktree, Project } from './types.js';
export interface StateStorage { load(): Promise<unknown | null>; save(state: BoardState): Promise<void> }
export interface WorkspaceInfo { id: string; path: string; title: string; sessionIds: string[] }
export interface WorkspacePort {
  ensure(path: string, title: string): Promise<{ workspace: WorkspaceInfo; owned: boolean }>;
  get(id: string): WorkspaceInfo | undefined;
  delete(id: string): Promise<void>;
}
export interface SessionPort {
  create(projectPath: string, workspaceId?: string): Promise<string>;
  /** Raw recorded native directory; recovery must still see a missing current worktree. */
  directory(sessionId: string): Promise<string>;
  /** Fail closed unless the expected canonical directory exists and the native effective directory resolves to it. Never recover or grant access. */
  validateDirectory(sessionId: string, expected: string): Promise<void>;
  setDirectory(sessionId: string, directory: string, signal?: AbortSignal): Promise<void>;
  isIdle(sessionId: string): Promise<boolean>;
  send(sessionId: string, text: string, requestId?: string): Promise<void>;
  archive(sessionId: string): Promise<void>;
  attention(sessionId: string): Promise<Attention>;
  /** Includes cold sessions' projected effective directories where available. */
  directories(within?: string): Promise<Array<{ sessionId: string; directory: string }>>;
}
export interface GitTree { path: string; branch: string; dirty: boolean; commonDirectory: string }
export interface GitPort {
  branches(project: Project, sessionIds: string[]): Promise<string[]>;
  inspect(project: Project, path: string, sessionIds: string[]): Promise<GitTree>;
  create(project: Project, request: CreateWorktree, sessionIds: string[], signal?: AbortSignal): Promise<GitTree>;
  remove(project: Project, path: string, discardChanges: boolean, sessionIds: string[], signal?: AbortSignal): Promise<void>;
  assertPolicy(project: Project, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
  projectDirectory(project: Project, worktreeRoot?: string): Promise<string>;
  discover(path: string): Promise<{ projectPath: string; gitRootPath: string }>;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export interface GitExecutor {
  run(project: Project, args: string[], sessionIds: string[], signal?: AbortSignal): Promise<CommandResult>;
  assertPolicy(project: Project, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
}
