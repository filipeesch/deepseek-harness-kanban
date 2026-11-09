import type { NewTask } from './task-creation.js';

export type { NewTask };

export const DATA_VERSION = 2 as const;
export interface Problem { code: string; message: string; details?: Record<string, unknown> }
/** One project location as it is recorded before, and applied as, a relocation target. */
export interface ProjectLocationPaths { projectPath: string; gitRootPath?: string; defaultBranch?: string }
/** Observable step of a recorded project relocation. */
export type ProjectRelocationPhase = 'queued' | 'preflight' | 'waiting' | 'migrating' | 'worktrees' | 'sessions' | 'workspace' | 'failed';
/** The durable relocation journal stored on the project it repairs. */
export interface ProjectRelocation {
  id: string;
  request: { from: ProjectLocationPaths; to: ProjectLocationPaths & { name: string } };
  phase: ProjectRelocationPhase;
  error?: Problem;
  /** Conversations whose directory change was already committed. */
  migratedSessionIds: string[];
  /** Set once a durable project or task change was applied; cancellation is no longer offered. */
  started: boolean;
  createdAt: string;
}
/** The fields every project carries, whatever its kind. */
export interface ProjectBase {
  id: string; name: string;
  /** Stable identity across boards and installations; unique within its Hub. */
  projectKey: string;
  gitRootPath?: string; defaultBranch?: string; workspaceId?: string; workspaceOwned?: boolean;
  /** Absent means no relocation is recorded. */
  operation?: ProjectRelocation;
}
/** A project registered in a Hub, with the directory its tasks use. */
export interface RegisteredProject extends ProjectBase { projectPath: string; origin?: undefined }
/** A project that exists only because a received board names its key; it has no directory until adopted. */
export interface PublishedProject extends ProjectBase { origin: 'published'; projectPath?: undefined }
export type Project = RegisteredProject | PublishedProject;
/** A project whose Git root is known; required by every Git and worktree operation. */
export type GitProject = RegisteredProject & { gitRootPath: string };
/** Non-persistent result of inspecting a folder for project registration. */
export type ProjectLocation =
  | { kind: 'git'; projectPath: string; gitRootPath: string; defaultBranch?: string }
  | { kind: 'folder'; projectPath: string };
/** How a board opens: the column board or the workflow diagram. */
export type WorkflowView = 'board' | 'workflow'
/** An authored diagram position for one stage, in diagram coordinates. */
export interface StagePosition { x: number; y: number }
/** One authored transition target and the condition under which it is followed. */
export type TransitionRule = { to: string; when?: string }
/** An authored minimum size for one stage, in diagram pixels. */
export interface StageSize { width: number; height: number }
export interface Column { id: string; name: string; onEnterPrompt?: string; allowedTransitions?: TransitionRule[]; /** Absent means the diagram places the stage automatically. */ position?: StagePosition; /** Absent means the stage renders at the accepted minimum size. */ size?: StageSize }
export interface ColumnGroup { id: string; name: string; columnIds: string[] }
export interface Workflow { name: string; initialColumnId: string; columns: Column[]; groups: ColumnGroup[]; /** Absent means the board opens the column board. */ defaultView?: WorkflowView }
export interface Worktree { path: string; branch: string; owned: boolean; status: 'preparing' | 'ready' | 'error'; error?: Problem }
export interface CreateWorktree { mode: 'new' | 'existing'; path: string; branchName: string; sourceBranch?: string }
/**
 * The host-derived default for a new worktree. `unavailable` is a real derivation
 * failure (an invalid path or exhausted names), never an unconfigured base path.
 */
export type WorktreeDefaults =
  | { kind: 'derived'; branchName: string; path: string; sourceBranch?: string }
  | { kind: 'unavailable'; reason: Problem };
/** The outcome of a tool-created task's automatic first execution. */
export interface FirstExecutionOutcome { status: 'not-applicable' | 'sent' | 'failed'; error?: Problem }
export type OperationRequest =
  | ({ kind: 'create' } & CreateWorktree)
  | { kind: 'attach'; path: string }
  | { kind: 'remove'; discardChanges: boolean; expectedWorktreePath?: string | null; force?: boolean }
  | { kind: 'delete'; discardChanges: boolean; expectedWorktreePath?: string | null; force?: boolean }
  | { kind: 'return' };
