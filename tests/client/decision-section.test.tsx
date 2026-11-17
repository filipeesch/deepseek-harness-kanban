// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DecisionSection } from '../../src/client/stage/decision-section.js';
import { decisionDraft, newDecisionOption, type DecisionDraft } from '../../src/client/stage/decision-draft.js';
import type { Column } from '../../src/shared/types.js';

afterEach(cleanup);

const choices: Column[] = [{ id: 'review', name: 'Review' }, { id: 'done', name: 'Done' }];
const gate = decisionDraft({ question: 'Proceed?', options: [{ id: 'ship', title: 'Ship', to: 'done' }] });

function Editor() {
  const [draft, setDraft] = useState<DecisionDraft>(gate);
  return <DecisionSection draft={draft} choices={choices} problem={() => undefined} disabled={false} onChange={setDraft} />;
}

describe('decision editor options', () => {
  it('keeps keyboard focus while the id is edited', () => {
    render(<Editor />);
    const id = screen.getByRole('textbox', { name: 'Option 1 id' }) as HTMLInputElement;
    id.focus();
    fireEvent.change(id, { target: { value: 'renamed' } });
    const after = screen.getByRole('textbox', { name: 'Option 1 id' }) as HTMLInputElement;
    expect(after.value).toBe('renamed');
    expect(document.activeElement).toBe(after);
  });

  it('allocates an unused default id after a removal', () => {
    const two = [newDecisionOption([], 'done'), newDecisionOption([{ ...newDecisionOption([], 'done'), id: 'option-1' }], 'done')];
    expect(two.map(option => option.id)).toEqual(['option-1', 'option-2']);
    const remaining = [two[0]!];
    const added = newDecisionOption(remaining, 'done');
    expect(added.id).toBe('option-2');
    expect(new Set([...remaining, added].map(option => option.id)).size).toBe(2);
  });
});
