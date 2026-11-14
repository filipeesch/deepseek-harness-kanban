import { describe, expect, it } from 'vitest';
import { bindHandoffParameterValues, boundedRedactedParameters, declaredParameterNames, declaredParameterValues, missingParameterNames, parameterValuesProblem, validateParameterValues } from '../../src/domain/deterministic-parameters.js';

describe('deterministic parameter values', () => {
  it('accepts exactly the declared names and returns them in declaration order', () => {
    expect(validateParameterValues(['pipeline', 'app'], { app: 'checkout', pipeline: 'ci-main' })).toEqual({ ok: true, values: { pipeline: 'ci-main', app: 'checkout' } });
  });
  it('accepts an empty set for a declaration with no parameters', () => {
    expect(validateParameterValues([], {})).toEqual({ ok: true, values: {} });
    expect(validateParameterValues([], undefined)).toEqual({ ok: false, message: expect.stringContaining('declares no parameters') });
  });
  it.each([
    [undefined, /Missing required parameter/],
    [{}, /Missing required parameter/],
    [{ app: 'checkout' }, /Missing required parameter: pipeline/],
    [{ pipeline: 'ci', app: 'checkout', extra: 'x' }, /Undeclared parameter: extra/],
    [{ pipeline: '', app: 'checkout' }, /Missing required parameter: pipeline/],
    [{ pipeline: 7, app: 'checkout' }, /Missing required parameter: pipeline/],
    [{ pipeline: 'a'.repeat(4097), app: 'checkout' }, /exceeds 4096 characters/],
  ])('rejects a set that does not match the declaration (%#)', (values, message) => {
    const result = validateParameterValues(['pipeline', 'app'], values as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
  it('rejects a value set whose total exceeds the accepted size', () => {
    const names = Array.from({ length: 9 }, (_, index) => 'p' + index);
    const values = Object.fromEntries(names.map(name => [name, 'x'.repeat(4096)]));
    const result = validateParameterValues(names, values);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/exceed 32768 bytes/);
  });
  it('reports the declared names, the stored values, and the missing names', () => {
    const declaration = [{ name: 'pipeline', description: 'CI workflow' }, { name: 'app' }];
    expect(declaredParameterNames(declaration)).toEqual(['pipeline', 'app']);
    expect(declaredParameterValues(['pipeline', 'app'], { pipeline: 'ci', extra: 'ignored' })).toEqual({ pipeline: 'ci' });
    expect(missingParameterNames(['pipeline', 'app'], { pipeline: 'ci' })).toEqual(['app']);
    expect(missingParameterNames(['pipeline'], { pipeline: '' })).toEqual(['pipeline']);
  });
  it('validates one durable value set independently of a declaration', () => {
    expect(parameterValuesProblem({ pipeline: 'ci' })).toBeNull();
    expect(parameterValuesProblem({ 'bad name': 'x' })).toMatch(/safe identifier/);
    expect(parameterValuesProblem({ pipeline: '' })).toMatch(/nonempty/);
    expect(parameterValuesProblem(Object.fromEntries(Array.from({ length: 33 }, (_, index) => ['p' + index, 'x'])))).toMatch(/At most 32/);
  });
  it('binds sent values by exact name and reports missing declared names', () => {
    expect(bindHandoffParameterValues(['pipeline', 'app'], { pipeline: 'ci', app: 'checkout' })).toEqual({ ok: true, values: { pipeline: 'ci', app: 'checkout' }, missing: [] });
    expect(bindHandoffParameterValues(['pipeline', 'app'], { pipeline: 'ci' })).toEqual({ ok: true, values: { pipeline: 'ci' }, missing: ['app'] });
    expect(bindHandoffParameterValues(['pipeline'], { pipeline: 'ci', extra: 'ignored' })).toEqual({ ok: true, values: { pipeline: 'ci' }, missing: [] });
    expect(bindHandoffParameterValues(['pipeline'], { sourceName: 'ci' })).toEqual({ ok: true, values: {}, missing: ['pipeline'] });
    expect(bindHandoffParameterValues([], { pipeline: 'ci' })).toEqual({ ok: true, values: {}, missing: [] });
    expect(bindHandoffParameterValues(['pipeline'], undefined)).toEqual({ ok: true, values: {}, missing: ['pipeline'] });
  });
  it('drops a redacted set that no longer fits the durable total', () => {
    const values = Object.fromEntries(Array.from({ length: 8 }, (_, index) => ['p' + index, 'x'.repeat(4096)]));
    expect(boundedRedactedParameters(values)).toBeUndefined();
    expect(boundedRedactedParameters({ pipeline: 'ci' })).toEqual({ pipeline: 'ci' });
    expect(boundedRedactedParameters(undefined)).toBeUndefined();
  });

  it('rechecks the value-set bounds before binding', () => {
    expect(bindHandoffParameterValues(['pipeline'], { pipeline: 'x'.repeat(4096) })).toMatchObject({ ok: true });
    expect(bindHandoffParameterValues(['pipeline'], { pipeline: 'x'.repeat(4097) })).toMatchObject({ ok: false, message: expect.stringMatching(/exceeds 4096/) });
    expect(bindHandoffParameterValues(['pipeline'], { 'bad name': 'x' })).toMatchObject({ ok: false, message: expect.stringMatching(/safe identifier/) });
  });
});
