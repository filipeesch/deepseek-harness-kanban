import { KanbanError } from '../../../shared/errors.js';

/**
 * The browser's file transfer surface, behind one port.
 *
 * The dialogs hand a download or ask for a file through this interface, so a
 * test supplies a fake instead of reaching global `URL`, `Blob`, or
 * `FileReader`. This follows the same rule as the folder picker: a host
 * capability the client cannot assume is a port, not a direct call.
 */
export interface WorkflowFilePort {
  /** Offer one document for download under the given name. */
  download(input: { readonly fileName: string; readonly bytes: Uint8Array }): void;
  /** Ask the person for one file, resolving null when they cancel. */
  choose(): Promise<{ readonly fileName: string; readonly bytes: Uint8Array } | null>;
}

/** The MIME type a compressed transfer document carries. */
export const TRANSFER_MEDIA_TYPE = 'application/gzip';

/** The largest document the import surface accepts, refused before a byte is read. */
export const TRANSFER_MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;

/**
 * The real browser adapter.
 *
 * A Blob URL plus a synthetic anchor is the only download a web page can offer
 * without a server route, and a hidden file input is the only file selection.
 * Both are created, used, and released here so no caller touches a DOM global.
 */
export function createBrowserFilePort(): WorkflowFilePort {
  return {
    download(input) {
      const blob = new Blob([new Uint8Array(input.bytes).slice().buffer], { type: TRANSFER_MEDIA_TYPE });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = input.fileName;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        // The download reads the URL asynchronously, so the release waits one turn.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
    async choose() {
      const file = await pickFile();
      if (file === null) return null;
      // The size is checked before the bytes are read, so an oversized choice costs a
      // stat and one message instead of an allocation the host would then refuse.
      if (file.size > TRANSFER_MAX_COMPRESSED_BYTES) {
        throw new KanbanError('TRANSFER_TOO_LARGE', 'The chosen file is ' + describeSize(file.size) + ', larger than the ' + describeSize(TRANSFER_MAX_COMPRESSED_BYTES) + ' a workflow export may occupy.', { size: file.size, limit: TRANSFER_MAX_COMPRESSED_BYTES });
      }
      return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
  };
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gz,.json,' + TRANSFER_MEDIA_TYPE + ',application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    // A cancelled selection fires no change event in every browser, so the
    // element reports the cancellation through its own cancel event when it has one.
    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
    document.body.appendChild(input);
    try { input.click(); }
    catch (error) { input.remove(); reject(new KanbanError('TRANSFER_FILE_PICKER_FAILED', 'This browser could not open a file chooser.', { cause: error instanceof Error ? error.message : String(error) })); }
  });
}

/** A byte count as a person reads it; the import copy uses the same shape as the host. */
export function describeSize(bytes: number): string {
  if (bytes < 1024) return String(bytes) + ' bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** One byte array as the base64 text the protocol carries. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // A spread of the whole array overflows the argument limit on a large document,
  // so the bytes are folded in bounded blocks.
  const block = 8192;
  for (let index = 0; index < bytes.length; index += block) binary += String.fromCharCode(...bytes.subarray(index, index + block));
  return btoa(binary);
}

/** Base64 text back into the bytes a download carries. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
