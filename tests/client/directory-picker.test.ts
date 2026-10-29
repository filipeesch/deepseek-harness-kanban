import { describe, expect, it, vi } from 'vitest';
import { createDirectoryPicker } from '../../src/client/directory-picker.js';

function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  return run().then(() => undefined, error => (error as { code?: string }).code);
}

describe('directory picker source selection', () => {
  it('prefers the desktop picker when both sources exist', async () => {
    const desktop = vi.fn(async () => '/desktop/path');
    const host = vi.fn(async () => '/host/path');
    await expect(createDirectoryPicker({ desktop, host }).pick()).resolves.toBe('/desktop/path');
    expect(host).not.toHaveBeenCalled();
  });

  it('falls back to the host picker when the desktop source is absent', async () => {
    const host = vi.fn(async () => '/host/path');
    await expect(createDirectoryPicker({ host }).pick()).resolves.toBe('/host/path');
  });

  it('passes a cancellation through as null', async () => {
    await expect(createDirectoryPicker({ desktop: async () => null }).pick()).resolves.toBeNull();
  });

  it('reports an unavailable picker as a typed problem', async () => {
    await expect(codeOf(() => createDirectoryPicker({}).pick())).resolves.toBe('DIRECTORY_PICKER_UNAVAILABLE');
  });

  it('reports a failing picker as a typed problem and keeps its cause', async () => {
    const picker = createDirectoryPicker({ desktop: async () => { throw new Error('panel crashed'); } });
    await expect(picker.pick()).rejects.toMatchObject({ code: 'DIRECTORY_PICKER_FAILED', details: { cause: 'panel crashed' } });
  });
});
