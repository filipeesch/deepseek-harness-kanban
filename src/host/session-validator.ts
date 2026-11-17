import { SessionRepairRefused } from './session-repair.js';

/** The installed loader chain, resolved lazily so nothing depends on it at activation. */
export interface InstalledSessionValidatorChain {
  readonly catalog: typeof import('@deepseek-ai/dsh-session-format-catalog')['sessionFormatCatalog'];
  readonly assertRelationships: typeof import('@deepseek-ai/dsh-session-format-v3-to-v4')['assertReleasedV4Relationships'];
  readonly validateStored: typeof import('@deepseek-ai/dsh-session-persistence')['validateStoredEvents'];
  readonly knownEventTypes: typeof import('@deepseek-ai/dsh-session')['KNOWN_SESSION_EVENT_TYPES'];
}

/** Loads the installed chain; a test or an incomplete host may supply its own. */
export type InstalledValidatorLoader = () => Promise<InstalledSessionValidatorChain>;

/** One artifact's validation over the installed chain; async because the chain loads on first use. */
export type SessionArtifactValidator = (header: unknown, rows: readonly unknown[]) => Promise<void>;

/**
 * Import the packages at their root. They are host peers: the plugin must not fail to
 * activate when they are absent, so they are resolved here and never at module load.
 */
async function loadInstalledChain(): Promise<InstalledSessionValidatorChain> {
  const [catalog, relationships, persistence, session] = await Promise.all([
    import('@deepseek-ai/dsh-session-format-catalog'),
    import('@deepseek-ai/dsh-session-format-v3-to-v4'),
    import('@deepseek-ai/dsh-session-persistence'),
    import('@deepseek-ai/dsh-session'),
  ]);
  return {
    catalog: catalog.sessionFormatCatalog,
    assertRelationships: relationships.assertReleasedV4Relationships,
    validateStored: persistence.validateStoredEvents,
    knownEventTypes: session.KNOWN_SESSION_EVENT_TYPES,
  };
}

/**
 * Validate one artifact with the installed host's own loader chain, exactly as a read
 * would: the format catalog restores current records, the released V4 relationships are
 * asserted, and the persistence contract validates the events. A repair that cannot pass
 * this chain is never swapped into place, and an unavailable chain refuses the repair
 * instead of accepting the rewrite on trust.
 * @param load - chain loader; the installed packages by default.
 * @returns the validator the repair pipeline consumes.
 */
export function createInstalledSessionValidator(load: InstalledValidatorLoader = loadInstalledChain): SessionArtifactValidator {
  let chain: Promise<InstalledSessionValidatorChain> | undefined;
  return async (header, rows) => {
    let installed: InstalledSessionValidatorChain;
    try { installed = await (chain ??= load()); }
    catch {
      // A failed load is not memoized: a host that mounts the capability later can still repair.
      chain = undefined;
      throw new SessionRepairRefused('The installed loader validator is unavailable on this host, so nothing was repaired.');
    }
    const restore = installed.catalog.createRestore(header, { recovery: 'strict', validation: 'transformed' });
    for (const row of rows) restore.decodeRow(row);
    const artifact = restore.finish();
    installed.assertRelationships(artifact, installed.knownEventTypes);
    // The catalog returns the current logical artifact; the persistence contract types the
    // same values as already-adopted events, so the boundary is widened here only.
    installed.validateStored(
      artifact.header as unknown as Parameters<typeof installed.validateStored>[0],
      artifact.events as unknown as Parameters<typeof installed.validateStored>[1],
    );
  };
}

/** The installed-chain validator the host composes by default. */
export const validateSessionArtifact = createInstalledSessionValidator();
