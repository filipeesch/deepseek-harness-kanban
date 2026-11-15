import type { KanbanSnapshot, Task } from '../shared/types.js';
import { asProblem } from './problem.js';
import { allTasks } from './snapshot-normalize.js';
import type { BoardPageState } from './page-state.js';
import { taskPageState } from './page-state.js';
import {
  classifyNavigation, mainViewSession, openConversationIds, subagentTarget, taskConversationScope,
  type DrawerSessionList, type NavigationTarget, type SubagentTarget,
} from './drawer-navigation.js';
import {
  beginClaim, conversationOf, failClaim, openPeek, peekOf, selectConversation, type DrawerView, type ForkClaim,
} from './drawer-view.js';

/** The main-panel selection a navigation coordinator observes and restores. */
export interface PanelNavigationPort {
  /** The selected main panel, or null while a conversation is selected. */
  activePanel(): string | null;
  /** Select the Kanban panel again. */
  selectPanel(panelId: string): void;
  /** Observe panel changes; the callback runs synchronously with the store. */
  subscribe(listener: () => void): () => void;
}

/** The client Session catalog facts navigation classification reads. */
export interface SessionCatalogPort {
  list(): DrawerSessionList;
  /** Refresh the host-authoritative Session list; single-flight on the host. */
  refresh(): Promise<void>;
  /** Resolve an addressed descendant, or undefined when the catalog has no address. */
  subagentAddress(sessionId: string): SubagentTarget | undefined;
  /** Observe catalog changes; used to supersede a pending classification. */
  subscribe?(listener: () => void): () => void;
}

export interface DrawerNavigationPorts {
  /** The main panel this coordinator keeps selected. */
  readonly panelId: string;
  readonly panel: PanelNavigationPort;
  readonly sessions: SessionCatalogPort;
  /** The latest board snapshot, or undefined before the first frame. */
  readonly snapshot: () => KanbanSnapshot | undefined;
  readonly pageState: BoardPageState;
  /** Attach one claimed fork through the host's adoption path. */
  readonly attachFork: (taskId: string, parentSessionId: string, sessionId: string) => Promise<KanbanSnapshot>;
  readonly report?: (error: unknown) => void;
  /** How long an unclassified navigation may wait for the catalog; defaults to 5 seconds. */
  readonly classificationTimeoutMs?: number;
  readonly now?: () => number;
}

/** A subscribable change count for surfaces that read the page state this coordinator writes. */
export interface DrawerNavigationSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  /**
   * Skip the panel exit that reveals this Session, because the drawer itself asked for
   * it (the failed-claim action). Without it the drawer would re-claim the very
   * navigation the person used to leave.
   */
  suppressNextNavigation?(sessionId: string): void;
}

const DEFAULT_CLASSIFICATION_TIMEOUT_MS = 5_000;

function messageOf(error: unknown): string {
  return asProblem(error).message;
}

/**
 * Keeps a native navigation that targets the open task's own Sessions inside the task drawer.
 *
 * The host selects the target Session in its main pane and then deselects the
 * Kanban panel, which would unmount the board and the drawer. This coordinator
 * observes that panel change, resolves the Session the host just selected
 * against the open task, applies the drawer's outcome, and re-selects the
 * Kanban panel in the same update. A target the open task does not own keeps
 * the host's native navigation untouched.
 *
 * It writes only drawer view state — never a task fact — and publishes a change
 * count so the mounted drawer re-renders.
 */
export class DrawerNavigationCoordinator implements DrawerNavigationSource {
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private version = 0;
  /** Supersedes an asynchronous classification when a later navigation arrives. */
  private generation = 0;
  private previousPanel: string | null;
  /** The target of the in-flight asynchronous classification, if any. */
  private pendingTarget: string | undefined;
  /** The Session a drawer-initiated navigation revealed; that exit is left to the host. */
  private suppressed: string | undefined;
  /** The last main-pane selection observed, used to disambiguate a transition. */
  private previousMainView: string | undefined;

  private observing = false;

  constructor(private readonly ports: DrawerNavigationPorts) {
    this.now = ports.now ?? (() => Date.now());
    this.timeoutMs = ports.classificationTimeoutMs ?? DEFAULT_CLASSIFICATION_TIMEOUT_MS;
    this.previousPanel = this.ports.panel.activePanel();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): number => this.version;

  /** Leave the panel exit for this Session to the host: the drawer asked to reveal it. */
  suppressNextNavigation(sessionId: string): void {
    this.suppressed = sessionId;
  }

