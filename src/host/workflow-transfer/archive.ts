import { gzipSync, gunzipSync } from 'node:zlib';
import { KanbanError } from '../../shared/errors.js';
import {
  TRANSFER_MAX_COMPRESSED_BYTES,
  TRANSFER_MAX_PAYLOAD_BYTES,
  parseTransferDocument,
  serializeTransferDocument,
  type TransferDocument,
} from '../../domain/workflow-transfer/document.js';

/**
 * The archive layer of the transfer format: gzip in, gzip out, and the one place
 * a size limit is enforced.
 *
 * This module is the only part of the feature that reaches `node:zlib`, so the
 * client bundle never imports it: a download receives the exact bytes an export
 * produced and an upload sends the exact bytes the person chose.
 */

/**
 * Refuse a document above the accepted compressed size.
 *
 * The check runs before anything reads the content, so an oversized choice costs
 * a stat and one message instead of a decompression the host must then undo.
 */
export function assertAcceptedSize(size: number): void {
  if (!Number.isFinite(size) || size < 0) throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'The chosen file reports no readable size.');
  if (size === 0) throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'The chosen file is empty.');
  if (size > TRANSFER_MAX_COMPRESSED_BYTES) {
    throw new KanbanError('TRANSFER_TOO_LARGE', 'The chosen file is ' + describeSize(size) + ', larger than the ' + describeSize(TRANSFER_MAX_COMPRESSED_BYTES) + ' a workflow export may occupy.', {
      size, limit: TRANSFER_MAX_COMPRESSED_BYTES,
    });
  }
}

/** A byte count as a person reads it. */
export function describeSize(bytes: number): string {
  if (bytes < 1024) return String(bytes) + ' bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Compress one document into the bytes a download carries.
 *
 * The compression level and the absence of a stored timestamp are what make two
 * exports of the same Hub state identical byte for byte; `gzipSync` writes no
 * modification time, which a streaming writer with a default clock would.
 */
export function encodeTransferDocument(document: TransferDocument): Buffer {
  const payload = Buffer.from(serializeTransferDocument(document), 'utf8');
  if (payload.byteLength > TRANSFER_MAX_PAYLOAD_BYTES) {
    throw new KanbanError('TRANSFER_TOO_LARGE', 'The exported document exceeds the ' + describeSize(TRANSFER_MAX_PAYLOAD_BYTES) + ' an import can read back.', { size: payload.byteLength, limit: TRANSFER_MAX_PAYLOAD_BYTES });
  }
  return gzipSync(payload, { level: 9 });
}

/**
 * Read one compressed document back into its parsed form.
 *
 * Decompression is bounded: a payload that expands past the accepted size is
 * refused rather than held in memory, so a small file cannot become a large one.
 * Each failure names one condition, because the person can only act on one.
 */
export function decodeTransferDocument(bytes: Uint8Array): TransferDocument {
  const compressed = Buffer.from(bytes);
  assertAcceptedSize(compressed.byteLength);
  let payload: string;
  try { payload = gunzipSync(compressed, { maxOutputLength: TRANSFER_MAX_PAYLOAD_BYTES }).toString('utf8'); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const tooLarge = code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE';
    throw new KanbanError(
      tooLarge ? 'TRANSFER_TOO_LARGE' : 'TRANSFER_NOT_COMPRESSED',
      tooLarge
        ? 'The document expands past the ' + describeSize(TRANSFER_MAX_PAYLOAD_BYTES) + ' an import can read.'
        : 'The chosen file is not a gzip-compressed workflow export.',
      tooLarge ? { limit: TRANSFER_MAX_PAYLOAD_BYTES } : {},
    );
  }
  let parsed: unknown;
  try { parsed = JSON.parse(payload) as unknown; }
  catch { throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'The document is not valid JSON.'); }
  return parseTransferDocument(parsed);
}

/** The file name one export suggests, which names the Hub and nothing machine-specific. */
export function suggestedFileName(hubName: string, now: Date): string {
  const slug = hubName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'hub';
  const stamp = now.toISOString().slice(0, 10);
  return 'kanban-workflows-' + slug + '-' + stamp + '.json.gz';
}
