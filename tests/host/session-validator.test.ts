import { describe, expect, it } from 'vitest';
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog';
import { createInstalledSessionValidator, validateSessionArtifact } from '../../src/host/session-validator.js';
import { SessionRepairRefused } from '../../src/host/session-repair.js';

const header = { version: 4 as const, id: 's1', createdAt: 0, isSeeded: false, delegationDepth: 0 };
const physicalHeader = () => sessionFormatCatalog.encodeCurrentHeader(header, 0);
const encode = (events: readonly unknown[]) => events.map(event => sessionFormatCatalog.encodeCurrentEvent(event as never));

describe('session artifact validation', () => {
  it('accepts a current artifact', async () => {
    const rows = encode([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'turn/end', seq: 1, time: 0, data: { turn: 1, reason: { kind: 'ok' } } },
    ]);
    await expect(validateSessionArtifact(physicalHeader(), rows)).resolves.toBeUndefined();
  });

  it('refuses the corrupt artifact the repair exists for', async () => {
    const rows = encode([
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'tool/ptc-dispatch-start', seq: 1, time: 0, data: { subCallId: 'root:ptc:1', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: {} } },
      { type: 'tool/ptc-dispatch', seq: 2, time: 0, data: { subCallId: 'root:ptc:1', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: {}, isError: false, content: [] } },
      { type: 'tool/ptc-dispatch-start', seq: 3, time: 0, data: { subCallId: 'root:ptc:1', rootCallId: 'root', parentCallId: 'root', name: 'bash', arguments: {} } },
      { type: 'turn/end', seq: 4, time: 0, data: { turn: 1, reason: { kind: 'ok' } } },
    ]);
    await expect(validateSessionArtifact(physicalHeader(), rows)).rejects.toThrow(/PTC dispatch repeats subCallId/);
  });

  it('refuses the repair instead of accepting a rewrite when the installed chain is unavailable', async () => {
    const validator = createInstalledSessionValidator(async () => { throw new Error('packages missing'); });
    await expect(validator({}, [])).rejects.toBeInstanceOf(SessionRepairRefused);
    await expect(validator({}, [])).rejects.toThrow(/validator is unavailable on this host/);
  });
});
