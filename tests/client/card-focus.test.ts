// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cardFocusTarget } from '../../src/client/card-focus.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('card focus target', () => {
  it('finds the board card activation control', () => {
    document.body.innerHTML = '<div data-task-id="t1"><button class="kb-card-open">Open</button></div>';
    expect(cardFocusTarget('t1')?.className).toBe('kb-card-open');
  });

  it('uses a card that is itself the activation control', () => {
    document.body.innerHTML = '<button data-task-id="t2" class="kb-card">Task</button>';
    expect(cardFocusTarget('t2')?.getAttribute('data-task-id')).toBe('t2');
  });

  it('returns null once the card is gone', () => {
    document.body.innerHTML = '<div data-task-id="other"></div>';
    expect(cardFocusTarget('t1')).toBeNull();
  });
});
