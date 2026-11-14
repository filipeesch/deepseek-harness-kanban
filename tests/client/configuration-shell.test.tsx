// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Configuration } from '../../src/client/settings/configuration.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) =>
      React.createElement('textarea', { 'aria-label': label, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);

function mount(options: { initial?: string } = {}) {
  const value = fixture();
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Configuration
    state={value.state} hub={value.state.hubs[0]!} board={value.state.hubs[0]!.boards[0]!} hubCount={1}
    settings={value.state.settings} settingsRevision={value.state.settings.revision}
    run={vi.fn(async () => ({}) as KanbanSnapshot)} initial={options.initial ?? 'Board'} onClose={onClose}
  />);
  return { value, user, onClose };
}

const topTabs = () => within(screen.getByRole('tablist', { name: 'Configuration sections' }));
const boardTabs = () => within(screen.getByRole('tablist', { name: 'Board configuration sections' }));
const boardName = () => screen.getByLabelText('Board name') as HTMLInputElement;

describe('configuration shell', () => {
  it('sizes each section from its descriptor', async () => {
    const { user } = mount();
    expect(screen.getByRole('dialog', { name: 'Kanban configuration' }).className).toContain('kb-dialog-settings-wide');
    await user.click(topTabs().getByRole('tab', { name: 'General' }));
    expect(screen.getByRole('dialog', { name: 'Kanban configuration' }).className).toContain('kb-dialog-settings');
    expect(screen.getByRole('dialog', { name: 'Kanban configuration' }).className).not.toContain('kb-dialog-settings-wide');
  });

  it('presents the five board sub-sections', async () => {
    mount();
    for (const name of ['General', 'Projects', 'Defaults', 'Workflow', 'Danger zone']) {
      expect(boardTabs().getByRole('tab', { name })).toBeTruthy();
    }
  });

  it('asks before leaving a dirty board panel and keeps the edits when canceled', async () => {
    const { user } = mount();
    await user.type(boardName(), ' Renamed');
    await user.click(boardTabs().getByRole('tab', { name: 'Projects' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard board panel changes' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(boardName().value).toBe('Delivery Renamed');
    await user.click(boardTabs().getByRole('tab', { name: 'Projects' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard board panel changes' })).getByRole('button', { name: 'Discard and continue' }));
    expect(screen.getByRole('group', { name: 'Board project scope' })).toBeTruthy();
  });

  it('asks before leaving the Board section with a dirty panel', async () => {
    const { user } = mount();
    await user.type(boardName(), ' Renamed');
    await user.click(topTabs().getByRole('tab', { name: 'General' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard board changes' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(boardName().value).toBe('Delivery Renamed');
    await user.click(topTabs().getByRole('tab', { name: 'General' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard board changes' })).getByRole('button', { name: 'Discard and continue' }));
    expect(screen.getByRole('textbox', { name: 'Worktree base path' })).toBeTruthy();
  });

  it('asks before closing with a dirty board panel', async () => {
    const { user, onClose } = mount();
    await user.type(boardName(), ' Renamed');
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard configuration changes' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard configuration changes' })).getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the workflow draft across a sub-tab switch without asking', async () => {
    const { user } = mount();
    await user.click(boardTabs().getByRole('tab', { name: 'Workflow' }));
    const editor = screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement;
    await user.type(editor, String.fromCharCode(10) + '# sub-tab draft');
    await user.click(boardTabs().getByRole('tab', { name: 'General' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(boardTabs().getByRole('tab', { name: 'Workflow' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement).value).toContain('# sub-tab draft'));
  });

  it('asks before closing with a workflow draft and keeps it when canceled', async () => {
    const { user, onClose } = mount();
    await user.click(boardTabs().getByRole('tab', { name: 'Workflow' }));
    await user.type(screen.getByRole('textbox', { name: 'Workflow YAML' }), String.fromCharCode(10) + '# unsaved');
    await user.click(screen.getByRole('button', { name: 'Close Kanban configuration' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Discard configuration changes' })).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement).value).toContain('# unsaved');
  });
});
