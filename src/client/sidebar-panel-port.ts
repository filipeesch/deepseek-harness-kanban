/**
 * Structural bridge to the host's right Sidebar service.
 *
 * The published DSH SDK predates the embedded-panel capability, so this module
 * imports nothing from the host package: it reads the optional service at
 * runtime, verifies the capability, and narrows each Session's face to the
 * observable expansion and the write the drawer consumes. A host without the
 * capability yields no port, which keeps today's drawer behavior intact.
 */

/** A host snapshot source: the shape every Sidebar observable exposes. */
export interface HostObservable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** One named Session's panel state, as the drawer reads and writes it. */
export interface SidebarSessionFace {
  /** The Session this face speaks for. */
  readonly sessionId: string;
  /**
   * Whether that Session's panel is expanded. Answers before any occurrence
   * mounts (collapsed) and follows the host store afterwards.
   */
  readonly expanded: HostObservable<boolean>;
  /** Expand or collapse that Session's panel through the host. */
  readonly setExpanded: (expanded: boolean) => void;
}

/** What the drawer consumes from the host: one Session's face, when it exists. */
export interface SidebarPanelPort {
  /**
   * Read one named Session's face.
   * @param sessionId - the Session whose panel the drawer wants to present.
   * @returns the stable face, or undefined when the host cannot answer for it.
   */
  forSession(sessionId: string): SidebarSessionFace | undefined;
}

/** The raw host service shape this module narrows; every member is optional. */
export interface SidebarPanelService {
  /** Capability roster reported by the host Sidebar service. */
  readonly capabilities?: { readonly embeddedPanel?: unknown };
  /** Per-Session face factory, present on hosts with the embedded panel. */
  readonly forSession?: (sessionId: string) => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObservable(value: unknown): value is HostObservable<unknown> {
  return isRecord(value) && typeof value.getSnapshot === 'function' && typeof value.subscribe === 'function';
}

/**
 * Narrow one host face; a malformed face yields nothing rather than a broken rail.
 * @param value - the value the host returned for one Session.
 * @param sessionId - the Session that was asked for.
 * @returns the narrowed face, or undefined when the value is not a usable face.
 */
function narrowFace(value: unknown, sessionId: string): SidebarSessionFace | undefined {
  if (!isRecord(value)) return undefined;
  const expanded = value.expanded;
  const setExpanded = value.setExpanded;
  if (!isObservable(expanded) || typeof setExpanded !== 'function') return undefined;
  const source = expanded as HostObservable<unknown>;
  return {
    sessionId,
    expanded: {
      getSnapshot: () => source.getSnapshot() === true,
      subscribe: listener => source.subscribe(listener),
    },
    setExpanded: next => { (setExpanded as (this: unknown, next: boolean) => void).call(value, next); },
  };
}

/**
 * Build the port from whatever the client reads for `sidebarRight`.
 *
 * The port is built once per client generation. It answers only when the
 * service reports the embedded-panel capability and exposes the per-Session
 * face; until then the drawer renders exactly as it does on an older host.
 * @param value - the optional service value (unknown on hosts that lack it).
 * @returns the port, or undefined when the host cannot host the panel.
 */
export function createSidebarPanelPort(value: unknown): SidebarPanelPort | undefined {
  if (!isRecord(value)) return undefined;
  const service = value as SidebarPanelService;
  const capability = isRecord(service.capabilities) ? service.capabilities.embeddedPanel : undefined;
  if (capability !== true || typeof service.forSession !== 'function') return undefined;
  const read = service.forSession.bind(service);
  // Per-Session narrowing is cached so every render subscribes to the same
  // observable identity. A host that cannot answer caches "no face" rather than
  // retrying on every render.
  const faces = new Map<string, SidebarSessionFace | null>();
  return {
    forSession(sessionId) {
      const cached = faces.get(sessionId);
      if (cached !== undefined) return cached ?? undefined;
      let face: SidebarSessionFace | undefined;
      try { face = narrowFace(read(sessionId), sessionId); }
      catch { face = undefined; }
      faces.set(sessionId, face ?? null);
      return face;
    },
  };
}
