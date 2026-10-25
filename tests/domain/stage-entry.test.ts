import { describe, expect, it } from 'vitest';
import { entryInstruction, hasUnresolvedEntry, nextEnteredAt } from '../../src/domain/stage-entry.js';
import type { Task } from '../../src/shared/types.js';

const task = (instructionPending?: Task['instructionPending']): Pick<Task, 'columnId' | 'instructionPending'> => ({ columnId: 'review', ...(instructionPending ? { instructionPending } : {}) });

describe('stage entry policy', () => {
  it('preserves raw instruction bytes and rejects empty or whitespace-only text', () => {
    expect(entryInstruction({ onEnterPrompt: '    Keep indentation.\n\nPlan exactly.\n' })).toBe('    Keep indentation.\n\nPlan exactly.\n');
    expect(entryInstruction({ onEnterPrompt: '   ' })).toBeUndefined();
    expect(entryInstruction({ onEnterPrompt: '' })).toBeUndefined();
    expect(entryInstruction({})).toBeUndefined();
    expect(entryInstruction(undefined)).toBeUndefined();
  });

  it('keeps entry identities strictly increasing even in one clock tick', () => {
    const first = nextEnteredAt(10_000);
    const second = nextEnteredAt(10_000);
    const third = nextEnteredAt(5_000);
    expect(second).toBe(first + 1);
    expect(third).toBeGreaterThan(second);
  });

  it('treats only the matching persisted marker as unresolved', () => {
    expect(hasUnresolvedEntry(task({ columnId: 'review', enteredAt: 10 }))).toBe(true);
    expect(hasUnresolvedEntry(task({ columnId: 'review', enteredAt: 10 }), 'review')).toBe(true);
    expect(hasUnresolvedEntry(task({ columnId: 'plan', enteredAt: 10 }), 'review')).toBe(false);
    expect(hasUnresolvedEntry(task())).toBe(false);
  });
});
