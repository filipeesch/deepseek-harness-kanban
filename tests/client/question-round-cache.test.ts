import { describe, expect, it, vi } from 'vitest';
import { QuestionRoundCache, type QuestionFeedPort } from '../../src/client/question-round-cache.js';
import type { QuestionFeedFrame, QuestionRound } from '../../src/shared/types.js';

function round(id: string, sessionId = 'a', overrides: Partial<QuestionRound> = {}): QuestionRound {
  return {
    id,
    sessionId,
    turnId: id.split(':').at(-1) ?? '1',
    pages: [{ callId: id + '-call', sequence: 1, page: { type: 'freetext', question: 'Which approach?' } }],
    complete: true,
    answered: false,
    ...overrides,
  };
}

function harness(initialDismissal: readonly QuestionRound[] = []) {
  const feeds = new Map<string, { frame: (frame: QuestionFeedFrame) => void; fail: (error: { code: string; message: string }) => void; close: ReturnType<typeof vi.fn> }>();
  let opens = 0;
  const feed: QuestionFeedPort = {
    open(sessionId, onFrame, onError) {
      opens += 1;
      const close = vi.fn();
      feeds.set(sessionId, { frame: onFrame, fail: onError, close });
      return close;
    },
  };
  const dismissal = { dismiss: vi.fn().mockResolvedValue(initialDismissal) };
  const answerer = { answer: vi.fn().mockResolvedValue([]) };
  const cache = new QuestionRoundCache({ feed, dismissal, answerer });
  return { cache, feeds, dismissal, answerer, opens: () => opens };
}

