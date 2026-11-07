import type { DiscoveryEvidence } from './mounts.js';

/** No Google Drive for desktop on this platform; discovery reports the condition. */
export class UnsupportedDriveDiscoveryAdapter {
  readonly model = 'unsupported' as const;
  async discover(): Promise<DiscoveryEvidence> {
    return { model: 'unsupported', mounts: [], sources: [], applicationDetected: false };
  }
}
