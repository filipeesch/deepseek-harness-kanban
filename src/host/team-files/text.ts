import path from 'node:path';
import { KanbanError } from '../../shared/errors.js';

/**
 * Formats a team file cannot hold as editable text. The extension list is a
 * cheap pre-check; the decoder is the authority.
 */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'avif',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'wasm', 'o', 'a', 'lib',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'webm',
  'sqlite', 'sqlite3', 'db', 'pyc', 'pkl', 'dat', 'parquet', 'xlsx', 'docx', 'pptx',
]);

/** Bytes inspected for a NUL when deciding whether a file is text. */
const NUL_SCAN_BYTES = 8192;

function binary(relative: string, reason: string, details: Record<string, unknown> = {}): KanbanError {
  return new KanbanError('TEAM_FILE_BINARY', 'The team file "' + relative + '" is not UTF-8 text (' + reason + '). Only text files are supported.', { path: relative, reason, ...details });
}

/** Whether a path names a binary format by extension. */
export function isBinaryPath(relative: string): boolean {
  const extension = path.extname(relative).slice(1).toLocaleLowerCase();
  return extension.length > 0 && BINARY_EXTENSIONS.has(extension);
}

/** Refuse a path whose extension names a binary format, before reading a byte. */
export function assertTextPath(relative: string): void {
  if (!isBinaryPath(relative)) return;
  throw binary(relative, 'the ".' + path.extname(relative).slice(1).toLocaleLowerCase() + '" extension names a binary format');
}

/**
 * Decode a team file as UTF-8 text, refusing anything that is not. A byte order
 * mark is preserved in the decoded text, so an edit round-trips the file's
 * bytes instead of silently dropping them.
 */
export function decodeTeamFileText(bytes: Uint8Array, relative: string): string {
  const scan = bytes.subarray(0, Math.min(bytes.length, NUL_SCAN_BYTES));
  if (scan.includes(0)) throw binary(relative, 'it contains a NUL byte');
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw binary(relative, 'it is not valid UTF-8'); }
  return decoded;
}

/**
 * Refuse content a later read would classify as binary. JavaScript strings are
 * UTF-16, so content that does not survive a UTF-8 round trip would be written
 * as replacement characters, and a NUL would make the result unreadable.
 */
export function assertTextContent(content: string, relative: string): void {
  if (content.includes('\u0000')) throw binary(relative, 'the supplied content contains a NUL byte');
  if (Buffer.from(content, 'utf8').toString('utf8') !== content) {
    throw new KanbanError('INVALID_INPUT', 'The supplied content is not valid Unicode text.', { path: relative });
  }
}
