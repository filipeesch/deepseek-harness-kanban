import { describe, expect, it } from 'vitest';
import { decodeBoardLog, encodeBoardLog, headToken } from '../../src/domain/journal/log.js';
import { MemoryLayoutStore } from '../support/memory-layout-store.js';
import { contractLog, describeLayoutStoreContract } from '../support/layout-store-contract.js';

const AT = '2026-01-01T00:00:00.000Z';

describeLayoutStoreContract(
  'memory layout store',
  () => new MemoryLayoutStore({ version: 4, logs: { delivery: contractLog() } }),
  () => new MemoryLayoutStore({ version: 4 }),
);

describe('published layout storage fixtures', () => {
  it('returns null before anything is published', async () => {
    const store = new MemoryLayoutStore();
    expect(await store.readStamp()).toBeNull();
    expect(await store.readLog('delivery')).toBeNull();
    expect(await store.listLogs()).toEqual([]);
  });

  it('refuses an append to a board that has no log', async () => {
    const store = new MemoryLayoutStore({ version: 4 });
    await expect(store.appendChanges('delivery', [], { expectedHead: null, message: 'm', at: AT })).rejects.toThrow(expect.objectContaining({ code: 'SHARING_BOARD_LOG_MISSING' }));
  });

  it('round-trips a stored board log with the same head', () => {
    const log = contractLog();
    const decoded = decodeBoardLog(encodeBoardLog(log));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(headToken(decoded.log)).toBe(headToken(log));
  });

  it('writes one event per line', () => {
    const encoded = encodeBoardLog(contractLog());
    const lines = encoded.split(String.fromCharCode(10)).filter(line => line.length > 0);
    expect(lines).toHaveLength(contractLog().length);
    for (const line of lines) expect(JSON.parse(line)).toHaveProperty('kind');
  });
});
