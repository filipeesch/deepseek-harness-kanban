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
export interface WorkspaceInfo { id: string; path: string; title: string; sessionIds: string[]; hidden: boolean }
export interface WorkspaceEnsureOptions { title?: string; hidden?: boolean }
export interface WorkspacePort {
  /** Best-effort host capability; `setHidden` is safe to call and no-ops when the host cannot hide. */
  readonly supportsHidden: boolean;
  ensure(path: string, options?: WorkspaceEnsureOptions): Promise<{ workspace: WorkspaceInfo; owned: boolean }>;
  get(id: string): WorkspaceInfo | undefined;
  setHidden(id: string, hidden: boolean): Promise<void>;
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
/** One stage instruction admitted to a conversation as a plugin-sourced context message. */
export interface StageInstructionDelivery {
  /** Stable delivery identity; a repeated identity is never delivered twice. */
  readonly requestId: string;
  /** Model-facing text: the entry instruction, then the transition briefing when one applies. */
  readonly text: string;
  /** One-line account the collapsed message row shows. */
  readonly summary: string;
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
  /** Deliver one stage instruction as a plugin-sourced message that starts the turn. */
  deliverStageInstruction(sessionId: string, delivery: StageInstructionDelivery): Promise<void>;
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
  /** Best-effort repair of moved linked worktrees; returns after the repository admin files were repaired. */
  repair(project: GitProject, worktreePaths: string[], sessionIds: string[], signal?: AbortSignal): Promise<void>;
  assertPolicy(project: GitProject, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
  projectDirectory(project: GitProject, worktreeRoot?: string): Promise<string>;
}
/** Non-persistent inspection of a folder for project registration. */
export interface ProjectProbe {
  inspect(path: string): Promise<ProjectLocation>;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export interface GitExecutor {
  run(project: GitProject, args: string[], sessionIds: string[], signal?: AbortSignal, write?: boolean): Promise<CommandResult>;
  assertPolicy(project: GitProject, paths: string[], sessionIds: string[], write: boolean): Promise<void>;
}
