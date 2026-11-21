// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DecisionGate, DecisionPanel } from '../../src/client/decision-panel.js';
import { DecisionWindowController } from '../../src/client/decision-window.js';
import type { Column, Task } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const task: Task = { ...fixture().state.tasks[0]!, columnId: 'gate', stageEntry: { id: 'entry-gate', columnId: 'gate', stageIdentity: 'gate', enteredAt: '2026-01-01T00:00:00.000Z' } };
const Gate: Column = { id: 'gate', name: 'Gate', decision: {
  question: 'How should this proceed?',
  context: 'The review left findings.',
  options: [
    { id: 'ship', title: 'Ship it', description: 'Send it to done.', to: 'done' },
    { id: 'fix', title: 'Fix it', to: 'review' },
  ],
} };
const columns: Column[] = [Gate, { id: 'review', name: 'Review' }, { id: 'done', name: 'Done' }];

function setup(column: Column = Gate) {
  const controller = new DecisionWindowController({ run: async () => fixture() });
  const view = render(<DecisionPanel task={task} column={column} columns={columns} controller={controller} />);
  return { ...view, controller };
}

describe('decision gate presentation', () => {
  it('renders the strip with no controller and no board', () => {
    const select = vi.fn(); const confirm = vi.fn();
    const view = render(<DecisionGate
      decision={Gate.decision!}
      selectedId=""
      focusId=""
      note=""
      collapsed={false}
      error={null}
      onToggleCollapsed={() => {}}
      onSelect={select}
      onFocus={() => {}}
      onNote={() => {}}
      onConfirm={confirm}
      onCancel={() => {}}
    />);
    expect(screen.getByRole('heading', { name: 'How should this proceed?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Fix it' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Fix it' }));
    expect(select).toHaveBeenCalledWith('fix');
    expect(confirm).not.toHaveBeenCalled();
    expect(view.container.querySelector('.kb-decision')).toBeTruthy();
  });

  it('carries no stylesheet of its own, so the composer strip sets its width', () => {
    const view = render(<DecisionGate
      decision={Gate.decision!}
      selectedId=""
      focusId=""
      note=""
      collapsed={false}
      error={null}
      onToggleCollapsed={() => {}}
      onSelect={() => {}}
      onFocus={() => {}}
      onNote={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
    />);
    // Only the shared question stylesheet is injected; a second one would be a second geometry.
    expect(view.container.querySelectorAll('style')).toHaveLength(1);
    expect(view.container.innerHTML).not.toContain('.kb-decision{');
  });
});

describe('decision panel', () => {
  it('presents the stage question, context, and options', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'How should this proceed?' })).toBeTruthy();
    expect(screen.getByText('The review left findings.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Ship it' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Fix it' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('arms the window only after selecting and confirming', () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    expect(controller.entryFor(task.id)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor(task.id)).toMatchObject({ taskId: task.id, entryId: 'entry-gate', optionId: 'ship', destinationName: 'Done', status: 'counting' });
    expect(screen.getByText(/Moving to Done in \d+ seconds/)).toBeTruthy();
  });

  it('cancels the window without applying the choice', () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(controller.entryFor(task.id)).toBeUndefined();
    expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('carries the optional observation into the window', () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Fix it' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Observation' }), { target: { value: '  Please fix the copy.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor(task.id)).toMatchObject({ optionId: 'fix', note: 'Please fix the copy.' });
  });

  it('distinguishes options that share a title by their stable identifiers', () => {
    const duplicate: Column = { id: 'gate', name: 'Gate', decision: { question: 'Pick one', options: [
      { id: 'first', title: 'Ship it', to: 'done' },
      { id: 'second', title: 'Ship it', to: 'review' },
    ] } };
    const { controller } = setup(duplicate);
    const radios = screen.getAllByRole('radio', { name: 'Ship it' });
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor(task.id)).toMatchObject({ optionId: 'second', destinationName: 'Review' });
  });

  it('keeps the selection when an option title changes', () => {
    const { controller, rerender } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    const renamed: Column = { ...Gate, decision: { ...Gate.decision!, options: Gate.decision!.options.map(option => option.id === 'ship' ? { ...option, title: 'Send it now' } : option) } };
    rerender(<DecisionPanel task={task} column={renamed} columns={columns} controller={controller} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Send it now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor(task.id)).toMatchObject({ optionId: 'ship', destinationName: 'Done' });
  });

  it('keeps the destination and Cancel visible when the counting gate is collapsed', () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    fireEvent.click(screen.getByRole('button', { name: /Decision needed/ }));
    expect(screen.getByText(/Moving to Done in \d+ seconds\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(controller.entryFor(task.id)).toBeUndefined();
  });

  it('ignores a row click while the window is counting', () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    fireEvent.click(screen.getByText('Fix it'));
    expect((screen.getByRole('radio', { name: 'Ship it' }) as HTMLInputElement).checked).toBe(true);
    expect(controller.entryFor(task.id)).toMatchObject({ optionId: 'ship' });
  });

  it('keeps the description pane in place for an option without a description', () => {
    const view = setup();
    expect(view.container.querySelector('.kq-desc-empty')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Fix it' }));
    // The pane stays as empty space, so a bottom-anchored strip never moves the row
    // away from the click that selected it.
    expect(view.container.querySelector('.kq-desc[data-empty]')).toBeTruthy();
    expect(view.container.querySelector('.kq-desc .kq-desc-body')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Ship it' }));
    expect(view.container.querySelector('.kq-desc .kq-desc-body')?.textContent).toContain('Send it to done.');
  });

  it('clears a selection whose option was removed', () => {
    const { controller, rerender } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Fix it' }));
    const withoutFix: Column = { ...Gate, decision: { ...Gate.decision!, options: Gate.decision!.options.filter(option => option.id !== 'fix') } };
    rerender(<DecisionPanel task={task} column={withoutFix} columns={columns} controller={controller} />);
    expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }));
    expect(controller.entryFor(task.id)).toBeUndefined();
  });

  it('is absent outside a decision stage', () => {
    const controller = new DecisionWindowController({ run: async () => fixture() });
    const view = render(<DecisionPanel task={task} column={{ id: 'gate', name: 'Gate' }} columns={columns} controller={controller} />);
    expect(view.container.textContent).toBe('');
  });
});