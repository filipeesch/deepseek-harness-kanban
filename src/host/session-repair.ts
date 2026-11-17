import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib';
import type { SessionArtifactLocation, SessionRepairResult } from '../shared/types.js';

/** The zstd frame magic the JSONL backend writes. */
const ZSTD_MAGIC = 0xFD2FB528;
/** Frame options: keep the checksum flag the backend writes. */
const FRAME_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
/** PTC dispatch identifiers carry the sequence `<root>:ptc:<n>`; nothing else is renumbered. */
const PTC_ID = /^(.*):ptc:(\d+)$/;

/** One physical frame inside the artifact. */
export interface ArtifactFrame { readonly start: number; readonly end: number }

/** A repair the product refuses to perform, with the reason a person can read. */
export class SessionRepairRefused extends Error {
  constructor(message: string) { super(message); this.name = 'SessionRepairRefused'; }
}

/** One decoded artifact: its header line, its rows, and the frame each line came from. */
export interface ScannedArtifact {
  readonly header: unknown;
  readonly rows: readonly unknown[];
  /** Every physical line, the header included, in file order. */
  readonly lines: readonly string[];
  /** The frame index of each line. */
  readonly lineFrames: readonly number[];
  readonly frames: readonly ArtifactFrame[];
  readonly bytes: Buffer;
}

/** One renamed PTC dispatch identifier. */
export interface Rename { readonly from: string; readonly to: string }

/** What one repair will change: the distinct identifiers and the exact mapping per row. */
export interface RepairPlan {
  /** The distinct identifiers this repair renames, one per colliding occurrence. */
  readonly renames: readonly Rename[];
  /** The identifiers each changed row must receive. */
  readonly lineRenames: ReadonlyMap<number, ReadonlyMap<string, string>>;
}

/** The rewritten artifact and the decoded values that must be validated before the swap. */
export interface RewrittenArtifact {
  readonly bytes: Buffer;
  readonly rows: readonly unknown[];
  readonly changedLines: readonly number[];
}

/** Scan the physical frames of one artifact; a torn final frame is refused, never guessed. */
export function scanFrames(buffer: Buffer): { frames: ArtifactFrame[]; tornStart?: number } {
  const frames: ArtifactFrame[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new SessionRepairRefused('The stored log does not start a zstd frame where one is expected.');
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset); offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remaining = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remaining) return { frames, tornStart: start };
    offset += remaining;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      const payload = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payload) return { frames, tornStart: start };
      offset += payload;
      if (lastBlock) break;
    }
    if (checksum) { if (buffer.length - offset < 4) return { frames, tornStart: start }; offset += 4; }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function decodeFrame(bytes: Buffer, frame: ArtifactFrame): string {
  return zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8');
}

function encodeFrame(text: string): Buffer {
  return zstdCompressSync(Buffer.from(text, 'utf8'), FRAME_OPTIONS);
}

/**
 * Decode one artifact into its header, rows, and per-line frame ownership.
 * The first frame must be exactly the header line, which is the shape the JSONL
 * backend writes; anything else is refused instead of rewritten.
 */