  /** Observe main-panel navigation until the returned disposer runs. */
  start(): () => void {
    if (this.observing) return () => undefined;
    this.observing = true;
    const disposePanel = this.ports.panel.subscribe(() => this.observe());
    // Catalog changes resolve the two asynchronous cases: a fresh branch whose row and
    // retention land after the panel exit, and a later navigation that supersedes it.
    const disposeSessions = this.ports.sessions.subscribe?.(() => this.supersedePending()) ?? (() => undefined);
    return () => { this.observing = false; disposePanel(); disposeSessions(); };
  }

  /** Classify the Session the host selected for the navigation already observed. */
  private resolveNavigation(target: string, generation: number): void {
    if (generation !== this.generation) return;
    const task = this.openTask();
    if (task === undefined) return;
    const classified = classifyNavigation(this.ports.sessions.list(), taskConversationScope(task), target);
    if (classified.kind === 'unclassified') {
      void this.classifyLater(task.id, target, generation);
      return;
    }
    this.apply(task, classified);
  }

  /**
   * Re-read the catalog after one refresh when the panel exit reported no selected Session.
   *
   * A native navigation retains its target before the client catalog lists its row, so
   * the retained Session is only observable after the host list is applied. Archiving
   * the current Session clears the selection without another one, and that case simply
   * resolves to nothing here.
   */
  private async discover(generation: number): Promise<void> {
    const started = this.now();
    try {
      await this.ports.sessions.refresh();
    } catch (error) {
      this.report(error);
      return;
    }
    if (generation !== this.generation) return;
    if (this.now() - started > this.timeoutMs) return;
    const target = mainViewSession(this.ports.sessions.list(), this.previousMainView);
    if (target === undefined) return;
    this.resolveNavigation(target, generation);
  }

  /** Drop the in-flight classification when the host's selected Session moved. */
  private supersedePending(): void {
    if (this.pendingTarget === undefined) return;
    const current = mainViewSession(this.ports.sessions.list(), this.previousMainView);
    // A fresh branch is retained before any row describes it, so an unreported
    // selection is not evidence of another navigation: only a different known
    // Session supersedes the pending classification.
    if (current === undefined || current === this.pendingTarget) return;
    this.pendingTarget = undefined;
    this.generation += 1;
  }

  private observe(): void {
    const current = this.ports.panel.activePanel();
    const previous = this.previousPanel;
    this.previousPanel = current;
    // Only a Kanban-panel exit is a candidate: another panel keeps the board mounted.
    if (previous !== this.ports.panelId || current !== null) return;
    const task = this.openTask();
    if (task === undefined) return;
    const generation = ++this.generation;
    const target = mainViewSession(this.ports.sessions.list(), this.previousMainView);
    if (this.suppressed !== undefined && this.suppressed === target) {
      this.suppressed = undefined;
      this.previousMainView = target;
      return;
    }
    this.suppressed = undefined;
    this.previousMainView = target;
    if (target === undefined) {
      void this.discover(generation);
      return;
    }
    this.resolveNavigation(target, generation);
  }

  /** One refresh makes a freshly forked child's lineage observable. */
  private async classifyLater(taskId: string, sessionId: string, generation: number): Promise<void> {
    const started = this.now();
    this.pendingTarget = sessionId;
    try {
      await this.ports.sessions.refresh();
    } catch (error) {
      this.pendingTarget = undefined;
      this.report(error);
      return;
    }
    this.pendingTarget = undefined;
    if (generation !== this.generation) return;
    if (this.now() - started > this.timeoutMs) return;
    const task = this.taskById(taskId);
    if (task === undefined) return;
    // The drawer was closed while the catalog refreshed: nothing to keep in view.
    if (this.openTask()?.id !== taskId) return;
    const next = classifyNavigation(this.ports.sessions.list(), taskConversationScope(task), sessionId);
    if (next.kind === 'fork') {
      this.apply(task, next);
      return;
    }
    // A host that records no fork lineage lists the branch without a parent. The host
    // proves the branch against the conversation the drawer was showing and attaches it
    // in one step; only a proven branch keeps the panel, and everything else — a new
    // chat, a branch of another conversation — keeps the host's native navigation.
    await this.claimUnproven(task, sessionId, generation);
  }

