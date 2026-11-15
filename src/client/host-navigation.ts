import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { Command, KanbanSnapshot } from '../shared/types.js';
import type { BoardPageState } from './page-state.js';
import { DrawerNavigationCoordinator, type SessionCatalogPort } from './drawer-navigation-coordinator.js';
import type { DrawerSessionRow, SubagentTarget } from './drawer-navigation.js';
import type { DrawerNavigationSource } from './drawer-navigation-coordinator.js';

/** The main-panel surface the layout service exposes. */
interface LayoutFace {
  readonly panelInfo: {
    getSnapshot(): { readonly activePanelId: string | null };
    subscribe(listener: () => void): () => void;
  };
  selectPanel(panelId: never): void;
}

/** The Kanban main-panel key this plugin registers. */
const KANBAN_PANEL = 'kanban';

function optional<T>(ctx: Context, key: string): T | undefined {
  try { return ctx.get(key) as T | undefined; } catch { return undefined; }
}

/** The client Session services the coordinator reads. */
type NavigationSessions = Pick<ISessions, 'list' | 'refresh' | 'subagentAddress'>;

/**
 * Compose the drawer's navigation coordinator over the host surfaces this client
 * generation owns.
 *
 * Every dependency is optional in the host: when the layout service is absent
 * the plugin creates no coordinator and native navigation is unchanged.
 */
export function createDrawerNavigation(
  ctx: Context,
  pageState: BoardPageState,
  command: (value: Command) => Promise<KanbanSnapshot>,
  sessions: NavigationSessions,
  snapshot: () => KanbanSnapshot | undefined,
): DrawerNavigationCoordinator | undefined {
  const layout = optional<LayoutFace>(ctx, 'layout');
  if (layout === undefined || typeof sessions.list?.subscribe !== 'function') return undefined;
  const catalog: SessionCatalogPort = {
    list: () => sessions.list.getSnapshot() as unknown as { byId: Readonly<Record<string, DrawerSessionRow | undefined>> },
    refresh: () => sessions.refresh(),
    subagentAddress: (sessionId: string): SubagentTarget | undefined => {
      const address = sessions.subagentAddress(sessionId as never);
      return address === undefined ? undefined : {
        parentSessionId: String(address.parentSessionId),
        sessionId: String(address.childSessionId),
        mode: address.mode,
      };
    },
    subscribe: listener => sessions.list.subscribe(listener),
  };
  return new DrawerNavigationCoordinator({
    panelId: KANBAN_PANEL,
    panel: {
      activePanel: () => layout.panelInfo.getSnapshot().activePanelId,
      selectPanel: panelId => { layout.selectPanel(panelId as never); },
      subscribe: listener => layout.panelInfo.subscribe(listener),
    },
    sessions: catalog,
    snapshot,
    pageState,
    attachFork: async (taskId, parentSessionId, sessionId) => command({ type: 'conversation.attach', taskId, parentSessionId, sessionId }),
    report: error => { console.warn('kanban: drawer navigation', error); },
  });
}

/**
 * Forwards the coordinator's change count to the drawer.
 *
 * The coordinator needs the host layout service, which a composition without one
 * does not have. The forwarder gives the drawer a stable subscription that simply
 * never changes in that case, and follows the coordinator once it is attached.
 */
export class NavigationForwarder {
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private source: DrawerNavigationSource | undefined;
  private version = 0;

  /** Follow one coordinator's changes; a later attach replaces the earlier one. */
  attach(source: DrawerNavigationSource): void {
    this.unsubscribe?.();
    this.source = source;
    this.unsubscribe = source.subscribe(() => this.publish());
    this.publish();
  }

  /** Stop following the coordinator, keeping the change count monotonic. */
  detach(): void {
    this.unsubscribe?.();
    this.source = undefined;
    this.unsubscribe = undefined;
    this.publish();
  }

  /** Leave the panel exit for that Session to the host (the drawer's escape asks for it). */
  suppressNextNavigation(sessionId: string): void {
    this.source?.suppressNextNavigation?.(sessionId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): number => this.version;

  private publish(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* One surface cannot take down navigation. */ }
    }
  }
}
