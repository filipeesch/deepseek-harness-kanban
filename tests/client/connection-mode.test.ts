import { describe, expect, it } from 'vitest';
import { ABSENT_MODE, conditionEditingAllowed, connectionMode, editable, marksPresented, selectsOnFocus } from '../../src/client/workflow-view/connection-mode.js';

describe('connection mode', () => {
  it('projects the layout lock onto one mode', () => {
    expect(connectionMode(true)).toBe('inspect');
    expect(connectionMode(false)).toBe('edit');
  });

  it('treats an absent surface as a reading surface', () => {
    expect(ABSENT_MODE).toBe('inspect');
  });

  it('lets only the editable mode change a connection', () => {
    expect(editable('edit')).toBe(true);
    expect(editable('inspect')).toBe(false);
    expect(conditionEditingAllowed('edit')).toBe(true);
    expect(conditionEditingAllowed('inspect')).toBe(false);
  });

  it('presents marks only while editing, and only on the pointed-at or selected connection', () => {
    expect(marksPresented('edit', { hovered: true, selected: false })).toBe(true);
    expect(marksPresented('edit', { hovered: false, selected: true })).toBe(true);
    expect(marksPresented('edit', { hovered: false, selected: false })).toBe(false);
    expect(marksPresented('inspect', { hovered: true, selected: false })).toBe(false);
    expect(marksPresented('inspect', { hovered: false, selected: true })).toBe(false);
    expect(marksPresented('inspect', { hovered: false, selected: false })).toBe(false);
    expect(marksPresented('inspect', { hovered: true, selected: true })).toBe(false);
  });

  it('selects from keyboard focus only while inspecting', () => {
    expect(selectsOnFocus('inspect')).toBe(true);
    expect(selectsOnFocus('edit')).toBe(false);
  });
});
