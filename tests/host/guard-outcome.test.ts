import { describe, expect, it } from 'vitest';
import type { ShellRunResult } from '@deepseek-ai/dsh-shell';
import { readGuardOutcome } from '../../src/host/deterministic/guard-outcome.js';

const text = { head: (value: string) => value, tail: (value: string) => value };

function result(patch: Partial<ShellRunResult> = {}): ShellRunResult {
  return { exitCode: 125, signal: null, timedOut: false, aborted: false, timeoutMs: 10, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false }, ...patch };
}

describe('guard outcome diagnostics', () => {
  it('carries the guard own reason into the message', () => {
    const outcome = readGuardOutcome(result({ stderr: { text: 'NATIVE_LIFETIME_UNCLEAN: spawnSync ps EPERM\n', truncated: false } }), 10_000, text);
    expect(outcome).toMatchObject({ kind: 'failure', code: 'BASH_PROTOCOL', retryable: false, facts: { admission: 'started' } });
    expect(outcome.kind === 'failure' ? outcome.message : '').toContain('spawnSync ps EPERM');
  });

  it('reports an unreachable guard artifact instead of a protocol failure', () => {
    const outcome = readGuardOutcome(result({ exitCode: 127, stderr: { text: 'sh: node: command not found\n', truncated: false } }), 5, text);
    expect(outcome).toMatchObject({ kind: 'failure', code: 'GUARD_UNAVAILABLE', retryable: false });
  });

  it('keeps an unexplained guard failure retryable only when nothing ran', () => {
    expect(readGuardOutcome(result(), 5, text)).toMatchObject({ kind: 'failure', code: 'BASH_PROTOCOL', retryable: true, facts: { admission: 'not-admitted' } });
    expect(readGuardOutcome(result({ stderr: { text: 'partial output', truncated: false } }), 5, text)).toMatchObject({ kind: 'failure', retryable: false });
  });
});