export function scanArtifact(bytes: Buffer): ScannedArtifact {
  const scan = scanFrames(bytes);
  if (scan.tornStart !== undefined) throw new SessionRepairRefused('The stored log ends in a torn frame; truncate it before repairing identifiers.');
  if (scan.frames.length === 0) throw new SessionRepairRefused('The stored log has no frames.');
  const lines: string[] = [];
  const lineFrames: number[] = [];
  for (const [index, frame] of scan.frames.entries()) {
    const text = decodeFrame(bytes, frame);
    const parts = text.split('\n');
    if (parts.at(-1) !== '') throw new SessionRepairRefused('A stored frame does not end on a line boundary.');
    parts.pop();
    if (index === 0 && parts.length !== 1) throw new SessionRepairRefused('The first stored frame is not exactly the header line.');
    for (const line of parts) { lines.push(line); lineFrames.push(index); }
  }
  const headerLine = lines[0];
  if (headerLine === undefined) throw new SessionRepairRefused('The stored log has no header line.');
  let header: unknown;
  try { header = JSON.parse(headerLine); }
  catch { throw new SessionRepairRefused('The stored header line is not valid JSON.'); }
  const rows: unknown[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    try { rows.push(JSON.parse(line)); }
    catch { throw new SessionRepairRefused('The stored log contains a line that is not valid JSON.'); }
  }
  return { header, rows, lines, lineFrames, frames: scan.frames, bytes };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowType(row: unknown): string {
  return record(row) && typeof row['type'] === 'string' ? row['type'] : '';
}

function rowData(row: unknown): Record<string, unknown> | undefined {
  return record(row) && record(row['data']) ? row['data'] : undefined;
}

/** The PTC sub-call an event starts, when it starts one. */
function dispatchStartId(row: unknown): string | undefined {
  if (rowType(row) !== 'tool/ptc-dispatch-start') return undefined;
  const id = rowData(row)?.['subCallId'];
  return typeof id === 'string' ? id : undefined;
}

/**
 * Where the dispatch started at `index` settles: its own `tool/ptc-dispatch`, the
 * event the installed format pairs with `tool/ptc-dispatch-start` by `subCallId`.
 */
function dispatchSettleIndex(rows: readonly unknown[], index: number, id: string): number | undefined {
  for (let next = index + 1; next < rows.length; next += 1) {
    const row = rows[next];
    if (rowType(row) !== 'tool/ptc-dispatch') continue;
    if (rowData(row)?.['subCallId'] === id) return next;
  }
  return undefined;
}

/** The job identity an event reports, when it reports one. */
function jobIdOf(row: unknown): string | undefined {
  const id = rowData(row)?.['jobId'];
  return typeof id === 'string' ? id : undefined;
}

/**
 * The identifiers one row may carry that a rename has to follow. Only documented
 * top-level fields are listed: a payload that happens to contain the same text is
 * never rewritten.
 */
function identifiersOf(row: unknown): string[] {
  const data = rowData(row);
  if (data === undefined) return [];
  const ids: string[] = [];
  if (typeof data['subCallId'] === 'string') ids.push(data['subCallId']);
  if (typeof data['parentCallId'] === 'string') ids.push(data['parentCallId']);
  if (record(data['toolCall']) && typeof data['toolCall']['callId'] === 'string') ids.push(data['toolCall']['callId']);
  return ids;
}

/** The next identifier after every identifier already used for the same root. */
function nextIdentifier(id: string, used: Set<string>, maxByRoot: Map<string, number>): string | undefined {
  const match = PTC_ID.exec(id);
  if (match === null) return undefined;
  const root = match[1]!;
  let next = (maxByRoot.get(root) ?? 0) + 1;
  let candidate = root + ':ptc:' + next;
  while (used.has(candidate)) { next += 1; candidate = root + ':ptc:' + next; }
  maxByRoot.set(root, next);
  used.add(candidate);
  return candidate;
}

/**
 * Plan the renumbering of colliding PTC dispatch identifiers.
 *
 * A collision is decided per `tool/ptc-dispatch-start` occurrence, not per invocation:
 * only an identifier already started earlier is renamed, so a unique later identifier
 * inside a repeated invocation keeps its own name. The rename follows the identifier
 * through the records that reference it — the dispatch settlement inside the same
 * invocation, and any job record that was registered there and settled later, which is
 * why those are paired by `jobId` rather than by position.
 */
export function planRepair(rows: readonly unknown[]): RepairPlan {
  const used = new Set<string>();
  const maxByRoot = new Map<string, number>();
  for (const row of rows) {
    for (const id of identifiersOf(row)) {
      used.add(id);
      const match = PTC_ID.exec(id);
      if (match !== null) maxByRoot.set(match[1]!, Math.max(maxByRoot.get(match[1]!) ?? 0, Number(match[2])));
    }
  }
  const lineRenames = new Map<number, Map<string, string>>();
  const distinct = new Map<string, Rename>();
  const addToRow = (index: number, id: string, to: string): void => {
    const perRow = lineRenames.get(index) ?? new Map<string, string>();
    const existing = perRow.get(id);
    if (existing !== undefined && existing !== to) throw new SessionRepairRefused('Two renames disagree about one identifier.');
    perRow.set(id, to);
    lineRenames.set(index, perRow);
    distinct.set(id + '\u0000' + to, { from: id, to });
  };
  const seenStarts = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const id = dispatchStartId(row);
    if (id === undefined) continue;
    if (!seenStarts.has(id)) { seenStarts.add(id); continue; }
    // The duplicate owns exactly its own dispatch span, which is what keeps a unique
    // identifier that merely shares the invocation from being renamed with it.
    const end = dispatchSettleIndex(rows, index, id);
    const next = end === undefined ? undefined : nextIdentifier(id, used, maxByRoot);
    // A duplicate that never closes, or an identifier this repair cannot renumber, is
    // left to the loader validation to refuse before anything is replaced.
    if (end === undefined || next === undefined) continue;
    const jobIds = new Set<string>();
    for (let at = index; at <= end; at += 1) {
      const inner = rows[at];
      const references = identifiersOf(inner).includes(id);
      if (references) addToRow(at, id, next);
      const jobId = jobIdOf(inner);
      if (jobId !== undefined && references) jobIds.add(jobId);
    }
    // A job registered inside the duplicate span may settle after the invocation closed:
    // its identity, not its position, decides that it belongs to the renamed invocation.
    for (const [at, inner] of rows.entries()) {
      const jobId = jobIdOf(inner);
      if (jobId === undefined || !jobIds.has(jobId)) continue;
      if (identifiersOf(inner).includes(id)) addToRow(at, id, next);
    }
  }
  return { renames: [...distinct.values()], lineRenames };
}

