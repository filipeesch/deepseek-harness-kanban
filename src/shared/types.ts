export const DATA_VERSION = 2 as const;
export interface Problem { code: string; message: string; details?: Record<string, unknown> }
export interface Project { id: string; name: string; projectPath: string; gitRootPath: string; defaultBranch?: string; workspaceId?: string; workspaceOwned?: boolean }
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
export interface PendingTransition { id: string; fromColumnId: string; columnId: string; mode: 'move' | 'run'; sessionId?: string; text?: string; beforeTaskId?: string | null; worktreeRequest?: CreateWorktree; status: 'waiting' | 'sending' | 'failed'; error?: Problem }
export interface Task {
  id: string; projectId: string; title: string; description: string; columnId: string; position: number;
  sessionIds: string[]; closedSessionIds: string[]; effectiveCwd: string;
  worktree: Worktree | null; operation: ContextOperation | null; pendingTransition?: PendingTransition;
  /** The current instructed-stage entry whose card action has not been satisfied by a prompt. */
  instructionPending?: { columnId: string; enteredAt: number };
  /** Diagnostic-only checkouts left on disk; never an execution or cleanup target. */
  unclaimedWorktrees?: Array<{ path: string; branch: string; error: Problem }>;
  worktreeWorkspaceId?: string; worktreeWorkspaceOwned?: boolean;
  createdAt: string; updatedAt: string;
}
export interface Note { id: string; taskId: string; content: string; createdAt: string; updatedAt: string; tags?: string[] }
export interface BoardSettings { worktreeBasePath?: string }
export interface BoardState { schemaVersion: 2; revision: number; workflowYaml: string; workflow: Workflow; projects: Project[]; tasks: Task[]; notes: Note[]; settings?: BoardSettings }
export type BackgroundKind = 'job' | 'subagent' | 'schedule';
/** One unsettled non-turn activity owned by a task conversation. */
export interface BackgroundActivity { kind: BackgroundKind; label: string }
/** One conversation's native execution facts as the host owns them. */
export interface SessionFacts { turn: boolean; background: BackgroundActivity[]; awaitingReply: boolean; failed: boolean }
export interface Attention { running: boolean; background: BackgroundActivity[]; unread: boolean; awaitingReply: boolean; failed: boolean }
/** Transient identity of the entity created by this exact command, never persisted. */
export interface CommandReceipt { kind: 'project' | 'task' | 'conversation' | 'note'; id: string }
export interface BoardSnapshot { commandReceipt?: CommandReceipt; state: BoardState; attention: Record<string, Attention>; sequence: number; clientEpoch?: number; questionRounds?: QuestionRound[] }
export const EMPTY_ATTENTION: Attention = { running: false, background: [], unread: false, awaitingReply: false, failed: false };
export interface ProjectInput { id?: string; name: string; projectPath: string; gitRootPath: string; defaultBranch?: string }
export interface NewTask { projectId: string; title: string; description: string }
export type Command =
  | { type: 'project.save'; project: ProjectInput; expectedRevision?: number }
  | { type: 'project.delete'; projectId: string; confirmed: boolean; expectedRevision?: number }
  | { type: 'workflow.save'; yaml: string; expectedRevision?: number }
  | { type: 'settings.save'; settings: BoardSettings; expectedRevision?: number }
  | ({ type: 'task.create' } & NewTask)
  | { type: 'task.edit'; taskId: string; title?: string; description?: string; expectedRevision?: number }
  | { type: 'task.move'; taskId: string; columnId: string; mode: 'move' | 'run'; sessionId?: string; newConversation?: boolean; worktree?: CreateWorktree; expectedInstruction?: string; beforeTaskId?: string | null }
  | { type: 'task.runInstruction'; taskId: string; columnId: string; expectedInstruction: string }
  | { type: 'conversation.create'; taskId: string }
  | { type: 'conversation.close' | 'conversation.reopen'; taskId: string; sessionId: string }
  | { type: 'task.delete'; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean; requireIdle?: boolean }
  | ({ type: 'worktree.create'; taskId: string } & CreateWorktree)
  | { type: 'worktree.attach'; taskId: string; path: string }
  | { type: 'worktree.remove'; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean }
  | { type: 'operation.retry' | 'operation.return'; taskId: string }
  | { type: 'note.save'; taskId: string; noteId?: string; content: string; tags?: string[] };
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Problem };
export interface ClientApi {
  snapshot(): Promise<BoardSnapshot>;
  command(command: Command): Promise<BoardSnapshot>;
  branches(taskId: string): Promise<string[]>;
  worktreeDefault(taskId: string): Promise<{ branchName: string; path: string }>;
  inferProject(path: string): Promise<{ projectPath: string; gitRootPath: string }>;
  subscribe(listener: (snapshot: BoardSnapshot) => void): () => void;
}
export interface QuestionOption { title: string; description: string }
export interface QuestionPage {
  question: string; type: 'exclusive' | 'non_exclusive' | 'freetext'; context?: string;
  options?: QuestionOption[]; weight?: 'critical' | 'medium' | 'easy';
  model_lean?: string; model_lean_reason?: string; answers_affect_followup?: boolean;
}
export interface RoundPage { callId: string; sequence: number; page: QuestionPage }
export interface QuestionRound { id: string; sessionId: string; turnId: string; pages: RoundPage[]; complete: boolean; answered: boolean }
export interface QuestionAnswer { choices: string[]; text: string; other: string; notes: string }
