// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Configuration } from '../../src/client/settings/configuration.js';
import type { Command, KanbanSnapshot } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
      React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);
const valid = ['name: Delivery', 'initial_column: one', 'columns:', '  - id: one', '    label: One', '  - id: two', '    label: Two', ''].join(String.fromCharCode(10));
function snapshotFor(yaml: string): KanbanSnapshot {
  const base = fixture();
  return { ...base, sequence: 2, state: { ...base.state, hubs: [{ ...base.state.hubs[0]!, revision: 2, boards: [{ ...base.state.hubs[0]!.boards[0]!, workflowYaml: yaml }] }] } };
}
function mount(run: (command: Command) => Promise<KanbanSnapshot>, onClose = vi.fn()) {
  const value = fixture(); value.state.workflowYaml = valid;
  const user = userEvent.setup();
  render(<Configuration state={value.state} hub={value.state.hubs[0]!} board={value.state.hubs[0]!.boards[0]!} hubCount={1} settings={value.state.settings} settingsRevision={value.state.settings.revision} run={run} initial="Board" onClose={onClose} />);
  return { user, onClose, value };
}
const editor = () => screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole('button', { name: 'Save workflow' }) as HTMLButtonElement;

describe('workflow editor', () => {
  it('blocks Save while the YAML is invalid and enables it after correction', async () => {
    const { user } = mount(vi.fn(async (command: Command) => snapshotFor((command as Extract<Command, { type: 'workflow.save' }>).yaml)));
    fireEvent.change(editor(), { target: { value: 'columns: []' } });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(await screen.findByText(/INVALID_WORKFLOW/)).toBeTruthy();
    fireEvent.change(editor(), { target: { value: valid } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByText(/INVALID_WORKFLOW/)).toBeNull();
  });

  it('saves the displayed draft with the base revision and reports success', async () => {
    const run = vi.fn(async (command: Command) => snapshotFor((command as Extract<Command, { type: 'workflow.save' }>).yaml));
    const { user } = mount(run);
    const next = valid.replace('name: Delivery', 'name: Host Save');
    await user.clear(editor()); await user.type(editor(), next);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await user.click(saveButton());
    await waitFor(() => expect(run).toHaveBeenCalledWith({ type: 'workflow.save', yaml: next, expectedRevision: 1 }));
    expect(await screen.findByText('Workflow saved.')).toBeTruthy();
  });

  it('keeps a failed draft visible and surfaces the host error', async () => {
    const run = vi.fn(async () => { throw { code: 'INVALID_WORKFLOW', message: 'Column is missing.' }; });
    const { user } = mount(run);
    const next = valid.replace('name: Delivery', 'name: Host Reject');
    await user.clear(editor()); await user.type(editor(), next);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await user.click(saveButton());
    expect(await screen.findByText('Column is missing.')).toBeTruthy();
    expect(editor().value).toBe(next);
  });

  it('confirms before discarding a dirty draft with Reload', async () => {
    const { user } = mount(vi.fn(async (command: Command) => snapshotFor((command as Extract<Command, { type: 'workflow.save' }>).yaml)));
    await user.type(editor(), String.fromCharCode(10) + '# dirty');
    await user.click(screen.getByRole('button', { name: 'Reload saved workflow' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard workflow draft' });
    await user.click(confirm.querySelector('button') as HTMLButtonElement);
    expect(editor().value).toContain('# dirty');
    await user.click(screen.getByRole('button', { name: 'Reload saved workflow' }));
    await user.click(screen.getByRole('button', { name: 'Discard and reload' }));
    expect(editor().value).toBe(valid);
  });

  it('requires a close confirmation for an unsaved workflow draft', async () => {
    const { user, onClose } = mount(vi.fn(async (command: Command) => snapshotFor((command as Extract<Command, { type: 'workflow.save' }>).yaml)));
    await user.type(editor(), String.fromCharCode(10) + '# unsaved');
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard workflow changes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    await user.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves the draft across Configuration tabs', async () => {
    const { user } = mount(vi.fn(async (command: Command) => snapshotFor((command as Extract<Command, { type: 'workflow.save' }>).yaml)));
    await user.type(editor(), String.fromCharCode(10) + '# tab draft');
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(editor().value).toContain('# tab draft');
  });
});
