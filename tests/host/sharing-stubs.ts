import { SHARED_LAYOUT_VERSION } from '../../src/domain/sharing/layout.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot, SharedLayoutStore } from '../../src/host/sharing/ports.js';
import type { BoardChange } from '../../src/domain/journal/event.js';
import { appendEvents, headToken, type BoardLog } from '../../src/domain/journal/log.js';

/** A layout store that holds only a stamp, for the code paths that never read a log. */
export class EmptyLayoutStore implements SharedLayoutStore {
  stampVersion: number | null;
  constructor(version: number | null = null) { this.stampVersion = version; }
  async ensure(): Promise<void> {}
  async readStamp(): Promise<LayoutStampSnapshot | null> { return this.stampVersion === null ? null : { version: this.stampVersion }; }
  async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    if (options.expectedVersion !== this.stampVersion) throw new Error('stale stamp');
    this.stampVersion = version;
    return { version };
  }
  async listLogs(): Promise<readonly []> { return []; }
  async probe(): Promise<string | null> { return null; }
  async readLog(): Promise<BoardLogSnapshot | null> { return null; }
  async createLog(key: string, log: BoardLog): Promise<BoardLogSnapshot> { return { key, probe: 'probe', head: headToken(log), log } as BoardLogSnapshot; }
  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    void options;
    const log = appendEvents([], changes, '2026-01-01T00:00:00.000Z');
    return { key, probe: 'probe', head: headToken(log), log } as BoardLogSnapshot;
  }
  async destroy(): Promise<void> {}
}

export const LATEST = SHARED_LAYOUT_VERSION;
