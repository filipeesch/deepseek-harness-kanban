export const DATA_VERSION = 2 as const;
export interface Problem { code: string; message: string; details?: Record<string, unknown> }
export interface Project { id: string; name: string; projectPath: string; gitRootPath?: string; defaultBranch?: string; workspaceId?: string; workspaceOwned?: boolean }
/** A project whose Git root is known; required by every Git and worktree operation. */
export type GitProject = Project & { gitRootPath: string };
/** Non-persistent result of inspecting a folder for project registration. */
export type ProjectLocation =
  | { kind: 'git'; projectPath: string; gitRootPath: string; defaultBranch?: string }
  | { kind: 'folder'; projectPath: string };
export interface Column { id: string; name: string; onEnterPrompt?: string; allowedTransitions?: string[] }
export interface ColumnGroup { id: string; name: string; columnIds: string[] }
export interface Workflow { name: string; initialColumnId: string; columns: Column[]; groups: ColumnGroup[] }
export interface Worktree { path: string; branch: string; owned: boolean; status: 'preparing' | 'ready' | 'error' }
export interface CreateWorktree { mode: 'new' | 'existing'; path: string; branchName: string; sourceBranch?: string }
export type OperationRequest =
  | ({ kind: 'create' } & CreateWorktree)
  | { kind: 'attach'; path: string }
  | { kind: 'remove'; discardChanges: boolean; expectedWorktreePath?: string | null }
  | { kind: 'delete'; discardChanges: boolean; expectedWorktreePath?: string | null }
  | { kind: 'return' };