/** One row's applied changes: the exact field path and its old and new value. */
interface AppliedChange { readonly from: string; readonly to: string }

/**
 * Rename the identifier fields of one parsed row in place.
 * Only the documented fields are touched, so a payload string that merely looks like
 * an identifier is never rewritten.
 * @returns the applied changes keyed by their exact field path.
 */
function rewriteIdentifiers(row: unknown, mapping: ReadonlyMap<string, string>): Map<string, AppliedChange> {
  const applied = new Map<string, AppliedChange>();
  const data = rowData(row);
  if (data === undefined) return applied;
  const field = (path: string, holder: Record<string, unknown>, key: string): void => {
    const value = holder[key];
    if (typeof value !== 'string') return;
    const to = mapping.get(value);
    if (to === undefined || to === value) return;
    holder[key] = to;
    applied.set(path, { from: value, to });
  };
  field('data.subCallId', data, 'subCallId');
  field('data.parentCallId', data, 'parentCallId');
  if (record(data['toolCall'])) field('data.toolCall.callId', data['toolCall'], 'callId');
  return applied;
}

/**
 * Compare one rewritten row with its original, allowing a difference only at a field
 * whose exact path was rewritten and only for the exact old and new value. This is what
 * keeps a rename from quietly changing a payload scalar that happens to carry the text.
 */
function assertOnlyApprovedChanges(before: unknown, after: unknown, applied: ReadonlyMap<string, AppliedChange>, path = ''): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (typeof before === 'string' && typeof after === 'string') {
    const change = applied.get(path);
    if (change !== undefined && change.from === before && change.to === after) return;
    throw new SessionRepairRefused('The rewrite changed a value the plan did not approve at ' + (path === '' ? '<root>' : path) + '.');
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) throw new SessionRepairRefused('The rewrite changed the shape of a record.');
    for (let index = 0; index < before.length; index += 1) assertOnlyApprovedChanges(before[index], after[index], applied, path + '[' + index + ']');
    return;
  }
  if (record(before) && record(after)) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    if (beforeKeys.length !== afterKeys.length || beforeKeys.some((key, index) => key !== afterKeys[index])) {
      throw new SessionRepairRefused('The rewrite changed the shape of a record.');
    }
    for (const key of beforeKeys) assertOnlyApprovedChanges(before[key], after[key], applied, path === '' ? key : path + '.' + key);
    return;
  }
  throw new SessionRepairRefused('The rewrite changed a value the plan did not approve at ' + (path === '' ? '<root>' : path) + '.');
}

