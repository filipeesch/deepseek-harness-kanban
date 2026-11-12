import { describe, expect, it } from 'vitest';
import type { FailureDetail, GuardFacts } from '../../src/shared/deterministic-failure.js';
import { classifyFailureCode, DEFAULT_FAILURE_ORIGIN, FAILURE_DETAIL_MAX_BYTES, failureDetail, failureDetailValues, neverRoutes } from '../../src/domain/deterministic-failure.js';
import { failureMessage, providerFailureMessage, sanitizeFailureText } from '../../src/domain/deterministic-failure-message.js';
import { redactExact, redactRecord } from '../../src/shared/redact.js';
import { utf8Length } from '../../src/shared/bounded.js';
import { settleFailureRoute } from '../../src/domain/deterministic-failure-settlement.js';

const facts: GuardFacts = { admission: 'not-admitted', exitCode: 125, signal: null, timedOut: false, aborted: false, elapsedMs: 12, stdoutBytes: 0, stdoutHead: '', stderrBytes: 0, stderrTail: '' };
const detail: FailureDetail = {
  origin: 'infrastructure',
  cause: { code: 'TYPESCRIPT_EXCEPTION', message: 'Error: the guard left no result' },
  guard: facts,
  attempts: [{ attempt: 1, code: 'BASH_PROTOCOL', guard: facts }, { attempt: 2, code: 'BASH_PROTOCOL', guard: { ...facts, elapsedMs: 30 } }],
};
const stack = 'Error: The isolated Bash guard did not return a valid result.\n    at bindingFailure (/Users/someone/ptc-runtime-node/src/bootstrap.ts:246:61)\n    at async sh (/Users/someone/work/wait.ts:4:3)';