describe('QuestionRoundCache', () => {
  it('replaces a baseline, applies updates per session, and keeps other conversations intact', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    cache.track('b');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    feeds.get('b')!.frame({ kind: 'baseline', rounds: [round('b:1', 'b')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1', 'b:1']);
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:2')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2', 'b:1']);
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['b:1']);
  });

  it('publishes and clears a per-session feed error, and retry reopens the stream', () => {
    const { cache, feeds, opens } = harness();
    cache.track('a');
    const first = feeds.get('a')!;
    first.fail({ code: 'STREAM_FAILED', message: 'Question feed failed' });
    expect(cache.view.getSnapshot().errors.get('a')).toEqual({ code: 'STREAM_FAILED', message: 'Question feed failed' });
    cache.retry('a');
    expect(opens()).toBe(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(cache.view.getSnapshot().errors.has('a')).toBe(false);
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1']);
  });

  it('ignores a frame from a feed generation that a retry replaced', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    const stale = feeds.get('a')!;
    cache.retry('a');
    const current = feeds.get('a')!;
    stale.frame({ kind: 'baseline', rounds: [round('stale:1')] });
    expect(cache.view.getSnapshot().rounds).toEqual([]);
    current.frame({ kind: 'baseline', rounds: [round('fresh:1')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['fresh:1']);
  });

  it('closes every feed and empties the view on dispose', () => {
    const { cache, feeds } = harness();
    cache.track('a'); cache.track('b');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    cache.dispose();
    expect(feeds.get('a')!.close).toHaveBeenCalledTimes(1);
    expect(feeds.get('b')!.close).toHaveBeenCalledTimes(1);
    expect(cache.view.getSnapshot().rounds).toEqual([]);
    expect(cache.isSubmitted('a:1')).toBe(false);
    cache.track('c');
    expect(feeds.has('c')).toBe(false);
  });

  it('dismisses only the chosen round and keeps every other round in the conversation', async () => {
    const { cache, feeds, dismissal } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2'), round('b:1', 'b')] });
    // The host keeps a:1 and returns it; only a:2 is dismissed.
    dismissal.dismiss.mockResolvedValueOnce([round('a:1')]);
    await cache.dismiss('a', 'a:2');
    expect(dismissal.dismiss).toHaveBeenCalledWith('a', 'a:2');
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1', 'b:1']);
    // A later baseline must not resurrect the dismissed round, and must not lose the
    // round the host kept because of a stale all-rounds tombstone.
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1', 'b:1']);
  });

  it('does not hide unrelated rounds when the host reports the round already settled', async () => {
    const { cache, feeds, dismissal } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    dismissal.dismiss.mockRejectedValueOnce(Object.assign(new Error('Already dismissed'), { code: 'QUESTION_ROUND_NOT_FOUND' }));
    await cache.dismiss('a', 'a:2');
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1']);
  });

  it('suppresses a submitted round across unresolved frames and clears it on confirmation', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    cache.submit('a:1');
    expect(cache.isSubmitted('a:1')).toBe(true);
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:1')] });
    expect(cache.isSubmitted('a:1')).toBe(true);
    feeds.get('a')!.frame({ kind: 'update', rounds: [{ ...round('a:1'), answered: true }] });
    expect(cache.isSubmitted('a:1')).toBe(false);
    expect(cache.focusedRoundId).toBeUndefined();
  });

  it('keeps the round across an absent frame before admission settles, then restores it on rollback', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    cache.submit('a:1');
    feeds.get('a')!.frame({ kind: 'update', rounds: [] });
    expect(cache.isSubmitted('a:1')).toBe(true);
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1']);
    cache.rollback('a:1');
    expect(cache.isSubmitted('a:1')).toBe(false);
    expect(cache.focusedRoundId).toBe('a:1');
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1']);
  });

  it('treats an absent frame after a settled admission as confirmation', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    cache.submit('a:1');
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:2')] });
    expect(cache.isSubmitted('a:1')).toBe(true);
    cache.settle('a:1');
    expect(cache.isSubmitted('a:1')).toBe(false);
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2']);
  });

  it('keeps suppression when the admission settles but the feed still reports the round unresolved', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    cache.submit('a:1');
    cache.settle('a:1');
    expect(cache.isSubmitted('a:1')).toBe(true);
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:1')] });
    expect(cache.isSubmitted('a:1')).toBe(true);
    feeds.get('a')!.frame({ kind: 'update', rounds: [{ ...round('a:1'), answered: true }] });
    expect(cache.isSubmitted('a:1')).toBe(false);
  });

  it('closes a feed only after its last holder releases it', () => {
    const { cache, feeds, opens } = harness();
    const releaseFirst = cache.track('a');
    const releaseSecond = cache.track('a');
    expect(opens()).toBe(1);
    releaseFirst();
    releaseFirst();
    expect(feeds.get('a')!.close).not.toHaveBeenCalled();
    releaseSecond();
    expect(feeds.get('a')!.close).toHaveBeenCalledTimes(1);
    cache.retry('a');
    expect(opens()).toBe(1);
  });

  it('reopens with a new generated stream after retry and ignores the released one', () => {
    const { cache, feeds, opens } = harness();
    const release = cache.track('a');
    const first = feeds.get('a')!;
    cache.retry('a');
    const second = feeds.get('a')!;
    expect(opens()).toBe(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    first.frame({ kind: 'baseline', rounds: [round('stale:1')] });
    expect(cache.view.getSnapshot().rounds).toEqual([]);
    second.frame({ kind: 'baseline', rounds: [round('fresh:1')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['fresh:1']);
    release();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('rolls a failed submission back and focuses it for retry', () => {
    const { cache, feeds } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1')] });
    cache.submit('a:1');
    cache.rollback('a:1');
    expect(cache.isSubmitted('a:1')).toBe(false);
    expect(cache.focusedRoundId).toBe('a:1');
    cache.submit('a:1');
    expect(cache.focusedRoundId).toBeUndefined();
  });

  it('never lets a delayed dismissal acknowledgement overwrite newer rounds or revive an answered target', async () => {
    const { cache, feeds, dismissal, answerer } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2'), round('a:3')] });
    // The dismissal is in flight against the old list.
    let resolveDismissal!: (rounds: QuestionRound[]) => void;
    dismissal.dismiss.mockReturnValueOnce(new Promise<QuestionRound[]>(resolve => { resolveDismissal = resolve; }));
    const dismissing = cache.dismiss('a', 'a:2');
    // The same round is answered meanwhile, and the feed delivers a newer round.
    answerer.answer.mockResolvedValueOnce([]);
    await cache.answer('a', 'a:2');
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:1'), round('a:3'), round('a:4')] });
    // The stale acknowledgement carries the old three-round list, without the new round.
    resolveDismissal([round('a:1'), round('a:2'), round('a:3')]);
    await dismissing;
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:1', 'a:3', 'a:4']);
  });

  it('never lets an answer acknowledgement replace a newer feed frame', async () => {
    const { cache, feeds, answerer } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    answerer.answer.mockResolvedValueOnce([round('a:1'), round('a:2')]);
    const answering = cache.answer('a', 'a:1');
    // The feed moves on while the command is in flight.
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:2'), round('a:3')] });
    await answering;
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2', 'a:3']);
  });

  it('retires only the answered round and keeps the other rounds of the conversation', async () => {
    const { cache, feeds, answerer } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    answerer.answer.mockResolvedValueOnce([{ ...round('a:1'), answered: true }, round('a:2')]);
    const remaining = await cache.answer('a', 'a:1');
    expect(answerer.answer).toHaveBeenCalledWith('a', 'a:1');
    // The answered round leaves the stack locally at once; the other round stays answerable.
    expect(remaining.map(value => value.id)).toEqual(['a:2']);
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2']);
  });

  it('drops a round the host already retired without failing the caller', async () => {
    const { cache, feeds, answerer } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    answerer.answer.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'QUESTION_ROUND_NOT_FOUND' }));
    const remaining = await cache.answer('a', 'a:1');
    expect(remaining.map(value => value.id)).toEqual(['a:2']);
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2']);
  });

  it('never duplicates another session when a stale answer falls back to the local view', async () => {
    const { cache, feeds, answerer } = harness();
    cache.track('a');
    cache.track('b');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    feeds.get('b')!.frame({ kind: 'baseline', rounds: [round('b:1', 'b')] });
    answerer.answer.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'QUESTION_ROUND_NOT_FOUND' }));
    await cache.answer('a', 'a:1');
    expect(cache.view.getSnapshot().rounds.map(value => value.id).sort()).toEqual(['a:2', 'b:1']);
    // A delayed unresolved frame for the answered round must not revive it.
    feeds.get('a')!.frame({ kind: 'update', rounds: [round('a:1'), round('a:2')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id).sort()).toEqual(['a:2', 'b:1']);
  });

  it('keeps unrelated rounds of the same conversation when an answer succeeds', async () => {
    const { cache, feeds, answerer } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    answerer.answer.mockResolvedValueOnce([{ ...round('a:1'), answered: true }, round('a:2')]);
    const remaining = await cache.answer('a', 'a:1');
    expect(remaining.map(value => value.id)).toEqual(['a:2']);
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['a:2']);
  });

  it('ignores a submission for a round the cache does not know', () => {
    const { cache } = harness();
    cache.submit('missing');
    expect(cache.isSubmitted('missing')).toBe(false);
    expect(cache.focusedRoundId).toBeUndefined();
  });
});
