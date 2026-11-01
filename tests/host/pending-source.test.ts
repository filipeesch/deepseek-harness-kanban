import { describe, expect, it } from 'vitest';
import { readPendingUserWork, withQuestionPending } from '../../src/host/pending-source.js';
import { pendingUserWork } from '../../src/domain/pending-user-work.js';
import type { ConversationFacts } from '../../src/shared/types.js';
import { EMPTY_CONVERSATION_FACTS, NO_PENDING_USER_WORK } from '../../src/shared/types.js';

const facts = (overrides: Partial<ConversationFacts> = {}): ConversationFacts => ({ ...EMPTY_CONVERSATION_FACTS, ...overrides });

describe('question pending composition', () => {
  it('adds the decision-question kind to the native pending value', async () => {
    const source = withQuestionPending({ read: async () => facts({ pending: pendingUserWork(['queued-prompt'], 1) }) }, { pending: () => true });
    expect((await source.read('s1')).pending).toEqual({ kinds: ['decision-question', 'queued-prompt'], queuedPrompts: 1 });
  });

  it('leaves the native facts untouched when no round is open, and never mutates the read value', async () => {
    const native = facts({ pending: pendingUserWork(['approval']) });
    const untouched = withQuestionPending({ read: async () => native }, { pending: () => false });
    expect((await untouched.read('s1')).pending).toEqual({ kinds: ['approval'], queuedPrompts: 0 });
    const composed = withQuestionPending({ read: async () => native }, { pending: () => true });
    expect((await composed.read('s1')).pending.kinds).toEqual(['decision-question', 'approval']);
    expect(native.pending.kinds).toEqual(['approval']);
  });

  it('reads the question projection after the native read settles', async () => {
    let pending = false;
    const source = withQuestionPending({
      read: async () => { pending = true; return facts(); },
    }, { pending: () => pending });
    expect(await readPendingUserWork(source, ['s1'])).toEqual({ kinds: ['decision-question'], queuedPrompts: 0 });
  });

  it('merges the task pending value across its conversations', async () => {
    const values = new Map([
      ['s1', facts({ pending: pendingUserWork(['decision-question']) })],
      ['s2', facts({ pending: pendingUserWork(['queued-prompt'], 2) })],
    ]);
    const source = { read: async (sessionId: string) => values.get(sessionId) ?? EMPTY_CONVERSATION_FACTS };
    expect(await readPendingUserWork(source, ['s1', 's2'])).toEqual({ kinds: ['decision-question', 'queued-prompt'], queuedPrompts: 2 });
    expect(await readPendingUserWork(source, [])).toEqual(NO_PENDING_USER_WORK);
  });
});