export interface ContextOperation {
  id: string; request: OperationRequest;
  phase: 'queued' | 'waiting' | 'preflight' | 'git' | 'switching' | 'removing' | 'archiving' | 'failed';
  targetPath?: string; targetDirectory?: string;
  /** A checkout retained because a deletion could not resolve its project context. */
  retainedCheckoutPath?: string;
  previousDirectories: Record<string, string>; switchedSessionIds: string[];
  archivedSessionIds: string[]; gitCompleted: boolean; error?: Problem; createdAt: string;
  createAttempt?: { operationId: string; path: string; gitRootPath: string; branchName: string; mode: 'new' | 'existing'; absentBefore: true };
}
export interface PendingTransition { id: string; fromColumnId: string; columnId: string; mode: 'move' | 'run'; sessionId?: string; text?: string; /** Absent places the task at the start of the destination; `null` places it at the end; an id places it before that task. */ beforeTaskId?: string | null; worktreeRequest?: CreateWorktree; transitionOverride?: boolean; status: 'waiting' | 'sending' | 'failed'; error?: Problem; /** Absent means a user-confirmed transition; `auto` is a host automatic advance. */ origin?: 'auto' }
/** Why auto mode is paused; only reasons that cannot be derived from the snapshot are recorded. */
export type AutoModePauseReason = 'turn-error' | 'turn-blocked' | 'turn-aborted' | 'turn-max-tokens' | 'advance-failed' | 'transition-stale';
export interface AutoModePause { reason: AutoModePauseReason; at: string; message?: string }
/** Per-task auto mode: arms the host advance on the next completed turn. */
export interface AutoModeState { enabled: boolean; pause?: AutoModePause }
/** One transition recorded for a task's current stage, and the stage it was recorded for. */
export interface RecordedTransition { fromColumnId: string; columnId: string; at: string }
export interface Task {
  id: string; projectId: string; title: string; description: string; columnId: string; position: number;
  sessionIds: string[]; closedSessionIds: string[]; effectiveCwd: string;
  worktree: Worktree | null; operation: ContextOperation | null; pendingTransition?: PendingTransition;
  /** The task has recorded a choice to continue in its base project instead of creating a worktree. */
  worktreeDismissed?: boolean;
  /** The current instructed-stage entry whose card action has not been satisfied by a prompt. */
  instructionPending?: { columnId: string; enteredAt: number };
  /** Opt-in host automatic advance; absent means disabled. */
  autoMode?: AutoModeState;
  /** The transition the model recorded for the current stage; discarded when the stage changes. */
  recordedTransition?: RecordedTransition;
  /** Diagnostic-only checkouts left on disk; never an execution or cleanup target. */
  unclaimedWorktrees?: Array<{ path: string; branch: string; error: Problem }>;
  worktreeWorkspaceId?: string; worktreeWorkspaceOwned?: boolean;
  createdAt: string; updatedAt: string;
}
export interface Note { id: string; taskId: string; content: string; createdAt: string; updatedAt: string; tags?: string[] }
export interface BoardSettings { worktreeBasePath?: string }
export interface Board {
  id: string; name: string; workflowYaml: string; workflow: Workflow;
  /** Absent means every project of the Hub may create tasks on this board; an empty list closes it to creation. */
  allowedProjectKeys?: string[];
  createdAt: string; updatedAt: string;
}
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
/** One category of input a conversation still owes the user. */
export type PendingUserWorkKind = 'decision-question' | 'native-question' | 'approval' | 'queued-prompt';
/** Everything a conversation still owes the user before an automatic advance may be admitted. */
export interface PendingUserWork { readonly kinds: readonly PendingUserWorkKind[]; readonly queuedPrompts: number }
export const NO_PENDING_USER_WORK: PendingUserWork = { kinds: [], queuedPrompts: 0 };
/** One conversation's native execution facts as the host owns them. */
export interface ConversationFacts {
  /** At least one owned agent is running: this conversation's own turn or a subagent descendant. */
  running: boolean;
  background: BackgroundActivity[];
  pending: PendingUserWork;
  settledTurn: SettledTurn | null;
}
export const EMPTY_CONVERSATION_FACTS: ConversationFacts = { running: false, background: [], pending: NO_PENDING_USER_WORK, settledTurn: null };
/** One conversation's projected attention, including the client-owned read state. */
export interface Attention { running: boolean; background: BackgroundActivity[]; unread: boolean; awaitingReply: boolean; failed: boolean; pending: PendingUserWork }
/** Transient identity of the entity created by this exact command, never persisted. */
export interface CommandReceipt { kind: 'hub' | 'board' | 'project' | 'task' | 'conversation' | 'note'; id: string }
/** One board's publishing state, projected from the stored sharing record. */
export type SharingBoardState = 'in-sync' | 'draft' | 'updates-available' | 'needs-review' | 'orphan';
export type SharingHubStatus = 'not-published' | 'preview' | 'published' | 'updates-available' | 'needs-review' | 'unavailable';
/** Every team storage the product supports. This tuple is the single declared source of truth. */
export const SHARING_STORAGES = ['git', 'google-drive', 'google-drive-local', 'local-folder'] as const;
export type SharingStorage = (typeof SHARING_STORAGES)[number];
export type SharingSyncMode = 'explicit' | 'continuous';
export type SharingAuthStatus = 'not-connected' | 'authorizing' | 'connected' | 'error' | 'reconnect-required';
export interface SharingAuthView {
  status: SharingAuthStatus;
  /** Present while the browser sign-in is waiting for the loopback callback. */
  authorizationUrl?: string;
  email?: string;
  error?: Problem;
  drives?: Array<{ id: string; name: string }>;
  folders?: Array<{ id: string; name: string }>;
}
export interface SharingBlockerView { code: string; message: string; boardId?: string; boardName?: string; columnId?: string; tasks?: number }
export interface SharingBoardView {
  boardId: string; key?: string; name: string; state: SharingBoardState; bound: boolean;
  /** The decision still requires review. */
  pending: boolean;
  /** Both versions, present for a board that needs a choice. */
  detail?: {
    local: string; team: string; localName: string; teamName: string;
    /** The local project scope; absent means every project, an empty list means closed. */
    localProjectKeys?: string[]; teamProjectKeys?: string[];
  };
}
export interface HubSharingView {
  status: SharingHubStatus;
  provider: SharingStorage;
  providerLabel: string;
  address: string;
  /** Kept for Git callers; equal to the repository address. */
  repository?: string;
  syncMode: SharingSyncMode;
  /** Drive authorization state; absent for storage that needs no account. */
  authorization?: SharingAuthStatus;
  intervalMinutes: number;
  lastCheckedAt?: string;
  lastSyncedAt?: string;
  error?: Problem;
  drafts: number;
  pending: number;
  updates: number;
  conflicts: number;
  orderChanged: boolean;
  syncing: boolean;
  boards: SharingBoardView[];
  incoming: Array<{ key: string; name: string }>;
  removed: Array<{ boardId: string; key: string; name: string }>;
  blockers: SharingBlockerView[];
  preview?: { publishedBoards: number; localBoards: number };
  /** Board a team update would remove locally because it holds no local work. */
  removing: Array<{ boardId: string; name: string }>;
}
/** Actions that operate a Hub's team storage. They are not board commands. */
export type SharingCommand =
  | { type: 'sharing.connect'; hubId: string; provider?: SharingStorage; settings?: Record<string, string>; repository?: string; intervalMinutes?: number }
  | { type: 'sharing.receive'; hubId: string }
  | { type: 'sharing.publishInitial'; hubId: string; confirmed: boolean }
  | { type: 'sharing.check'; hubId: string }
  | { type: 'sharing.getUpdates'; hubId: string }
  | { type: 'sharing.resolve'; hubId: string; boardId: string; choice: 'local' | 'team' }
  | { type: 'sharing.publish'; hubId: string }
  | { type: 'sharing.setInterval'; hubId: string; intervalMinutes: number }
  | { type: 'sharing.disconnect'; hubId: string }
  | { type: 'sharing.restore'; hubId: string; boardId: string }
  | { type: 'sharing.publishOrphan'; hubId: string; boardId: string }
  | { type: 'sharing.auth.start' }
  | { type: 'sharing.auth.cancel' }
  | { type: 'sharing.auth.disconnect' }
  | { type: 'sharing.auth.switch' }
  | { type: 'sharing.drives' }
  | { type: 'sharing.folders'; driveId?: string; parentId?: string }
  | { type: 'sharing.changeLocation'; hubId: string; settings: Record<string, string>; confirmed: boolean };