/**
 * Rewrite only the approved identifier fields and recompress only the frames that
 * contain a changed row.
 */
export function rewriteArtifact(scanned: ScannedArtifact, plan: RepairPlan): RewrittenArtifact {
  const rewritten = new Map<number, string>();
  const appliedByLine = new Map<number, Map<string, AppliedChange>>();
  for (const [bodyIndex, mapping] of plan.lineRenames) {
    // Body index 0 is the first row, which is physical line 1.
    const physical = bodyIndex + 1;
    const line = scanned.lines[physical];
    if (line === undefined) throw new SessionRepairRefused('A planned change addresses a line the artifact does not have.');
    let row: unknown;
    try { row = JSON.parse(line); }
    catch { throw new SessionRepairRefused('A planned change addresses a line that is not valid JSON.'); }
    const applied = rewriteIdentifiers(row, mapping);
    if (applied.size === 0) throw new SessionRepairRefused('A planned change addresses a line that no longer references the identifier.');
    rewritten.set(physical, JSON.stringify(row));
    appliedByLine.set(bodyIndex, applied);
  }
  const touchedFrames = new Set([...rewritten.keys()].map(line => scanned.lineFrames[line]!));
  const frameLineCounts = new Map<number, number>();
  for (const owner of scanned.lineFrames) frameLineCounts.set(owner, (frameLineCounts.get(owner) ?? 0) + 1);
  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const [frameIndex, frame] of scanned.frames.entries()) {
    const count = frameLineCounts.get(frameIndex) ?? 0;
    if (touchedFrames.has(frameIndex)) {
      const lines: string[] = [];
      for (let index = cursor; index < cursor + count; index += 1) lines.push(rewritten.get(index) ?? scanned.lines[index]!);
      pieces.push(encodeFrame(lines.join('\n') + '\n'));
    } else {
      pieces.push(scanned.bytes.subarray(frame.start, frame.end));
    }
    cursor += count;
  }
  const bytes = Buffer.concat(pieces);
  const after = scanArtifact(bytes);
  if (after.lines.length !== scanned.lines.length) throw new SessionRepairRefused('The rewritten log changed its record count.');
  const changed: number[] = [];
  for (let index = 0; index < scanned.rows.length; index += 1) {
    const before = scanned.rows[index];
    const next = after.rows[index];
    if (JSON.stringify(before) === JSON.stringify(next)) continue;
    changed.push(index);
    const applied = appliedByLine.get(index);
    if (applied === undefined) throw new SessionRepairRefused('The rewritten log changed a record the repair did not plan.');
    assertOnlyApprovedChanges(before, next, applied);
  }
  if (changed.length !== appliedByLine.size || changed.some(index => !appliedByLine.has(index))) {
    throw new SessionRepairRefused('The rewritten log changed records other than the planned ones.');
  }
  const seen = new Set<string>();
  for (const row of after.rows) {
    const id = dispatchStartId(row);
    if (id === undefined) continue;
    if (seen.has(id)) throw new SessionRepairRefused('The rewritten log still repeats a PTC dispatch identifier.');
    seen.add(id);
  }
  return { bytes, rows: after.rows, changedLines: changed.map(index => index + 2) };
}

/** What the repair needs from the host; every entry is injected so the pipeline stays testable. */
export interface SessionRepairPorts {
  /** Whether this host already has the Session live in memory. */
  live(sessionId: string): boolean;
  /** The artifact path and revision, read from metadata only. */
  location(sessionId: string): Promise<SessionArtifactLocation | undefined>;
  readArtifact(path: string): Promise<Buffer>;
  /** Write the candidate beside the artifact and return the path it was staged at. */
  stageArtifact(path: string, bytes: Buffer): Promise<string>;
  /** Atomically move a staged candidate onto the artifact. */
  replaceArtifact(staging: string, path: string): Promise<void>;
  /** Discard a staged candidate that was never moved. */
  discardArtifact(staging: string): Promise<void>;
  /** Keep the original bytes outside the sessions tree and return the path it was kept at. */
  keepBackup(sessionId: string, location: SessionArtifactLocation, bytes: Buffer, at: Date): Promise<string>;
  /** Re-observe the conversation through the running host; it throws when the log is still unreadable. */
  observe(sessionId: string): Promise<void>;
  /** Run the installed loader's own validation chain over the rewritten artifact. */
  validate(header: unknown, rows: readonly unknown[]): void | Promise<void>;
  now(): Date;
}

