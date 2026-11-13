import { describe, expect, it } from 'vitest';
import { CARD_PRESENCE_PRIORITY, projectCardDominance, type CardPresenceFacts } from '../../src/domain/card-presence.js';

const quiet: CardPresenceFacts = { running: false, unread: false, awaitingReply: false, failed: false };
const facts = (overrides: Partial<CardPresenceFacts> = {}): CardPresenceFacts => ({ ...quiet, ...overrides });

describe('card dominance', () => {
  it('presents each state when it is the only one', () => {
    expect(projectCardDominance(facts({ failed: true }))).toBe('error');
    expect(projectCardDominance(facts({ approval: true }))).toBe('approval');
    expect(projectCardDominance(facts({ awaitingReply: true }))).toBe('attention');
    expect(projectCardDominance(facts({ running: true }))).toBe('running');
    expect(projectCardDominance(facts({ unread: true }))).toBe('unread');
  });

  it('presents nothing while the card is quiet', () => {
    expect(projectCardDominance(quiet)).toBe('none');
  });

  it('orders every state by the fixed priority', () => {
    expect(CARD_PRESENCE_PRIORITY).toEqual(['error', 'approval', 'attention', 'running', 'unread']);
    expect(projectCardDominance(facts({ failed: true, approval: true, awaitingReply: true, running: true, unread: true }))).toBe('error');
    expect(projectCardDominance(facts({ approval: true, awaitingReply: true, running: true, unread: true }))).toBe('approval');
    expect(projectCardDominance(facts({ awaitingReply: true, running: true, unread: true }))).toBe('attention');
    expect(projectCardDominance(facts({ running: true, unread: true }))).toBe('running');
    expect(projectCardDominance(facts({ unread: true }))).toBe('unread');
  });

  it('never lets execution hide a failure', () => {
    expect(projectCardDominance(facts({ running: true, failed: true }))).toBe('error');
  });
});
