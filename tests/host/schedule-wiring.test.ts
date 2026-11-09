import { describe, expect, it } from 'vitest';
import { call, choice, result } from '../questions/fixtures.js';
import { fixture } from './helpers.js';

describe('schedule host wiring', () => {
  it('exposes the question-aware facts used by scheduled archiving', async () => {
    const harnessed = await fixture();
    const sessionId = await harnessed.sessions.create(harnessed.projectPath);
    harnessed.app.questions.apply(sessionId, call(1, 1, 'call-1'));
    harnessed.app.questions.apply(sessionId, result(2, 1, 'call-1', choice));
    const facts = await harnessed.app.conversationFacts(sessionId);
    expect(facts.pending.kinds).toContain('decision-question');
    expect(harnessed.app.questions.pending(sessionId)).toBe(true);
    await harnessed.close();
  });

  it('reports plain facts for a conversation without plugin questions', async () => {
    const harnessed = await fixture();
    const sessionId = await harnessed.sessions.create(harnessed.projectPath);
    const facts = await harnessed.app.conversationFacts(sessionId);
    expect(facts.pending.kinds).not.toContain('decision-question');
    await harnessed.close();
  });
});
