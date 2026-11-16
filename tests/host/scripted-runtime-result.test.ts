import { describe, expect, it } from 'vitest';
import { ScriptedRuntimeError } from '../../src/host/scripted/ports.js';
import { PROGRAM_OUTPUT_MAX_BYTES, programOutput } from '../../src/host/scripted/runtime-result.js';

function refusalOf(result: unknown): ScriptedRuntimeError {
  try { programOutput(result); } catch (error) { if (error instanceof ScriptedRuntimeError) return error; throw error; }
  throw new Error('the read was expected to be refused');
}

describe('program output reader', () => {
  it('concatenates ordered text without inserting a separator', () => {
    const output = programOutput({ output: [{ type: 'text', text: 'first line\n' }, { type: 'text', text: 'second line' }] });
    expect(output.text).toBe('first line\nsecond line');
    expect(output.contract).toBe('ordered');
  });

  it('inserts no separator between adjacent ordered entries without a line break', () => {
    expect(programOutput({ output: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }).text).toBe('ab');
  });

  it('keeps one line per entry for the earlier per-call contract', () => {
    const output = programOutput({ logs: ['first call', 'second call'] });
    expect(output.text).toBe('first call\nsecond call');
    expect(output.contract).toBe('earlier');
  });

  it('prefers ordered entries when a host publishes both contracts', () => {
    const output = programOutput({ output: [{ type: 'text', text: 'ordered' }], logs: ['earlier'] });
    expect(output.text).toBe('ordered');
    expect(output.contract).toBe('ordered');
  });

  it('counts inspected images in one marker after the emitted text', () => {
    const output = programOutput({ output: [{ type: 'text', text: 'before' }, { type: 'image', attachment: {} }, { type: 'image', attachment: {} }] });
    expect(output.text).toBe('before\n[2 images output omitted]');
  });

  it('reports the marker alone when a program emitted no text', () => {
    expect(programOutput({ output: [{ type: 'image', attachment: {} }] }).text).toBe('[1 image output omitted]');
  });

  it('reads an empty ordered result as empty output', () => {
    expect(programOutput({ output: [], value: { exit: 'passed', message: 'ok' } })).toMatchObject({ text: '', contract: 'ordered' });
  });

  it('refuses a result that publishes neither contract and names the observed keys', () => {
    const refusal = refusalOf({ value: {}, images: [] });
    expect(refusal.code).toBe('TYPESCRIPT_RESULT_UNSUPPORTED');
    expect(refusal.detail?.origin).toBe('configuration');
    expect(refusal.detail).toMatchObject({ keys: ['value', 'images'], output: 'undefined', logs: 'undefined' });
    // The delivered message names the shape too, because History shows the message.
    expect(refusal.message).toContain('keys: value, images');
    expect(refusal.message).toContain('output: undefined');
  });

  it('refuses a result that is not an object', () => {
    expect(refusalOf('text')).toMatchObject({ code: 'TYPESCRIPT_RESULT_UNSUPPORTED', detail: { value: 'string' } });
    expect(refusalOf(null)).toMatchObject({ code: 'TYPESCRIPT_RESULT_UNSUPPORTED', detail: { value: 'object' } });
  });

  it('names the observed value when the result is not an object', () => {
    expect(refusalOf('text').message).toContain('value: string');
    expect(refusalOf(null).message).toContain('value: object');
  });

  it('refuses an ordered entry that is neither text nor an image', () => {
    expect(refusalOf({ output: [{ type: 'text', text: 'ok' }, { type: 'audio' }] })).toMatchObject({ code: 'TYPESCRIPT_RESULT_UNSUPPORTED', detail: { entries: ['text', 'audio'] } });
    expect(refusalOf({ output: [{ type: 'text' }] })).toMatchObject({ code: 'TYPESCRIPT_RESULT_UNSUPPORTED' });
  });

  it('refuses a per-call entry that is not text', () => {
    expect(refusalOf({ logs: ['ok', 7] })).toMatchObject({ code: 'TYPESCRIPT_RESULT_UNSUPPORTED', detail: { entries: ['string', 'number'] } });
  });

  it('bounds the captured output', () => {
    expect(() => programOutput({ output: [{ type: 'text', text: 'x'.repeat(PROGRAM_OUTPUT_MAX_BYTES + 1) }] }))
      .toThrowError(expect.objectContaining({ code: 'OUTPUT_LIMIT' }));
  });

  it('converts an unreadable read into the same named refusal', () => {
    const hostile = { get output(): unknown { throw new Error('boom'); } };
    const refusal = refusalOf(hostile);
    expect(refusal.code).toBe('TYPESCRIPT_RESULT_UNSUPPORTED');
    expect(refusal.message).toContain('boom');
    expect(refusal.detail).toMatchObject({ origin: 'configuration', output: 'unreadable' });
  });
});
