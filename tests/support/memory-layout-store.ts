import type { SharedHubManifest } from '../../src/domain/sharing/manifest.js';
import { readSharedConfiguration, serializeSharedManifest, sharedManifestToken } from '../../src/domain/sharing/manifest.js';
import { appendEvents, createBoardLog, decodeBoardLog, encodeBoardLog, headToken } from '../../src/domain/journal/log.js';
import type { BoardChange } from '../../src/domain/journal/event.js';
import type { AppendOptions, BoardLogSnapshot, ManifestSnapshot, SharedLayoutStore } from '../../src/host/sharing/ports.js';
import { KanbanError } from '../../src/shared/errors.js';

/** An in-memory published layout, so the port contract can be exercised without a storage. */
export class MemoryLayoutStore implements SharedLayoutStore {
  private manifestText: string | null;
  private readonly logs = new Map<string, string>();
  private readonly probes = new Map<string, number>();
  private writes = 0;

  constructor(initial?: { manifest?: SharedHubManifest; logs?: Record<string, string> }) {
    this.manifestText = initial?.manifest === undefined ? null : serializeSharedManifest(initial.manifest);
    for (const [key, text] of Object.entries(initial?.logs ?? {})) this.logs.set(key, encodeLogText(text));
  }

  async ensure(): Promise<void> {}

  async readManifest(_signal?: AbortSignal, cached?: ManifestSnapshot | null): Promise<ManifestSnapshot | null> {
    if (this.manifestText === null) return null;
    const read = readSharedConfiguration(this.manifestText);
    const token = sharedManifestToken(read.manifest);
    if (cached !== null && cached !== undefined && cached.token === token) return cached;
    return { token, manifest: read.manifest, legacyWorkflows: read.legacyWorkflows };
  }

  async writeManifest(manifest: SharedHubManifest, options: { expectedToken: string | null }): Promise<{ token: string }> {
    const current = this.manifestText === null ? null : sharedManifestToken(readSharedConfiguration(this.manifestText).manifest);
    if (current !== options.expectedToken) throw new KanbanError('SHARING_STALE_TOKEN', 'The manifest changed since it was read.');
    this.manifestText = serializeSharedManifest(manifest);
    this.writes += 1;
    return { token: sharedManifestToken(manifest) };
  }

  async probe(key: string): Promise<string | null> {
    return this.logs.has(key) ? 'probe-' + String(this.probes.get(key) ?? 0) : null;
  }

  async readLog(key: string): Promise<BoardLogSnapshot | null> {
    const text = this.logs.get(key);
    if (text === undefined) return null;
    const decoded = decodeBoardLog(JSON.parse(text));
    if (!decoded.ok) throw new KanbanError('SHARING_INVALID_DOCUMENT', 'Stored board log is invalid.');
    return { probe: 'probe-' + String(this.probes.get(key) ?? 0), head: headToken(decoded.log), log: decoded.log };
  }

  async createLog(key: string, text: string): Promise<BoardLogSnapshot> {
    if (this.logs.has(key)) throw new KanbanError('SHARING_STALE_TOKEN', 'The board log already exists.');
    const log = createBoardLog(text);
    this.logs.set(key, JSON.stringify(encodeBoardLog(log)));
    this.probes.set(key, (this.probes.get(key) ?? 0) + 1);
    return { probe: 'probe-' + String(this.probes.get(key)), head: headToken(log), log };
  }

  async appendChanges(key: string, changes: readonly BoardChange[], options: AppendOptions): Promise<BoardLogSnapshot> {
    const current = await this.readLog(key);
    const head = current?.head ?? null;
    if (head !== options.expectedHead) throw new KanbanError('SHARING_STALE_TOKEN', 'The board log changed since it was read.');
    if (current === null) throw new KanbanError('SHARING_BOARD_LOG_MISSING', 'The board has no published log.');
    const log = appendEvents(current.log, changes, options.at);
    this.logs.set(key, JSON.stringify(encodeBoardLog(log)));
    this.probes.set(key, (this.probes.get(key) ?? 0) + 1);
    return { probe: 'probe-' + String(this.probes.get(key)), head: headToken(log), log };
  }

  async removeLog(key: string): Promise<void> {
    this.logs.delete(key);
    this.probes.delete(key);
  }

  /** How many manifest writes this store accepted, so a test can assert one write. */
  get manifestWrites(): number { return this.writes; }

  async destroy(): Promise<void> {}
}

function encodeLogText(text: string): string {
  return JSON.stringify(encodeBoardLog(createBoardLog(text)));
}
