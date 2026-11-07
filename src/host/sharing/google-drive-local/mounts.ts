import type { DriveDiscoveryView, DriveDiscoverySourceView, DriveLocationView } from '../../../shared/types.js';

/** A discovered Google Drive for desktop mount before it is projected for the client. */
export interface DriveMount {
  /** Stable identity: the root path. */
  id: string;
  rootPath: string;
  kind: 'account' | 'legacy';
  account?: string;
  driveName?: string;
  /** A source-specific explanation shown when the location is unavailable. */
  reason?: string;
}

/** One discovery source and whether it could be read. */
export interface DiscoverySourceResult {
  id: string;
  ok: boolean;
  reason?: string;
}

/** Everything one platform adapter can establish from local evidence. */
export interface DiscoveryEvidence {
  model: 'macos' | 'windows' | 'unsupported';
  mounts: DriveMount[];
  sources: DiscoverySourceResult[];
  /** Local evidence that the Drive for desktop application is present. */
  applicationDetected: boolean;
}

/** Keep a source reason short and free of control characters before it reaches the client. */
function sanitizedReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const value = reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (value.length === 0) return undefined;
  return value.length > 200 ? value.slice(0, 200) : value;
}

function projectSources(evidence: DiscoveryEvidence): DriveDiscoverySourceView[] {
  return evidence.sources.map(source => ({
    id: source.id,
    ok: source.ok,
    ...(source.reason === undefined ? {} : { reason: sanitizedReason(source.reason) ?? 'unreadable' }),
  }));
}

/** The projected discovery result the client consumes. */
export function projectDiscovery(evidence: DiscoveryEvidence, locations: DriveLocationView[]): DriveDiscoveryView {
  const sources = projectSources(evidence);
  const sourceField = sources.length === 0 ? {} : { sources };
  if (evidence.model === 'unsupported') return { state: 'unsupported', locations: [] };
  if (locations.length > 0) return { state: 'ready', locations, ...sourceField };
  if (!evidence.applicationDetected) return { state: 'app-missing', locations: [], ...sourceField };
  const failures = evidence.sources.filter(source => !source.ok);
  if (evidence.sources.length > 0 && failures.length === evidence.sources.length) {
    return {
      state: 'failed',
      locations: [],
      ...sourceField,
      reason: { code: 'SHARING_DRIVE_DISCOVERY_FAILED', message: 'Google Drive for desktop was detected but none of its local settings could be read.' },
    };
  }
  return { state: 'empty', locations: [], ...sourceField };
}
