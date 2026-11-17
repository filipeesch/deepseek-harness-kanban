import { describe, expect, it, vi } from 'vitest';
import { ConversationObservationIndex, createObservedFactsSource } from '../../src/host/conversation-observation.js';
import { EMPTY_CONVERSATION_FACTS } from '../../src/shared/types.js';
import { MISSING_SESSION_CODE, UNREADABLE_SESSION_CODE } from '../../src/domain/session-observation.js';

const corrupt = () => Object.assign(new Error('stored session "s1" failed validation: PTC dispatch repeats subCallId'), { code: UNREADABLE_SESSION_CODE });

describe('conversation observation index', () => {
  it('records the state and cause of a classified failure', () => {
    const index = new ConversationObservationIndex();
    expect(index.record('s1', corrupt())).toBe(true);
    expect(index.get('s1')).toEqual({ state: 'unreadable', cause: 'stored session "s1" failed validation: PTC dispatch repeats subCallId' });
    expect(index.has('s1')).toBe(true);
  });

  it('ignores an unclassified failure', () => {
    const index = new ConversationObservationIndex();
    expect(index.record('s1', new Error('network down'))).toBe(false);
    expect(index.has('s1')).toBe(false);
  });

  it('does not notify again for the same failure', () => {
    const onChange = vi.fn();
    const index = new ConversationObservationIndex({ onChange });
    index.record('s1', corrupt());
    index.record('s1', corrupt());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('notifies when the recorded state changes', () => {
    const onChange = vi.fn();
    const index = new ConversationObservationIndex({ onChange });
    index.record('s1', { code: MISSING_SESSION_CODE, message: 'no log' });
    index.record('s1', corrupt());
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(index.get('s1')?.state).toBe('unreadable');
  });

  it('clears on recovery and notifies once', () => {
    const onChange = vi.fn();
    const index = new ConversationObservationIndex({ onChange });
    index.record('s1', corrupt());
    expect(index.recover('s1')).toBe(true);
    expect(index.recover('s1')).toBe(false);
    expect(index.has('s1')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('resolves only the listed conversations that failed', () => {
    const index = new ConversationObservationIndex();
    index.record('s1', corrupt());
    index.record('s2', { code: MISSING_SESSION_CODE, message: 'gone' });
    expect(Object.keys(index.resolved(['s1', 's2', 's3']))).toEqual(['s1', 's2']);
    expect(index.all()).toEqual({
      s1: { state: 'unreadable', cause: 'stored session "s1" failed validation: PTC dispatch repeats subCallId' },
      s2: { state: 'missing', cause: 'gone' },
    });
  });

  it('prunes conversations no task refers to', () => {
    const onChange = vi.fn();
    const index = new ConversationObservationIndex({ onChange });
    index.record('s1', corrupt());
    index.record('s2', corrupt());
    onChange.mockClear();
    index.prune(new Set(['s1']));
    expect(index.has('s2')).toBe(false);
    expect(index.has('s1')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a throwing observer from breaking the read', () => {
    const report = vi.fn();
    const index = new ConversationObservationIndex({ onChange: () => { throw new Error('observer failed'); }, report });
    expect(() => index.record('s1', corrupt())).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('observed facts source', () => {
  it('records a classified rejection and still propagates it', async () => {
    const index = new ConversationObservationIndex();
    const source = createObservedFactsSource({ source: { read: async () => { throw corrupt(); } }, index });
    await expect(source.read('s1')).rejects.toThrow('PTC dispatch repeats subCallId');
    expect(index.get('s1')?.state).toBe('unreadable');
  });

  it('records nothing for an unrelated rejection', async () => {
    const index = new ConversationObservationIndex();
    const source = createObservedFactsSource({ source: { read: async () => { throw new Error('projection unavailable'); } }, index });
    await expect(source.read('s1')).rejects.toThrow('projection unavailable');
    expect(index.has('s1')).toBe(false);
  });

  it('clears the record when a later read succeeds', async () => {
    const index = new ConversationObservationIndex();
    index.record('s1', corrupt());
    const source = createObservedFactsSource({ source: { read: async () => EMPTY_CONVERSATION_FACTS }, index });
    await expect(source.read('s1')).resolves.toEqual(EMPTY_CONVERSATION_FACTS);
    expect(index.has('s1')).toBe(false);
  });
});