export interface ContextOperation {
  id: string; request: OperationRequest;
  phase: 'waiting' | 'preflight' | 'git' | 'switching' | 'removing' | 'archiving' | 'failed';
  targetPath?: string; targetDirectory?: string;
  previousDirectories: Record<string, string>; switchedSessionIds: string[];
  archivedSessionIds: string[]; gitCompleted: boolean; error?: Problem; createdAt: string;
  createAttempt?: { operationId: string; path: string; gitRootPath: string; branchName: string; mode: 'new' | 'existing'; absentBefore: true };
}
export interface PendingTransition { id: string; fromColumnId: string; columnId: string; mode: 'move' | 'run'; sessionId?: string; text?: string; beforeTaskId?: string | null; worktreeRequest?: CreateWorktree; transitionOverride?: boolean; status: 'waiting' | 'sending' | 'failed'; error?: Problem }
export interface Task {
  id: string; projectId: string; title: string; description: string; columnId: string; position: number;
  sessionIds: string[]; closedSessionIds: string[]; effectiveCwd: string;
  worktree: Worktree | null; operation: ContextOperation | null; pendingTransition?: PendingTransition;
  /** The task has recorded a choice to continue in its base project instead of creating a worktree. */
  worktreeDismissed?: boolean;
  /** The current instructed-stage entry whose card action has not been satisfied by a prompt. */
  instructionPending?: { columnId: string; enteredAt: number };
  /** Diagnostic-only checkouts left on disk; never an execution or cleanup target. */
  unclaimedWorktrees?: Array<{ path: string; branch: string; error: Problem }>;
  worktreeWorkspaceId?: string; worktreeWorkspaceOwned?: boolean;
  createdAt: string; updatedAt: string;
}
export interface Note { id: string; taskId: string; content: string; createdAt: string; updatedAt: string; tags?: string[] }
export interface BoardSettings { worktreeBasePath?: string }
export interface Board { id: string; name: string; workflowYaml: string; workflow: Workflow; createdAt: string; updatedAt: string }
/** A task that belongs to a board. The legacy BoardState keeps plain Task for migration compatibility. */
export interface HubTask extends Task { boardId: string }
export interface HubState {
  id: string; name: string; revision: number;
  projects: Project[]; boards: Board[]; tasks: HubTask[]; notes: Note[];
  createdAt: string; updatedAt: string;
}
export interface KanbanSettings { revision: number; worktreeBasePath?: string }
/** Global metadata stored beside the Hub records. */
export interface KanbanMeta { initializedAt?: string; settingsRevision: number; worktreeBasePath?: string }
export interface KanbanState { hubs: HubState[]; settings: KanbanSettings }
/** Legacy single-board state, read only by the migration path. */
export interface BoardState { schemaVersion: 2; revision: number; workflowYaml: string; workflow: Workflow; projects: Project[]; tasks: Task[]; notes: Note[]; settings?: BoardSettings }
export type BackgroundKind = 'job' | 'schedule';
/** One unsettled activity that outlives the turn, owned by a task conversation. */
export interface BackgroundActivity { kind: BackgroundKind; label: string }
/** The last settled assistant turn of one conversation, identified by its durable event sequence. */
export interface SettledTurn { seq: number; outcome: 'ok' | 'error' }
/** One conversation's native execution facts as the host owns them. */
export interface ConversationFacts {
  /** At least one owned agent is running: this conversation's own turn or a subagent descendant. */
  running: boolean;
  background: BackgroundActivity[];
  awaitingReply: boolean;
  settledTurn: SettledTurn | null;
}
export const EMPTY_CONVERSATION_FACTS: ConversationFacts = { running: false, background: [], awaitingReply: false, settledTurn: null };
/** One conversation's projected attention, including the client-owned read state. */
export interface Attention { running: boolean; background: BackgroundActivity[]; unread: boolean; awaitingReply: boolean; failed: boolean }
/** Transient identity of the entity created by this exact command, never persisted. */
export interface CommandReceipt { kind: 'hub' | 'board' | 'project' | 'task' | 'conversation' | 'note'; id: string }
/** Host snapshot: durable state plus per-conversation attention facts. */
export interface HostSnapshot { commandReceipt?: CommandReceipt; state: KanbanState; conversations: Record<string, ConversationFacts>; sequence: number }
/** Client snapshot: host facts plus the client-owned attention projection. */
export interface KanbanSnapshot extends Omit<HostSnapshot, 'conversations'> { attention: Record<string, Attention>; conversationAttention: Record<string, Attention>; clientEpoch?: number }
export const EMPTY_ATTENTION: Attention = { running: false, background: [], unread: false, awaitingReply: false, failed: false };
export interface ProjectInput { id?: string; name: string; projectPath: string; gitRootPath?: string; defaultBranch?: string }
export interface NewTask { projectId: string; title: string; description: string; boardId?: string }
export type Command =
  | { type: 'hub.create'; name: string }
  | { type: 'hub.rename'; hubId: string; name: string; expectedRevision?: number }
  | { type: 'hub.delete'; hubId: string; confirmed: boolean }
  | { type: 'board.create'; hubId: string; name: string }
  | { type: 'board.rename'; hubId: string; boardId: string; name: string; expectedRevision?: number }
  | { type: 'board.delete'; hubId: string; boardId: string; confirmed: boolean; expectedRevision?: number }
  | { type: 'board.workflow.save'; hubId: string; boardId: string; yaml: string; expectedRevision?: number }
  | { type: 'project.save'; hubId?: string; project: ProjectInput; expectedRevision?: number }
  | { type: 'project.delete'; hubId?: string; projectId: string; confirmed: boolean; expectedRevision?: number }
  /** @deprecated Saves the first board's workflow; the UI uses board.workflow.save. Kept for single-board callers. */
  | { type: 'workflow.save'; hubId?: string; yaml: string; expectedRevision?: number }
  | { type: 'settings.save'; settings: BoardSettings; expectedRevision?: number }
  | ({ type: 'task.create'; hubId?: string } & NewTask)
  | { type: 'task.edit'; hubId?: string; taskId: string; title?: string; description?: string; expectedRevision?: number }
  | { type: 'task.move'; hubId?: string; taskId: string; columnId: string; beforeTaskId?: string | null; overrideTransition?: boolean }
  | { type: 'task.runInstruction'; hubId?: string; taskId: string; columnId: string; expectedEnteredAt: number; expectedInstruction: string }
  | { type: 'conversation.create'; hubId?: string; taskId: string }
  | { type: 'conversation.close' | 'conversation.reopen'; hubId?: string; taskId: string; sessionId: string }
  | { type: 'task.delete'; hubId?: string; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean; requireIdle?: boolean }
  | ({ type: 'worktree.create'; hubId?: string; taskId: string } & CreateWorktree)
  | { type: 'worktree.attach'; hubId?: string; taskId: string; path: string }
  | { type: 'worktree.dismiss'; hubId?: string; taskId: string }
  | { type: 'worktree.remove'; hubId?: string; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean }
  | { type: 'operation.retry' | 'operation.return'; hubId?: string; taskId: string }
  | { type: 'note.save'; hubId?: string; taskId: string; noteId?: string; content: string; tags?: string[] };
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Problem };
export interface ClientApi {
  snapshot(): Promise<KanbanSnapshot>;
  command(command: Command): Promise<KanbanSnapshot>;
  branches(taskId: string): Promise<string[]>;
  worktreeDefault(taskId: string): Promise<{ branchName: string; path: string }>;
  detectProject(path: string): Promise<ProjectLocation>;
  subscribe(listener: (snapshot: KanbanSnapshot) => void): () => void;
}
export interface QuestionOption { title: string; description: string }
export interface QuestionPage {
  question: string; type: 'exclusive' | 'non_exclusive' | 'freetext'; context?: string;
  options?: QuestionOption[]; weight?: 'critical' | 'medium' | 'easy';
  model_lean?: string; model_lean_reason?: string; answers_affect_followup?: boolean;
}
export interface RoundPage { callId: string; sequence: number; page: QuestionPage }
export interface QuestionRound { id: string; sessionId: string; turnId: string; pages: RoundPage[]; complete: boolean; answered: boolean }
/** One conversation-scoped question projection frame; baseline replaces, update supersedes the same session. */
export interface QuestionFeedFrame { kind: 'baseline' | 'update'; rounds: QuestionRound[] }
export interface QuestionAnswer { choices: string[]; text: string; other: string; notes: string }
