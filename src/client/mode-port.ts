/** Native agent-preset roster and selection behind the drawer's mode seat. */

export interface ModeOption {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

export interface ModeSelectResult {
  readonly ok: boolean;
  /** The id the host actually accepted, when it returns one. */
  readonly id?: string;
  readonly message?: string;
}

export interface ModePort {
  list(): Promise<readonly ModeOption[]>;
  select(sessionId: string, id: string): Promise<ModeSelectResult>;
}

interface RemoteResult<Value> {
  readonly ok: boolean;
  readonly value?: Value;
  readonly error?: { readonly message?: string; readonly details?: unknown };
}

interface RemotePreset {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly broken?: string;
  readonly isDefault?: boolean;
}

interface AgentPresetsRemote {
  list(): Promise<RemoteResult<{ readonly presets: readonly RemotePreset[] }>>;
  select(sessionId: string, id: string): Promise<RemoteResult<unknown>>;
}

/** Minimal native config read for the coding-tools gate; deployment data stays optional. */
export interface ModeConfigSource {
  developerTools(): boolean;
}

export interface ModePortSource {
  getSnapshot(): ModePort | null;
  subscribe(listener: () => void): () => void;
}

/** Let the hosted seat start before an optional Remote namespace is mounted. */
export function createModePortSource(initialNamespace: unknown, config: ModeConfigSource): ModePortSource & { set(namespace: unknown): void } {
  let port = createModePort({ agentPresets: initialNamespace }, config);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => port,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(namespace) {
      port = createModePort({ agentPresets: namespace }, config);
      for (const listener of listeners) listener();
    },
  };
}

export class ModePortError extends Error {
  constructor(message: string) { super(message); this.name = 'ModePortError'; }
}

function codingToolsRequired(preset: RemotePreset): boolean {
  // Match the native built-in predicate: a user-authored preset that happens to
  // use one of these ids keeps its own metadata and is not coding-tools-gated.
  return preset.name === undefined && (preset.id === 'ptc' || preset.id === 'minimal');
}

function remoteOf(remote: unknown): AgentPresetsRemote | undefined {
  const value = remote as { agentPresets?: AgentPresetsRemote } | null;
  return value?.agentPresets;
}

function errorMessage(error: RemoteResult<unknown>['error']): string {
  const reason = (error?.details as { reason?: unknown } | undefined)?.reason;
  if (typeof reason === 'string' && reason.length > 0) return reason;
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : 'The native agent preset request failed.';
}

/**
 * Adapt the native remote namespace into the small port the mode seat owns.
 * Array order is preserved; broken presets and coding-tools-gated entries are
 * removed exactly where the native picker would filter them.
 */
export function createModePort(remote: unknown, config: ModeConfigSource = { developerTools: () => true }): ModePort | null {
  const presets = remoteOf(remote);
  if (presets === undefined) return null;
  return {
    async list(): Promise<readonly ModeOption[]> {
      const result = await presets.list();
      if (!result.ok || result.value === undefined) throw new ModePortError(errorMessage(result.error));
      const developerTools = config.developerTools();
      return result.value.presets
        .filter(preset => preset.broken === undefined && (developerTools || !codingToolsRequired(preset)))
        .map(preset => ({
          id: preset.id,
          ...(preset.name === undefined ? {} : { name: preset.name }),
          ...(preset.description === undefined ? {} : { description: preset.description }),
          ...(preset.isDefault === true ? { isDefault: true } : {}),
        }));
    },
    async select(sessionId: string, id: string): Promise<ModeSelectResult> {
      const result = await presets.select(sessionId, id);
      if (result.ok) return { ok: true, ...(typeof result.value === 'string' ? { id: result.value } : {}) };
      return { ok: false, message: errorMessage(result.error) };
    },
  };
}
