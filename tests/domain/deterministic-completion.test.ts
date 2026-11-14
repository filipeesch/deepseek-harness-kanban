import { describe, expect, it } from 'vitest';
import { validateCompletion } from '../../src/domain/deterministic-completion.js';

describe('deterministic completion contract', () => {
  it('accepts exit and message without params', () => {
    expect(validateCompletion({ exit: 'passed', message: 'CI passed.' })).toEqual({ ok: true, completion: { exit: 'passed', message: 'CI passed.' } });
  });
  it('accepts a bounded params map and drops an empty one', () => {
    expect(validateCompletion({ exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', commit: 'abc123' } })).toEqual({
      ok: true,
      completion: { exit: 'passed', message: 'ok', params: { pipeline: 'ci-main', commit: 'abc123' } },
    });
    expect(validateCompletion({ exit: 'passed', message: 'ok', params: {} })).toEqual({ ok: true, completion: { exit: 'passed', message: 'ok' } });
  });
  it.each([
    [undefined, /object/],
    [null, /object/],
    [[], /object/],
    [{}, /only/],
    [{ exit: '', message: 'x' }, /exit/],
    [{ exit: 'bad exit', message: 'x' }, /exit/],
    [{ exit: 'passed', message: '' }, /message/],
    [{ exit: 'passed', message: '   ' }, /message/],
    [{ exit: 'passed', message: 'x', extra: true }, /only/],
    [{ exit: 'passed', message: 'x', params: null }, /params/],
    [{ exit: 'passed', message: 'x', params: [] }, /params/],
    [{ exit: 'passed', message: 'x', params: { 'bad name': 'x' } }, /safe identifier/],
    [{ exit: 'passed', message: 'x', params: { pipeline: '' } }, /nonempty/],
    [{ exit: 'passed', message: 'x', params: { pipeline: 7 } }, /nonempty/],
    [{ exit: 'passed', message: 'x', params: { pipeline: 'a'.repeat(4097) } }, /exceeds/],
  ])('rejects a nonconforming completion (%#)', (value, message) => {
    const result = validateCompletion(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_COMPLETION');
      expect(result.message).toMatch(message);
    }
  });
  it('accepts a completion exactly at the 32 KiB bound and rejects one byte more', () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ exit: 'passed', message: '' })).length;
    const exact = { exit: 'passed', message: 'x'.repeat(32 * 1024 - overhead) };
    expect(validateCompletion(exact)).toMatchObject({ ok: true });
    expect(validateCompletion({ ...exact, message: exact.message + 'x' })).toMatchObject({ ok: false, code: 'INVALID_COMPLETION' });
  });
  it('rejects an unserializable value and a map that pushes the document past the bound', () => {
    const circular: Record<string, unknown> = { exit: 'passed', message: 'x' };
    circular.self = circular;
    expect(validateCompletion(circular)).toMatchObject({ ok: false, code: 'INVALID_COMPLETION' });
    const names = Array.from({ length: 9 }, (_, index) => 'p' + index);
    const params = Object.fromEntries(names.map(name => [name, 'x'.repeat(4096)]));
    expect(validateCompletion({ exit: 'passed', message: 'x', params })).toMatchObject({ ok: false, code: 'INVALID_COMPLETION' });
  });
});
