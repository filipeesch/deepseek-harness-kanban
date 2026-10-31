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
  const cache = new QuestionRoundCache({ feed, dismissal });
  return { cache, feeds, dismissal, opens: () => opens };
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

  it('dismisses every unresolved round in the conversation and keeps other rounds', async () => {
    const { cache, feeds, dismissal } = harness();
    cache.track('a');
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2'), round('b:1', 'b')] });
    dismissal.dismiss.mockResolvedValueOnce([]);
    await cache.dismiss('a', 'a:2');
    expect(dismissal.dismiss).toHaveBeenCalledWith('a', 'a:2');
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['b:1']);
    // A later baseline for the dismissed conversation must not resurrect it.
    feeds.get('a')!.frame({ kind: 'baseline', rounds: [round('a:1'), round('a:2')] });
    expect(cache.view.getSnapshot().rounds.map(value => value.id)).toEqual(['b:1']);
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

  it('ignores a submission for a round the cache does not know', () => {
    const { cache } = harness();
    cache.submit('missing');
    expect(cache.isSubmitted('missing')).toBe(false);
    expect(cache.focusedRoundId).toBeUndefined();
  });
});
