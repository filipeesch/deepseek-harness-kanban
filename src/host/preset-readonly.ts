/** The shipped presets whose agents must investigate without writing. */
export const READ_ONLY_PRESET_IDS: readonly string[] = ['kanban-project-planner'];

/** One live agent, as far as the read-only pin needs to know it. */
export interface PinAgent { readonly session: unknown }

export interface ReadOnlyPresetPinDeps {
  /** The preset the session runs on, or null when the host does not report one. */
  presetOf(session: unknown): string | null;
  /** The presets whose agents must work without writing. */
  readonly presets: ReadonlySet<string>;
  /** The session's sandbox mode, when the host can report it, so a repeated start does not record the pin twice. */
  currentMode?(session: unknown): string | undefined;
  /** Pin one session; the host owns how the mode is recorded. */
  pin(session: unknown): void;
  /** Report a defect; a lifecycle listener must never throw into the host. */
  report?(error: unknown): void;
}

export interface PresetReadOnlyPin {
  /** Pin the agent now when it runs on a read-only preset. */
  track(agent: PinAgent): void;
}

/**
 * Pin every agent of a read-only preset to the sandbox's read-only mode. The pin
 * runs on each agent start, so a resumed conversation is pinned again, and a
 * delegated child that joins the parent's preset revision is pinned by its own
 * start. The mode is recorded on the session, so the host's permission control
 * remains the person's decision: this only guarantees the agent starts confined.
 */
export function createPresetReadOnlyPin(deps: ReadOnlyPresetPinDeps): PresetReadOnlyPin {
  return {
    track(agent) {
      try {
        const preset = deps.presetOf(agent.session);
        if (preset === null || !deps.presets.has(preset)) return;
        if (deps.currentMode?.(agent.session) === 'read-only') return;
        deps.pin(agent.session);
      } catch (error) {
        deps.report?.(error);
      }
    },
  };
}