  /** Ask the host to prove and attach a branch the catalog does not describe. */
  private async claimUnproven(task: Task, sessionId: string, generation: number): Promise<void> {
    const view = taskPageState(this.ports.pageState, task.id).view;
    // A branch of a peeked descendant stays foreign; the drawer never claims it.
    if (peekOf(view) !== null) return;
    const parentSessionId = conversationOf(view);
    if (parentSessionId === null) return;
    let snapshot: KanbanSnapshot;
    try {
      snapshot = await this.ports.attachFork(task.id, parentSessionId, sessionId);
    } catch (error) {
      const problem = asProblem(error);
      // A Session the host does not prove is not a branch: the native navigation stands.
      if (problem.code === 'FORK_LINEAGE_MISMATCH' || problem.code === 'SESSION_NOT_FOUND' || problem.code === 'INVALID_ATTACH') return;
      // A proven branch that could not be attached is reported where the person can act.
      if (mainViewSession(this.ports.sessions.list(), this.previousMainView) !== sessionId) return;
      this.write(task.id, () => ({ claim: failClaim(beginClaim(sessionId), problem.message) }));
      this.restorePanel();
      return;
    }
    if (generation !== this.generation) return;
    const attached = allTasks(snapshot).find(value => value.id === task.id);
    if (attached === undefined || !attached.sessionIds.includes(sessionId)) return;
    // Another navigation while the proof ran wins: the person already moved on.
    if (mainViewSession(this.ports.sessions.list(), this.previousMainView) !== sessionId) return;
    // A tab the person picked while the host worked wins over the late result.
    if (conversationOf(taskPageState(this.ports.pageState, task.id).view) !== parentSessionId) return;
    this.write(task.id, current => ({ view: selectConversation(current.view, sessionId), claim: null }));
    this.restorePanel();
  }

  private apply(task: Task, target: NavigationTarget): void {
    switch (target.kind) {
      case 'conversation': {
        this.write(task.id, current => ({ view: selectConversation(current.view, target.sessionId), claim: null }));
        this.restorePanel();
        return;
      }
      case 'descendant': {
        const address = this.ports.sessions.subagentAddress(target.target.sessionId) ?? target.target;
        this.write(task.id, current => ({ view: openPeek(current.view, address), claim: null }));
        this.restorePanel();
        return;
      }
      case 'fork': {
        this.write(task.id, () => ({ claim: beginClaim(target.sessionId) }));
        this.restorePanel();
        void this.attach(task.id, target.parentSessionId, target.sessionId);
        return;
      }
      default:
        return;
    }
  }

  private async attach(taskId: string, parentSessionId: string, sessionId: string): Promise<void> {
    try {
      const snapshot = await this.ports.attachFork(taskId, parentSessionId, sessionId);
      const attached = allTasks(snapshot).find(task => task.id === taskId);
      if (attached === undefined || !attached.sessionIds.includes(sessionId)) {
        throw new Error('The host did not report the branch as a conversation of this task.');
      }
      // A tab the person picked while the host worked wins over the late result.
      if (conversationOf(taskPageState(this.ports.pageState, taskId).view) !== parentSessionId) {
        this.write(taskId, current => ({ claim: null, view: current.view }));
        return;
      }
      this.write(taskId, current => ({ view: selectConversation(current.view, sessionId), claim: null }));
    } catch (error) {
      this.write(taskId, current => ({ claim: current.claim === null ? null : failClaim(current.claim, messageOf(error)) }));
      this.report(error);
    }
  }

  private restorePanel(): void {
    if (this.ports.panel.activePanel() !== null) return;
    try {
      this.ports.panel.selectPanel(this.ports.panelId);
    } catch (error) {
      this.report(error);
    }
  }

  private taskById(taskId: string): Task | undefined {
    const snapshot = this.ports.snapshot();
    return snapshot === undefined ? undefined : allTasks(snapshot).find(task => task.id === taskId);
  }

  /** The task whose drawer is open; the board clears its selection when the drawer closes. */
  private openTask(): Task | undefined {
    const taskId = this.ports.pageState.selectedTaskId;
    return taskId === null ? undefined : this.taskById(taskId);
  }

  private write(taskId: string, update: (current: { view: DrawerView; claim: ForkClaim | null }) => { view?: DrawerView; claim?: ForkClaim | null }): void {
    const page = taskPageState(this.ports.pageState, taskId);
    const next = update({ view: page.view, claim: page.claim });
    if (next.view !== undefined && next.view !== page.view) page.view = next.view;
    if ('claim' in next) page.claim = next.claim ?? null;
    this.publish();
  }

  private publish(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* One surface cannot take down navigation. */ }
    }
  }

  private report(error: unknown): void {
    try { this.ports.report?.(error); } catch { /* A failing reporter must not escape. */ }
  }
}
