import { describe, expect, it } from 'vitest';
import { createBoardLog, decodeBoardLog, encodeBoardLog, headToken } from '../../src/domain/journal/log.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import { CONTRACT_WORKFLOW, contractManifest, describeLayoutStoreContract, storedBoardLog } from '../support/layout-store-contract.js';

const AT = '2026-01-01T00:00:00.000Z';

describeLayoutStoreContract(
  'memory layout store',
  () => new MemoryLayoutStore({ manifest: contractManifest(), logs: { delivery: CONTRACT_WORKFLOW } }),
  () => new MemoryLayoutStore({ manifest: contractManifest() }),
);

describe('published layout storage contract fixtures', () => {
  it('returns null before anything is published', async () => {
    const store = new MemoryLayoutStore();
    expect(await store.readManifest()).toBeNull();
    expect(await store.readLog('delivery')).toBeNull();
  });

  it('refuses an append to a board that has no log', async () => {
    const store = new MemoryLayoutStore({ manifest: contractManifest() });
    await expect(store.appendChanges('delivery', [], { expectedHead: null, message: 'm', at: AT })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_BOARD_LOG_MISSING' }));
  });

  it('round-trips a stored board log with the same head', () => {
    const decoded = decodeBoardLog(JSON.parse(storedBoardLog(CONTRACT_WORKFLOW)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(headToken(decoded.log)).toBe(headToken(createBoardLog(CONTRACT_WORKFLOW)));
  });

  it('keeps the encoded log stable', () => {
    const encoded = encodeBoardLog(createBoardLog(CONTRACT_WORKFLOW));
    expect(Object.keys(encoded)).toEqual(['version', 'snapshot', 'events']);
  });
});