describe('deterministic failure detail codec', () => {
  it('round-trips a complete detail map and rejects a record without an origin', () => {
    expect(failureDetail(failureDetailValues(detail))).toEqual(detail);
    expect(failureDetail({})).toBeUndefined();
    expect(failureDetail({ origin: 'not-an-origin' })).toBeUndefined();
    expect(failureDetail(undefined)).toBeUndefined();
  });

  it('drops malformed members instead of failing the whole read', () => {
    const read = failureDetail({ origin: 'infrastructure', cause: { code: 'X' }, guard: { admission: 'nonsense' }, attempts: [{ attempt: 1, code: 'BASH_PROTOCOL' }] });
    expect(read).toEqual({ origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL' }] });
  });

  it('keeps every attempt and its guard facts through the redaction boundary', () => {
    // The supervisor redacts the map before persisting; the client then decodes it.
    // A depth limit that cuts inside an attempt would silently erase the attempt facts.
    const redacted = redactRecord(failureDetailValues(detail), ['synthetic-secret']);
    expect(redacted).toBeDefined();
    expect(failureDetail(redacted)).toEqual(detail);
  });

  it('keeps a nested cause diagnostic and its own detail', () => {
    const layered: FailureDetail = {
      origin: 'infrastructure',
      guard: facts,
      cause: { code: 'BASH_PROTOCOL', message: 'The guard left no result.', details: { origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL', guard: facts }] } },
    };
    expect(failureDetail(failureDetailValues(layered))).toEqual(layered);
  });

  it('redacts a value in its JSON-escaped form as well as its plaintext form', () => {
    const secret = 'synthetic"secret';
    expect(redactExact('the value ' + secret + ' failed', [secret])).toBe('the value [REDACTED] failed');
    const escaped = JSON.stringify({ stderr: secret }).slice(1, -1);
    expect(redactExact(escaped, [secret])).toContain('[REDACTED]');
    expect(redactExact(escaped, [secret])).not.toContain('synthetic');
  });

  it('enforces the detail budget even when a nested cause is oversized', () => {
    const oversized: FailureDetail = { origin: 'infrastructure', guard: facts, cause: { code: 'BASH_PROTOCOL', message: 'boom', details: { blob: 'x'.repeat(200_000) } } };
    const values = failureDetailValues(oversized);
    expect(utf8Length(JSON.stringify(values))).toBeLessThanOrEqual(FAILURE_DETAIL_MAX_BYTES);
    expect(values.origin).toBe('infrastructure');
    expect((values.cause as { details?: unknown } | undefined)?.details).toBeUndefined();
  });

  it('keeps the attempt count when a stored attempt lost its guard facts', () => {
    const stored = { origin: 'infrastructure', attempts: [{ attempt: 1, code: 'BASH_PROTOCOL' }, { attempt: 2, code: 'BASH_PROTOCOL' }] };
    expect(failureDetail(stored)?.attempts).toEqual([{ attempt: 1, code: 'BASH_PROTOCOL' }, { attempt: 2, code: 'BASH_PROTOCOL' }]);
  });

  it('bounds an oversized detail map and every string it carries', () => {
    const oversized: FailureDetail = {
      origin: 'infrastructure',
      guard: { ...facts, stderrTail: 'x'.repeat(200_000), stdoutHead: 'y'.repeat(200_000) },
      attempts: Array.from({ length: 40 }, (_, index) => ({ attempt: index + 1, code: 'BASH_PROTOCOL', guard: facts })),
    };
    const values = failureDetailValues(oversized);
    expect(Buffer.byteLength(JSON.stringify(values))).toBeLessThan(FAILURE_DETAIL_MAX_BYTES);
    const read = failureDetail(values)!;
    expect(read.attempts).toHaveLength(8);
    expect(Buffer.byteLength(read.guard!.stderrTail)).toBeLessThanOrEqual(512 + 32);
    expect(Buffer.byteLength(read.guard!.stdoutHead)).toBeLessThanOrEqual(256 + 32);
    expect(Buffer.byteLength(JSON.stringify(failureDetailValues({ ...oversized, origin: 'infrastructure', attempts: [] })))).toBeLessThan(4096);
  });
});

describe('deterministic failure origin classification', () => {
  it.each([
    ['BASH_PROTOCOL', 'infrastructure'],
    ['OUTPUT_TRANSPORT_LIMIT', 'infrastructure'],
    ['EXECUTOR_FAILED', 'infrastructure'],
    ['OWNERSHIP_UNCERTAIN', 'infrastructure'],
    ['TYPESCRIPT_EXCEPTION', 'script'],
    ['BASH_FAILED', 'script'],
    ['UNMAPPED_EXIT', 'script'],
    ['BASH_ARGUMENTS', 'script'],
    ['INVALID_COMPLETION', 'contract'],
    ['OUTPUT_LIMIT', 'contract'],
    ['TYPESCRIPT_INVALID_OUTPUT', 'contract'],
    ['PARAMETERS_REQUIRED', 'configuration'],
    ['EXECUTION_CONTEXT_CHANGED', 'configuration'],
    ['VARIABLE_MISSING', 'configuration'],
    ['CAPTURE_MISSING', 'configuration'],
    ['POLICY_DENIED', 'configuration'],
    ['BASH_UNAVAILABLE', 'configuration'],
    ['TYPESCRIPT_FORMAT_UNSUPPORTED', 'configuration'],
    ['REDACTION_LIMIT', 'configuration'],
  ] as const)('classifies %s as %s', (code, origin) => {
    expect(classifyFailureCode(code)).toBe(origin);
  });

  it('defaults an unknown code to infrastructure without consulting the prototype', () => {
    expect(classifyFailureCode('SOME_FUTURE_CODE')).toBe(DEFAULT_FAILURE_ORIGIN);
    expect(classifyFailureCode('__proto__')).toBe('infrastructure');
    expect(classifyFailureCode('toString')).toBe('infrastructure');
  });

  it('marks ownership uncertainty as never routed', () => {
    for (const code of ['OWNERSHIP_UNCERTAIN', 'OWNERSHIP_CONFLICT', 'OWNERSHIP_UNAVAILABLE', 'EXECUTION_OWNERSHIP_UNCERTAIN']) expect(neverRoutes(code)).toBe(true);
    expect(neverRoutes('BASH_PROTOCOL')).toBe(false);
  });
});

describe('deterministic failure message', () => {
  it('removes stack frames and local paths from a host failure', () => {
    const sanitized = sanitizeFailureText(stack);
    expect(sanitized).not.toContain('    at ');
    expect(sanitized).not.toContain('/Users/someone');
    expect(sanitized).toContain('did not return a valid result');
    expect(sanitizeFailureText('Cannot open /Users/someone/work/wait.ts for reading.')).toBe('Cannot open [path] for reading.');
    expect(sanitizeFailureText('Cannot open C:\\Users\\someone\\wait.ts for reading.')).toBe('Cannot open [path] for reading.');
    expect(sanitizeFailureText('Cannot open /tmp or /Users now.')).toBe('Cannot open [path] or [path] now.');
    expect(sanitizeFailureText('Cannot open \\\\server\\share\\file.txt now.')).toBe('Cannot open [path] now.');
    // A URL is not a local path and must stay readable.
    expect(sanitizeFailureText('See https://example.test/a/b for details.')).toBe('See https://example.test/a/b for details.');
  });

  it('keeps a program failure in its own words', () => {
    const message = failureMessage({ code: 'TYPESCRIPT_EXCEPTION', origin: 'script', message: stack });
    expect(message).toContain('bindingFailure');
  });

  it('describes a provider failure with a controlled sentence and never with its own text', () => {
    expect(providerFailureMessage('EXECUTOR_FAILED')).toContain('execution provider failed');
    expect(providerFailureMessage('TYPESCRIPT_PROTOCOL')).toContain('invalid result');
    expect(providerFailureMessage('TYPESCRIPT_SANDBOX_UNAVAILABLE')).toContain('file policy');
    expect(providerFailureMessage('TYPESCRIPT_EXCEPTION')).toBeUndefined();
    expect(providerFailureMessage('BASH_PROTOCOL')).toBeUndefined();
    expect(providerFailureMessage('OUTPUT_TRANSPORT_LIMIT')).toContain('transport limit');
  });

  it('summarizes an infrastructure failure with its attempts and where the detail lives', () => {
    const message = failureMessage({ code: 'BASH_PROTOCOL', origin: 'infrastructure', message: stack, details: detail });
    expect(message).toContain('Infrastructure failure');
    expect(message).toContain('2 attempts');
    expect(message).toContain('History');
    expect(message).not.toContain('    at ');
    expect(message).not.toContain('/Users/someone');
  });

  it('names the repair action for a configuration failure and nothing to fix for a rejected completion', () => {
    expect(failureMessage({ code: 'EXECUTION_CONTEXT_CHANGED', origin: 'configuration', message: 'The captured directory changed.' })).toContain('press Play');
    expect(failureMessage({ code: 'INVALID_COMPLETION', origin: 'contract', message: 'Return only exit and message.' })).toContain('completion was rejected');
  });
});

describe('deterministic failure settlement', () => {
  it('prefers the reserved infrastructure destination and falls back to error', () => {
    expect(settleFailureRoute({ code: 'BASH_PROTOCOL', origin: 'infrastructure', exits: ['infrastructure', 'error'] })).toBe('infrastructure');
    expect(settleFailureRoute({ code: 'BASH_PROTOCOL', origin: 'infrastructure', exits: ['error'] })).toBe('error');
    expect(settleFailureRoute({ code: 'BASH_PROTOCOL', origin: 'infrastructure', exits: [] })).toBeNull();
  });

  it('routes a work failure through error and never through infrastructure', () => {
    expect(settleFailureRoute({ code: 'TYPESCRIPT_EXCEPTION', origin: 'script', exits: ['infrastructure', 'error'] })).toBe('error');
    expect(settleFailureRoute({ code: 'INVALID_COMPLETION', origin: 'contract', exits: ['infrastructure'] })).toBeNull();
  });

  it('never routes a configuration failure or an ownership uncertainty', () => {
    expect(settleFailureRoute({ code: 'EXECUTION_CONTEXT_CHANGED', origin: 'configuration', exits: ['infrastructure', 'error'] })).toBeNull();
    expect(settleFailureRoute({ code: 'OWNERSHIP_UNCERTAIN', origin: 'infrastructure', exits: ['infrastructure', 'error'] })).toBeNull();
  });
});
