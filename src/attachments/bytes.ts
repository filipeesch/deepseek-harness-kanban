/**
 * Byte-size text for one attachment, in the one place every surface reads it.
 *
 * @param bytes - exact stored length.
 * @returns human-readable size, at most one decimal place.
 */
export function attachmentSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * The exact byte length one canonical base64 payload decodes to, so a token shows
 * the size of the file the person picked without decoding it again.
 *
 * @param data - canonical base64 text.
 * @returns the decoded length in bytes.
 */
export function base64Size(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * Read one browser file as canonical base64. The refusal names the file, so a person
 * who picked several knows which one the surface is holding them on.
 *
 * @param file - the file the person picked or pasted.
 * @returns the exact bytes, base64-encoded.
 */
export function readFileBase64(file: File): Promise<string> {
  const refusal = 'The file "' + file.name + '" could not be read.';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // The refusal always names the file and keeps the browser's own reason as its cause,
    // so a batch of several files still tells the person which one to look at.
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const separator = url.indexOf(',');
      if (separator < 0) { reject(new Error(refusal, { cause: reader.error ?? undefined })); return; }
      resolve(url.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error(refusal, { cause: reader.error ?? undefined }));
    reader.readAsDataURL(file);
  });
}

/** One picked file with the exact bytes it carries. */
export interface ReadAttachmentFile {
  readonly file: File;
  /** Exact bytes, base64-encoded. */
  readonly data: string;
}

/**
 * Read every file of one selection before anything is stored.
 *
 * A selection is all-or-nothing, so this waits for every read to settle and only then
 * reports the first file that could not be read: a partially read batch never looks
 * finished, and no read keeps running past the point the surface reacts to the failure.
 *
 * @param files - the picked files, in source order.
 * @returns each file with its exact bytes, in the same order.
 */
export async function readFilesBase64(files: readonly File[]): Promise<ReadAttachmentFile[]> {
  const settled = await Promise.allSettled(files.map(async file => ({ file, data: await readFileBase64(file) })));
  const reads: ReadAttachmentFile[] = [];
  for (const entry of settled) {
    if (entry.status === 'rejected') throw entry.reason;
    reads.push(entry.value);
  }
  return reads;
}