/** One Google Drive for desktop location discovered on this machine. */
export interface DriveLocationView {
  id: string;
  rootPath: string;
  kind: 'account' | 'legacy';
  status: 'available' | 'unavailable';
  /** Display labels only; the root path is the identity. */
  account?: string;
  driveName?: string;
  reason?: string;
}
/** Why discovery has no locations, when it has none. */
export type DriveDiscoveryState = 'ready' | 'empty' | 'app-missing' | 'unsupported' | 'failed';
export interface DriveDiscoverySourceView {
  id: string;
  ok: boolean;
  reason?: string;
}
export interface DriveDiscoveryView {
  state: DriveDiscoveryState;
  locations: DriveLocationView[];
  /** Every local source consulted, including the ones that failed. */
  sources?: DriveDiscoverySourceView[];
  reason?: Problem;
}
/** One folder in the Drive browser. */
export interface DriveFolderEntry {
  name: string;
  path: string;
  /** Present only when the folder name matches a recognized Drive structure. */
  group?: { id: 'my-drive' | 'shared-drives'; label: string };
}
export interface DriveBrowseView {
  rootId: string;
  path: string;
  parent: string | null;
  entries: DriveFolderEntry[];
  /** Whether the browsed folder already contains the published document. */
  hasDocument: boolean;
  truncated: boolean;
  /** How many folders this page returned. */
  shown: number;
}
export type LocalDriveRequest = { action: 'roots'; refresh?: boolean } | { action: 'list'; path: string };
export type LocalDriveResult =
  | { action: 'roots'; discovery: DriveDiscoveryView }
  | { action: 'list'; page: DriveBrowseView };
