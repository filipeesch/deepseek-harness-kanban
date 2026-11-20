// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fromBase64, toBase64 } from '../../src/client/settings/boards/transfer-files.js';
import { fakeFilePort } from './transfer-support.js';

describe('transfer file port', () => {
  it('base64 round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('base64 handles a document larger than one argument spread', () => {
    const bytes = new Uint8Array(40_000);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    expect(fromBase64(toBase64(bytes)).length).toBe(40_000);
    expect(fromBase64(toBase64(bytes))[4]).toBe(4);
  });
});

describe('fake file port', () => {
  it('records a download and answers a choose', async () => {
    const port = fakeFilePort({ chosen: { fileName: 'doc.json.gz', bytes: new Uint8Array([1]) } });
    port.download({ fileName: 'out.json.gz', bytes: new Uint8Array([2]) });
    expect(port.downloads.map(entry => entry.fileName)).toEqual(['out.json.gz']);
    expect(await port.choose()).toEqual({ fileName: 'doc.json.gz', bytes: new Uint8Array([1]) });
    expect(port.chooseCalls).toBe(1);
  });

  it('reports a cancelled selection as null', async () => {
    expect(await fakeFilePort().choose()).toBeNull();
  });
});

describe('client file selection', () => {
  it('refuses an oversized file before reading its bytes', async () => {
    const { createBrowserFilePort, TRANSFER_MAX_COMPRESSED_BYTES } = await import('../../src/client/settings/boards/transfer-files.js');
    const port = createBrowserFilePort();
    // A file double that reports its size without exposing readable bytes: an
    // implementation that read first would fail with a different error.
    const oversized = { name: 'big.json.gz', size: TRANSFER_MAX_COMPRESSED_BYTES + 1, arrayBuffer: async () => { throw new Error('the oversized file must not be read'); } };
    const original = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = original(tag);
      if (tag === 'input') {
        Object.defineProperty(element, 'files', { value: [oversized], configurable: true });
        Object.defineProperty(element, 'click', { value: () => { element.dispatchEvent(new Event('change')); }, configurable: true });
      }
      return element;
    });
    try {
      await expect(port.choose()).rejects.toMatchObject({ code: 'TRANSFER_TOO_LARGE' });
    } finally { spy.mockRestore(); }
  });
});

