import { describe, expect, it } from 'vitest';
import { BoundedCapture, STDERR_LIMIT, STDOUT_LIMIT } from '../../src/host/deterministic/guard/capture.js';
import { parseGuardConfig } from '../../src/host/deterministic/guard/config.js';
import { createGuardOwnership, guardOwnershipSupported } from '../../src/host/deterministic/guard/ownership.js';
import { matches, proof } from '../../src/host/deterministic/guard/proof.js';
import { createWindowsOwnership, WINDOWS_UNSUPPORTED } from '../../src/host/deterministic/process/windows.js';

const authorization = 'a'.repeat(64);
const marker = 'b'.repeat(32);

describe('guard configuration', () => {
  it('accepts a bash configuration and a watch configuration with its worker pid', () => {
    expect(parseGuardConfig({ port: 4100, authorization, mode: 'bash', marker, scriptPath: '/private/program.sh' })).toMatchObject({ mode: 'bash', scriptPath: '/private/program.sh', marker });
    expect(parseGuardConfig({ port: 4100, authorization, mode: 'watch', marker }, 77)).toMatchObject({ mode: 'watch', parent: 77 });
  });

  it('rejects a configuration the host could not have written', () => {
    const valid = { port: 4100, authorization, mode: 'bash', marker, scriptPath: '/private/program.sh' };
    for (const patch of [{ port: 0 }, { port: 70000 }, { authorization: 'short' }, { marker: 'zz' }, { mode: 'repl' }, { scriptPath: '' }]) {
      expect(() => parseGuardConfig({ ...valid, ...patch })).toThrow(/NATIVE_GUARD_CONFIG_INVALID/);
    }
    expect(() => parseGuardConfig({ port: 4100, authorization, mode: 'watch', marker })).toThrow(/worker pid/);
    expect(() => parseGuardConfig(null)).toThrow(/object/);
  });
});

describe('authenticated proof', () => {
  it('accepts only the proof this channel expects', () => {
    const value = proof(authorization, 'ack:token');
    expect(matches(value, value)).toBe(true);
    expect(matches(value, proof(authorization, 'ack:other'))).toBe(false);
    expect(matches(value, 'short')).toBe(false);
    expect(matches(value, undefined)).toBe(false);
  });
});

describe('bounded capture', () => {
  it('retains bytes only while they fit and still measures the whole stream', () => {
    const capture = new BoundedCapture(4);
    expect(capture.push(Buffer.from('ab'))).toBe(true);
    expect(capture.push(Buffer.from('cde'))).toBe(false);
    expect(capture.bytes).toBe(5);
    expect(capture.text()).toBe('ab');
  });

  it('keeps the documented stream bounds', () => {
    expect(STDOUT_LIMIT).toBe(32000);
    expect(STDERR_LIMIT).toBe(3000);
  });
});

describe('guard ownership selection', () => {
  it('supports only the platforms with a readable ownership proof', () => {
    expect(guardOwnershipSupported('darwin')).toBe(true);
    expect(guardOwnershipSupported('linux')).toBe(true);
    expect(guardOwnershipSupported('win32')).toBe(false);
  });

  it('fails closed on a platform without an enabled primitive, in every mode', async () => {
    await expect(createGuardOwnership({ platform: 'win32', requestSweep: async () => {} }).sweep(marker)).rejects.toThrow(WINDOWS_UNSUPPORTED);
    await expect(createWindowsOwnership().sweep(marker)).rejects.toThrow(/NATIVE_LIFETIME_UNSUPPORTED/);
  });
});
