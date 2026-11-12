import type { BoardChange } from '../../src/domain/journal/event.js';
import { appendEvents, encodeBoardLog, headToken, type BoardLog } from '../../src/domain/journal/log.js';
import type { AppendOptions, BoardLogSnapshot, LayoutStampSnapshot, SharedLayoutStore, StorageReview } from '../../src/host/sharing/ports.js';
import { KanbanError } from '../../src/shared/errors.js';
import { SHARED_LAYOUT_VERSION } from '../../src/domain/sharing/layout.js';
import { genesisLog } from './board-log-fixture.js';

/** An in-memory published layout, so the port contract can be exercised without a storage. */
export class MemoryLayoutStore implements SharedLayoutStore {
  private stamp: number | null;
  private readonly logs = new Map<string, BoardLog>();
  private readonly revisions = new Map<string, number>();
  private writes = 0;

  constructor(initial?: { version?: number | null; logs?: Record<string, BoardLog | string> }) {
    this.stamp = initial?.version === undefined ? null : initial.version;
    for (const [key, value] of Object.entries(initial?.logs ?? {})) this.logs.set(key, typeof value === 'string' ? genesisLog(value) : value);
  }

  async ensure(): Promise<void> {}

  async readStamp(): Promise<LayoutStampSnapshot | null> {
    return this.stamp === null ? null : { version: this.stamp };
  }

  async writeStamp(version: number, options: { expectedVersion: number | null }): Promise<LayoutStampSnapshot> {
    if (this.stamp !== options.expectedVersion) throw new KanbanError('SHARING_STALE_TOKEN', 'The layout stamp changed since it was read.');
    this.stamp = version;
    this.writes += 1;
    return { version };
  }

  private probeOf(key: string): string {
    return 'probe-' + String(this.revisions.get(key) ?? 0);
  }

  async listLogs(): Promise<readonly { key: string; probe: string }[]> {
    return [...this.logs.keys()].sort().map(key => ({ key, probe: this.probeOf(key) }));
  }

  async probe(key: string): Promise<string | null> {
    return this.logs.has(key) ? this.probeOf(key) : null;
  }

  async readLog(key: string): Promise<BoardLogSnapshot | null> {
    const log = this.logs.get(key);
    if (log === undefined) return null;
    return { probe: this.probeOf(key), head: headToken(log), log };
  }

  async createLog(key: string, log: BoardLog): Promise<BoardLogSnapshot> {
    if (this.logs.has(key)) throw new KanbanError('SHARING_STALE_TOKEN', 'The board log already exists.');
    this.logs.set(key, log);
    this.bump(key);
    return { probe: this.probeOf(key), head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    const current = await this.readLog(key);
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.');
    if (current.head !== options.expectedHead) throw new KanbanError('SHARING_STALE_TOKEN', 'The board log changed since it was read.');
    const log = appendEvents(current.log, changes, options.at);
    this.logs.set(key, log);
    this.bump(key);
    return { probe: this.probeOf(key), head: headToken(log), log };
  }

  review(): StorageReview | null { return this.reviewValue; }

  state(): Record<string, unknown> { return {}; }

  async destroy(): Promise<void> {}

  /** Replace a test-owned raw log, including an encoding this reader cannot decode. */
  injectLog(key: string, log: BoardLog): void {
    this.logs.set(key, log);
    this.bump(key);
  }

  /** Replace a test-owned raw log text, so a test can model an unsupported encoding. */
  injectLogText(key: string, text: string): void {
    this.rawLogs.set(key, text);
    this.logs.delete(key);
    this.bump(key);
  }

  private readonly rawLogs = new Map<string, string>();
  private reviewValue: StorageReview | null = null;

  /** How many stamp writes this store accepted, so a test can assert one write. */
  get stampWrites(): number { return this.writes; }

  get stampVersion(): number | null { return this.stamp; }

  logOf(key: string): BoardLog | undefined { return this.logs.get(key); }

  setReview(review: StorageReview | null): void { this.reviewValue = review; }

  /** A raw encoded log, when a test injected one. */
  rawOf(key: string): string | undefined { return this.rawLogs.get(key) ?? (this.logs.has(key) ? encodeBoardLog(this.logs.get(key)!) : undefined); }

  private bump(key: string): void { this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1); }
}
