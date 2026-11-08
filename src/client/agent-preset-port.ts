/** Native agent-preset roster and selection behind the drawer's preset cards. */

export interface AgentPresetOption {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

export interface AgentPresetSelectResult {
  readonly ok: boolean;
  /** The id the host actually accepted, when it returns one. */
  readonly id?: string;
  readonly message?: string;
}

export interface AgentPresetPort {
  list(): Promise<readonly AgentPresetOption[]>;
  select(sessionId: string, id: string): Promise<AgentPresetSelectResult>;
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
export interface AgentPresetConfigSource {
  developerTools(): boolean;
}

export interface AgentPresetPortSource {
  getSnapshot(): AgentPresetPort | null;
  subscribe(listener: () => void): () => void;
}

/** Let the card picker start before an optional Remote namespace is mounted. */
export function createAgentPresetPortSource(initialNamespace: unknown, config: AgentPresetConfigSource): AgentPresetPortSource & { set(namespace: unknown): void } {
  let port = createAgentPresetPort({ agentPresets: initialNamespace }, config);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => port,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(namespace) {
      port = createAgentPresetPort({ agentPresets: namespace }, config);
      for (const listener of listeners) listener();
    },
  };
}

export class AgentPresetPortError extends Error {
  constructor(message: string) { super(message); this.name = 'AgentPresetPortError'; }
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
 * Adapt the native remote namespace into the small port the preset cards own.
 * Array order is preserved; broken presets and coding-tools-gated entries are
 * removed exactly where the native picker would filter them.
 */
export function createAgentPresetPort(remote: unknown, config: AgentPresetConfigSource = { developerTools: () => true }): AgentPresetPort | null {
  const presets = remoteOf(remote);
  if (presets === undefined) return null;
  return {
    async list(): Promise<readonly AgentPresetOption[]> {
      const result = await presets.list();
      if (!result.ok || result.value === undefined) throw new AgentPresetPortError(errorMessage(result.error));
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
    async select(sessionId: string, id: string): Promise<AgentPresetSelectResult> {
      const result = await presets.select(sessionId, id);
      if (result.ok) return { ok: true, ...(typeof result.value === 'string' ? { id: result.value } : {}) };
      return { ok: false, message: errorMessage(result.error) };
    },
  };
}
