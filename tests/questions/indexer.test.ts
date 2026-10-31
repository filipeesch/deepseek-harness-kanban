import { describe, expect, it, vi } from 'vitest';
import { QuestionIndex } from '../../src/questions/index.js';
import { call, choice, end, free, human, multi, ptcResult, ptcStart, result, runtime } from './fixtures.js';

function data(event: ReturnType<typeof result>) { return event.data as Record<string, unknown>; }

describe('QuestionIndex canonical events', () => {
  it('keeps incremental native pages open until the actual matching turn/end', () => {
    const index = new QuestionIndex();
    index.apply('a', call(1, 7, 'first'));
    index.apply('a', result(2, 7, 'first'));
    expect(index.pending('a')).toBe(true);
    expect(index.getRounds('a')[0]).toMatchObject({ turnId: '7', complete: false, answered: false });
    index.apply('a', { type: 'step/end', seq: 3, data: { turn: 7, step: 0 } });
    index.apply('a', { type: 'turn/start', seq: 4, data: { turn: 8 } });
    index.apply('a', end(5, 8));
    expect(index.getRounds('a')[0]!.complete).toBe(false);
    index.apply('a', call(6, 7, 'second'));
    index.apply('a', result(7, 7, 'second', free));
    expect(index.getRounds('a')[0]!.pages).toHaveLength(2);
    index.apply('a', end(8, 7));
    expect(index.getRounds('a')[0]!.complete).toBe(true);
  });

  it('orders by actual invocation, deduplicates replay and accepts out-of-order windows', () => {
    const index = new QuestionIndex();
    index.apply('a', result(6, 1, 'two', free));
    index.apply('a', result(5, 1, 'one'));
    index.apply('a', call(2, 1, 'two'));
    index.apply('a', call(1, 1, 'one'));
    const round = index.getRounds('a')[0]!;
    expect(round.pages.map(page => page.callId)).toEqual(['one', 'two']);
    expect(round.pages.map(page => page.sequence)).toEqual([1, 2]);
    expect(index.apply('a', result(5, 1, 'one'))).toBe(false);
    index.apply('a', result(7, 1, 'one', multi));
    expect(index.getRounds('a')[0]!.pages).toHaveLength(2);
    expect(index.getRounds('a')[0]!.pages[0]!.page.type).toBe('exclusive');
  });

  it('uses native toolCallId and successful versioned presentation metadata, not arguments or content', () => {
    const index = new QuestionIndex();
    const good = result(2, 3, 'one');
    const wrongVersion = { ...good, seq: 3, data: { ...data(good), meta: { kind: 'kanban.question-page', version: 2, page: choice } } };
    const wrongKind = { ...good, seq: 4, data: { ...data(good), meta: { kind: 'other', version: 1, page: choice } } };
    const failed = { ...good, seq: 5, data: { ...data(good), message: { ...(data(good).message as object), isError: true } } };
    const mismatch = { ...good, seq: 6, data: { ...data(good), message: { ...(data(good).message as object), source: { kind: 'tool', callId: 'wrong' } } } };
    for (const event of [wrongVersion, wrongKind, failed, mismatch, { type: 'tool/result', seq: 7, data: { turn: 3, message: { toolCallId: 'fake', content: JSON.stringify(data(good).meta) } } }]) expect(index.apply('a', event)).toBe(false);
    index.apply('a', good);
    expect(index.getRounds('a')[0]!.pages[0]!.callId).toBe('one');
  });

  it('defers PTC metadata without a native root and resolves nested dispatch ownership after replay', () => {
    const index = new QuestionIndex();
    index.apply('a', ptcStart(3, 'root', 'nested:ptc:1', 'nested'));
    index.apply('a', ptcResult(4, 'root', 'nested:ptc:1', choice, 'nested'));
    index.apply('a', end(5, 12));
    expect(index.getRounds('a')).toEqual([]);
    index.apply('a', call(1, 12, 'root', 'run_code'));
    expect(index.getRounds('a')[0]).toMatchObject({ turnId: '12', complete: true });
    expect(index.getRounds('a')[0]!.pages[0]).toMatchObject({ callId: 'nested:ptc:1', sequence: 3 });
  });

  it('orders PTC pages by dispatch starts and ignores failed or mismatched settlements', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 4, 'root', 'run_code'), ptcStart(2, 'root', 'one'), ptcStart(3, 'root', 'two'), ptcResult(4, 'root', 'two', free), ptcResult(5, 'root', 'one')]) index.apply('a', event);
    expect(index.getRounds('a')[0]!.pages.map(page => page.callId)).toEqual(['one', 'two']);
    const failed = ptcResult(6, 'root', 'three');
    index.apply('a', { ...failed, data: { ...(failed.data as object), isError: true } });
    index.apply('a', ptcStart(7, 'other-root', 'four'));
    index.apply('a', ptcResult(8, 'root', 'four'));
    expect(index.getRounds('a')[0]!.pages).toHaveLength(2);
  });

  it('does not attach a PTC settlement to a root whose turn already ended', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 1, 'root', 'run_code'), end(2, 1), ptcResult(4, 'root', 'late')]) index.apply('a', event);
    expect(index.getRounds()).toEqual([]);
  });

  it('retires only on a later genuine human message in the same session', () => {
    const index = new QuestionIndex();
    for (const event of [human(0), call(1, 2, 'one'), result(2, 2, 'one'), end(3, 2), runtime(4)]) index.apply('a', event);
    index.apply('b', human(5));
    expect(index.pending('a')).toBe(true);
    expect(index.getRounds('a')[0]!.answered).toBe(false);
    index.apply('a', human(6));
    expect(index.pending('a')).toBe(false);
    expect(index.getRounds('a')[0]!.answered).toBe(true);
    index.apply('a', call(7, 3, 'next'));
    index.apply('a', result(8, 3, 'next', free));
    expect(index.getRounds('a').map(round => round.answered)).toEqual([true, false]);
    expect(index.pending()).toBe(true);
  });

  it('does not resurrect a dismissed round when a normal reply precedes later streamed pages', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 2, 'one'), result(2, 2, 'one'), human(3)]) index.apply('a', event);
    expect(index.pending('a')).toBe(false);
    index.apply('a', call(4, 2, 'two'));
    index.apply('a', result(5, 2, 'two', free));
    expect(index.getRounds('a')[0]).toMatchObject({ answered: true, complete: false });
    expect(index.pending('a')).toBe(false);
    expect(new QuestionIndex(index.serialize()).pending('a')).toBe(false);
  });

  it('serializes only projection data and reconstructs open/complete/answered rounds after reload', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 1, 'root', 'run_code'), ptcStart(2, 'root', 'q'), ptcResult(3, 'root', 'q')]) index.apply('a', event);
    const open = new QuestionIndex(JSON.parse(JSON.stringify(index.serialize())));
    expect(open.getRounds('a')[0]!.complete).toBe(false);
    open.apply('a', end(4, 1));
    open.apply('a', runtime(5));
    expect(new QuestionIndex(open.serialize()).pending('a')).toBe(true);
    open.apply('a', human(6));
    const restored = new QuestionIndex(open.serialize());
    expect(restored.getRounds('a')[0]).toMatchObject({ complete: true, answered: true });
    expect(restored.pending('a')).toBe(false);
    expect(JSON.stringify(restored.serialize())).not.toContain('Runtime context changed');
    expect(JSON.stringify(restored.serialize())).not.toContain('I prefer a normal text reply');
  });

  it('does not infer completion from incomplete windows, serialized flags, or another turn', () => {
    const index = new QuestionIndex();
    index.apply('a', result(9, 7, 'q'));
    const snapshot = index.serialize();
    Object.assign(snapshot, { complete: true, openTurn: undefined });
    const restored = new QuestionIndex(snapshot);
    restored.apply('a', end(10, 8));
    expect(restored.getRounds('a')[0]!.complete).toBe(false);
    restored.apply('a', end(11, 7));
    expect(restored.getRounds('a')[0]!.complete).toBe(true);
  });

  it('keeps snapshots stable, notifies subscribers, loads atomically, and disposes without side effects', () => {
    const index = new QuestionIndex();
    const listener = vi.fn();
    const stop = index.subscribe(listener);
    expect(index.getRounds('unknown')).toBe(index.getRounds('unknown'));
    index.apply('a', result(1, 0, 'q'));
    const snapshot = index.getRounds('a');
    expect(index.getRounds('a')).toBe(snapshot);
    expect(Object.isFrozen(snapshot[0]!.pages[0]!.page.options)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => index.load({ version: 99, sessions: [] })).toThrow();
    expect(index.getRounds('a')).toBe(snapshot);
    stop();
    index.apply('a', end(2, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    index.dispose();
    expect(index.pending()).toBe(false);
    expect(index.getRounds()).toEqual([]);
    expect(index.apply('a', result(3, 1, 'q'))).toBe(false);
  });

  it('dismisses a round, filters it from pending, and keeps it dismissed across restore', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 2, 'one'), result(2, 2, 'one'), end(3, 2), call(4, 3, 'two'), result(5, 3, 'two')]) index.apply('a', event);
    const first = index.getRounds('a')[0]!;
    expect(index.dismiss('a', [first.id])).toBe(1);
    expect(index.getRounds('a').map(round => round.turnId)).toEqual(['3']);
    expect(index.pending('a')).toBe(true);
    const record = index.serializeSession('a')!;
    expect(record.dismissedTurns).toEqual([2]);
    expect(record.events.some(event => event.kind === 'native-page' && event.turn === 2)).toBe(false);
    expect(record.events.some(event => event.kind === 'call' && event.turn === 2)).toBe(true);
    expect(record.events.some(event => event.kind === 'end' && event.turn === 2)).toBe(true);
    const restored = new QuestionIndex();
    restored.restoreSession(record);
    expect(restored.getRounds('a').map(round => round.turnId)).toEqual(['3']);
    expect(restored.pending('a')).toBe(true);
    expect(new QuestionIndex(index.serialize()).getRounds('a').map(round => round.turnId)).toEqual(['3']);
  });

  it('dismisses every unresolved round without touching another conversation', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 1, 'a'), result(2, 1, 'a'), end(3, 1), call(4, 2, 'b'), result(5, 2, 'b'), end(6, 2)]) index.apply('one', event);
    index.apply('two', call(7, 1, 'c'));
    index.apply('two', result(8, 1, 'c'));
    expect(index.dismiss('one', index.getRounds('one').map(round => round.id))).toBe(2);
    expect(index.getRounds('one')).toEqual([]);
    expect(index.pending('one')).toBe(false);
    expect(index.getRounds('two')).toHaveLength(1);
    expect(index.pending('two')).toBe(true);
  });

  it('does not resurrect a dismissed turn when late pages arrive', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 4, 'first'), result(2, 4, 'first'), end(3, 4)]) index.apply('a', event);
    index.dismiss('a', [index.getRounds('a')[0]!.id]);
    index.apply('a', call(4, 4, 'late'));
    index.apply('a', result(5, 4, 'late', free));
    expect(index.getRounds('a')).toEqual([]);
    expect(index.pending('a')).toBe(false);
    expect(index.serializeSession('a')!.events.some(event => event.kind === 'native-page' && event.callId === 'late')).toBe(false);
  });

  it('prunes PTC pages by their owning root turn but keeps the surviving projection evidence', () => {
    const index = new QuestionIndex();
    for (const event of [call(1, 9, 'root', 'run_code'), ptcStart(2, 'root', 'nested'), ptcResult(3, 'root', 'nested'), end(4, 9)]) index.apply('a', event);
    index.dismiss('a', [index.getRounds('a')[0]!.id]);
    const record = index.serializeSession('a')!;
    expect(record.events.some(event => event.kind === 'ptc-page')).toBe(false);
    expect(record.events.some(event => event.kind === 'call' && event.callId === 'root')).toBe(true);
    expect(record.events.some(event => event.kind === 'ptc-start')).toBe(true);
    expect(record.events.some(event => event.kind === 'end' && event.turn === 9)).toBe(true);
    expect(record.dismissedTurns).toEqual([9]);
  });

  it('advances a per-session revision only for that conversation', () => {
    const index = new QuestionIndex();
    expect(index.revisionOf('a')).toBe(0);
    index.apply('b', result(1, 0, 'q'));
    expect(index.revisionOf('a')).toBe(0);
    expect(index.revisionOf('b')).toBe(1);
    index.apply('a', result(2, 0, 'q'));
    expect(index.revisionOf('a')).toBe(1);
    expect(index.apply('a', result(2, 0, 'q'))).toBe(false);
    expect(index.revisionOf('a')).toBe(1);
    index.dismiss('a', [index.getRounds('a')[0]!.id]);
    expect(index.revisionOf('a')).toBe(2);
    index.undismiss('a', [0]);
    expect(index.revisionOf('a')).toBe(3);
    expect(index.revisionOf('b')).toBe(1);
    index.load(index.serialize());
    expect(index.revisionOf('a')).toBe(1);
    expect(index.revisionOf('b')).toBe(1);
  });

  it('keeps an unresolvable PTC page while the dismissal marker hides its round', () => {
    const index = new QuestionIndex();
    index.apply('a', ptcStart(1, 'root', 'nested'));
    index.apply('a', ptcResult(2, 'root', 'nested'));
    index.dismiss('a', ['question-round:a:1']);
    const record = index.serializeSession('a')!;
    expect(record.dismissedTurns).toEqual([1]);
    expect(record.events.some(event => event.kind === 'ptc-page')).toBe(true);
  });
});