/** A checkout left on disk because a deletion could not resolve its Git context. */
export interface RetainedCheckout { path: string; projectId: string; taskTitle: string }
/**
 * Host snapshot: durable state plus per-conversation attention facts and per-Hub publishing.
 * `state` is present on baselines and command responses and omitted from an update frame that
 * did not change the state revision; the client merges it with the state it already holds.
 */
export interface HostSnapshot { commandReceipt?: CommandReceipt; state?: KanbanState; stateRevision: number; conversations: Record<string, ConversationFacts>; sharing: Record<string, HubSharingView>; sharingAuth?: SharingAuthView; /** Transient, in-memory retained checkouts; omitted when empty. */ retainedCheckouts?: RetainedCheckout[]; sequence: number }
/** A snapshot that carries the board state: every unary response, baseline, and command result. */
export type FullHostSnapshot = HostSnapshot & { state: KanbanState };
/** A request for one unary snapshot; every field is an optional hint, never a required read. */
export interface SnapshotRequest {
  /** Conversations that must be re-read before the response is built (a rising running status). */
  refreshSessionIds?: string[];
  /** Tasks whose conversations are resolved before historically idle ones (the open drawer). */
  priorityTaskIds?: string[];
  /** Re-read the authorization view instead of using its cached value. */
  refreshAuth?: boolean;
}
/** Client snapshot: host facts plus the client-owned attention projection. State is always merged. */
export interface KanbanSnapshot extends Omit<HostSnapshot, 'conversations' | 'state'> { state: KanbanState; attention: Record<string, Attention>; conversationAttention: Record<string, Attention>; clientEpoch?: number }
export const EMPTY_ATTENTION: Attention = { running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK };
export interface ProjectInput { id?: string; name: string; projectPath: string; gitRootPath?: string; defaultBranch?: string; projectKey?: string }
export type Command =
  | { type: 'hub.create'; name: string }
  | { type: 'hub.rename'; hubId: string; name: string; expectedRevision?: number }
  | { type: 'hub.delete'; hubId: string; confirmed: boolean }
  | { type: 'board.create'; hubId: string; name: string }
  | { type: 'board.rename'; hubId: string; boardId: string; name: string; expectedRevision?: number }
  | { type: 'board.delete'; hubId: string; boardId: string; confirmed: boolean; expectedRevision?: number; sharing?: 'local' | 'team' }
  | { type: 'board.workflow.save'; hubId: string; boardId: string; yaml: string; expectedRevision?: number }
  /** An absent `projectKeys` allows every project of the Hub; an empty list closes the board to creation. */
  | { type: 'board.projects.save'; hubId: string; boardId: string; projectKeys?: string[]; expectedRevision?: number }
  | { type: 'project.save'; hubId?: string; project: ProjectInput; expectedRevision?: number }
  | { type: 'project.relocate'; hubId?: string; project: ProjectInput & { id: string }; confirmed: boolean; expectedRevision?: number }
  | { type: 'project.relocationRetry'; hubId?: string; projectId: string }
  | { type: 'project.relocationCancel'; hubId?: string; projectId: string }
  | { type: 'project.delete'; hubId?: string; projectId: string; confirmed: boolean; expectedRevision?: number }
  | { type: 'settings.save'; settings: BoardSettings; expectedRevision?: number }
  | ({ type: 'task.create'; hubId?: string } & NewTask)
  | { type: 'task.edit'; hubId?: string; taskId: string; title?: string; description?: string; expectedRevision?: number }
  /** `beforeTaskId` absent places the task at the start of the destination; `null` places it at the end; an id places it before that task. */
  | { type: 'task.move'; hubId?: string; taskId: string; columnId: string; beforeTaskId?: string | null; overrideTransition?: boolean }
  | { type: 'task.autoMode'; hubId?: string; taskId: string; enabled: boolean }
  /** An omitted `columnId` clears the recording. */
  | { type: 'task.recordTransition'; hubId?: string; taskId: string; columnId?: string }
  | { type: 'task.runInstruction'; hubId?: string; taskId: string; columnId: string; expectedEnteredAt: number; expectedInstruction: string }
  | { type: 'task.prepareFirstExecution'; hubId?: string; taskId: string; columnId: string; expectedEnteredAt: number; expectedInstruction?: string }
  | { type: 'conversation.create'; hubId?: string; taskId: string }
  | { type: 'conversation.close' | 'conversation.reopen'; hubId?: string; taskId: string; sessionId: string }
  | { type: 'task.delete'; hubId?: string; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean; force?: boolean }
  | ({ type: 'worktree.create'; hubId?: string; taskId: string } & CreateWorktree)
  | { type: 'worktree.attach'; hubId?: string; taskId: string; path: string }
  | { type: 'worktree.dismiss'; hubId?: string; taskId: string }
  | { type: 'worktree.remove'; hubId?: string; taskId: string; confirmed: boolean; expectedWorktreePath: string | null; discardChanges?: boolean; force?: boolean }
  | { type: 'operation.retry' | 'operation.return'; hubId?: string; taskId: string }
  | { type: 'operation.dismiss'; hubId?: string; taskId: string }
  | { type: 'note.save'; hubId?: string; taskId: string; noteId?: string; content?: string; tags?: string[] }
  | { type: 'note.delete'; hubId?: string; taskId: string; noteId: string };
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Problem };
export interface ClientApi {
  snapshot(request?: SnapshotRequest): Promise<KanbanSnapshot>;
  command(command: Command): Promise<KanbanSnapshot>;
  sharing(command: SharingCommand): Promise<KanbanSnapshot>;
  localDrive(request: LocalDriveRequest): Promise<LocalDriveResult>;
  branches(taskId: string): Promise<string[]>;
  worktreeDefault(taskId: string): Promise<WorktreeDefaults>;
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
