// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../../src/client/ui.js';

afterEach(cleanup);
describe('editor-aware modal focus', () => {
  it('includes contenteditable in the tab order and respects handled Escape keys', () => {
    const onClose = vi.fn();
    render(<Modal title="Editor" onClose={onClose}>
      <div contentEditable suppressContentEditableWarning aria-label="Code surface">value</div>
      <button type="button">Last action</button>
    </Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    const surface = screen.getByLabelText('Code surface');
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Editor' }));
    surface.focus();
    surface.addEventListener('keydown', event => { if (event.key === 'Escape') event.preventDefault(); });
    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
