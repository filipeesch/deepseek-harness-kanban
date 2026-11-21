// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64Size, readFileBase64, readFilesBase64 } from '../../src/attachments/bytes.js';

afterEach(() => { vi.unstubAllGlobals(); });

/** A FileReader a test releases by hand, so a read really is in flight. */
function gatedReader() {
  const pending: Array<() => void> = [];
  class GatedFileReader {
    result: string | null = null;
    error: DOMException | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(file: File): void {
      pending.push(() => {
        if (file.name === 'bad.txt') {
          this.error = new DOMException('The requested file could not be read', 'NotReadableError');
          this.onerror?.();
          return;
        }
        this.result = 'data:application/octet-stream;base64,YWJj';
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('FileReader', GatedFileReader);
  return { pending, releaseAt: (index: number) => pending[index]!() };
}

describe('attachment byte helpers', () => {
  it('reads a browser file as its exact bytes', async () => {
    await expect(readFileBase64(new File(['abc'], 'a.txt'))).resolves.toBe('YWJj');
  });

  it('decodes a batch in source order', async () => {
    const reads = await readFilesBase64([new File(['abc'], 'a.txt'), new File(['abcd'], 'b.txt')]);
    expect(reads.map(read => read.file.name)).toEqual(['a.txt', 'b.txt']);
    expect(reads.map(read => read.data)).toEqual(['YWJj', 'YWJjZA==']);
  });

  it('waits for every read before reporting the one that failed', async () => {
    const reader = gatedReader();
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    const batch = readFilesBase64([new File(['abc'], 'good.txt'), new File(['abc'], 'bad.txt')])
      .then(value => { settled = 'resolved'; return value; }, error => { settled = 'rejected'; throw error; });
    // The readable file settles first; the batch must still wait for the unreadable one.
    reader.releaseAt(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe('pending');
    reader.releaseAt(1);
    await expect(batch).rejects.toThrow('The file "bad.txt" could not be read.');
    expect(settled).toBe('rejected');
  });

  it('names the file and keeps the browser reason as the cause', async () => {
    const reader = gatedReader();
    const batch = readFilesBase64([new File(['abc'], 'bad.txt')]);
    reader.releaseAt(0);
    const failure = await batch.catch(error => error as Error);
    expect(failure.message).toBe('The file "bad.txt" could not be read.');
    expect((failure.cause as DOMException).name).toBe('NotReadableError');
  });

  it('reports the base64 length of a stored payload', () => {
    expect(base64Size('YWJj')).toBe(3);
    expect(base64Size('YWJjZA==')).toBe(4);
    expect(base64Size('')).toBe(0);
  });
});
