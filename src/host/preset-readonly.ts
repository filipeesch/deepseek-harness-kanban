/**
 * The shipped presets whose agent starts confined: it investigates and produces
 * its artifacts through its own confined tools, and never touches the repository
 * it is planning. The pin below guarantees the START, not a total absence of
 * writes, because a role whose only write is a plan file still needs a session
 * that cannot reach anything else.
 */
export const CONFINED_START_PRESET_IDS: readonly string[] = ['kanban-project-planner'];

/** One live agent, as far as the confinement pin needs to know it. */
export interface PinAgent { readonly session: unknown }

export interface ConfinedStartPinDeps {
  /** The preset the session runs on, or null when the host does not report one. */
  presetOf(session: unknown): string | null;
  /** The presets whose agents must start confined. */
  readonly presets: ReadonlySet<string>;
  /** The session's sandbox mode, when the host can report it, so a repeated start does not record the pin twice. */
  currentMode?(session: unknown): string | undefined;
  /** Pin one session; the host owns how the mode is recorded. */
  pin(session: unknown): void;
  /** Report a defect; a lifecycle listener must never throw into the host. */
  report?(error: unknown): void;
}

export interface ConfinedStartPin {
  /** Pin the agent now when it runs on a confined-start preset. */
  track(agent: PinAgent): void;
}

/**
 * Pin every agent of a confined-start preset to the sandbox's read-only mode. The pin
 * runs on each agent start, so a resumed conversation is pinned again, and a
 * delegated child that joins the parent's preset revision is pinned by its own
 * start. The mode is recorded on the session, so the host's permission control
 * remains the person's decision: this only guarantees the agent starts confined.
 *
 * A plan write does not consult this mode: the plan tools stamp their own policy
 * rooted at the plan directory for that one call, which is why the pin can stay
 * strict without taking the role's one capability away.
 */
export function createConfinedStartPin(deps: ConfinedStartPinDeps): ConfinedStartPin {
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