/**
 * Repair the one corruption class the product can rewrite safely: a repeated PTC
 * dispatch identifier. The original is preserved, the rewritten artifact is validated
 * before anything is written, and the swap re-checks the target as late as it can.
 */
export class SessionRepair {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly ports: SessionRepairPorts) {}

  /**
   * Repair one conversation's stored log.
   * Attempts on the same Session are serialized: two concurrent repairs would read the
   * same revision, and the second would replace the first one's result.
   */
  repair(sessionId: string): Promise<SessionRepairResult> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.run(sessionId));
    this.queues.set(sessionId, run);
    return run.finally(() => { if (this.queues.get(sessionId) === run) this.queues.delete(sessionId); });
  }

  /**
   * One serialized repair attempt.
   * Every check that can change between two awaits is repeated as close to the write as
   * the pipeline can place it: the final revision and liveness reads happen after the
   * backup and the staging write, with only synchronous work before the rename.
   */
  private async run(sessionId: string): Promise<SessionRepairResult> {
    if (this.ports.live(sessionId)) throw new SessionRepairRefused('The conversation is open in this host. Close it before repairing the stored log.');
    const location = await this.ports.location(sessionId);
    if (location === undefined) throw new SessionRepairRefused('This conversation has no stored log to repair.');
    const original = await this.ports.readArtifact(location.path);
    const scanned = scanArtifact(original);
    const plan = planRepair(scanned.rows);
    if (plan.renames.length === 0) throw new SessionRepairRefused('The stored log has no repeated PTC dispatch identifier; nothing to repair.');
    const rewritten = rewriteArtifact(scanned, plan);
    // The installed loader decides, before anything is written anywhere.
    await this.ports.validate(scanned.header, rewritten.rows);
    const backupPath = await this.ports.keepBackup(sessionId, location, original, this.ports.now());
    const staging = await this.ports.stageArtifact(location.path, rewritten.bytes);
    try {
      // The last awaited read of the target. Everything after it is synchronous up to the
      // rename, so a session that became live or a log that moved is still caught.
      const current = await this.ports.location(sessionId);
      if (current === undefined || current.path !== location.path || current.revision !== location.revision) {
        throw new SessionRepairRefused('The stored log changed while it was being repaired. Nothing was replaced.');
      }
      if (this.ports.live(sessionId)) throw new SessionRepairRefused('The conversation became live while the repair was being prepared. Nothing was replaced.');
      await this.ports.replaceArtifact(staging, location.path);
    } catch (error) {
      await this.ports.discardArtifact(staging).catch(() => undefined);
      throw error;
    }
    try {
      await this.ports.observe(sessionId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The repaired log could not be read.';
      // The original is staged first, so the ownership check below happens after every
      // write this attempt performs: a foreign artifact staged meanwhile is observed and
      // left alone instead of being overwritten by the restore.
      const restore = await this.ports.stageArtifact(location.path, original);
      const present = await this.ports.readArtifact(location.path).catch(() => undefined);
      if (present === undefined || !present.equals(rewritten.bytes)) {
        await this.ports.discardArtifact(restore).catch(() => undefined);
        throw new SessionRepairRefused('The repaired log was still rejected, and the artifact changed again meanwhile, so it was left untouched: ' + reason);
      }
      try {
        await this.ports.replaceArtifact(restore, location.path);
      } catch (restoreError) {
        await this.ports.discardArtifact(restore).catch(() => undefined);
        const failure = restoreError instanceof Error ? restoreError.message : 'the original could not be staged back';
        throw new SessionRepairRefused('The repaired log was still rejected, and the original could not be restored: ' + failure);
      }
      throw new SessionRepairRefused('The repaired log was still rejected, so the original was restored: ' + reason);
    }
    return { backupPath, renamed: plan.renames.length };
  }
}
