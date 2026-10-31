// @vitest-environment jsdom
import React from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView, columnLayout } from '../../src/client/board.js';
import { ConversationCloseAction } from '../../src/client/conversation-actions.js';
import type { KanbanSnapshot, ClientApi, Command } from '../../src/shared/types.js';
import { styles } from '../../src/client/styles.js';
import { deferred, fakeApi, fixture, restrictedFixture } from './helpers.js';


vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
      React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);
function mount(data = fixture()) {
  const mock = fakeApi(data); const renderer = vi.fn((id: string) => <div data-testid={'native-' + id}>Native session {id}<ConversationCloseAction /></div>);
  const view = render(<BoardView api={mock.api} renderConversation={renderer} />);
  return { ...mock, renderer, ...view, user: userEvent.setup() };
}
async function loaded() { await screen.findByRole('button', { name: 'Open task Alpha task' }); }
async function openAlpha(user: ReturnType<typeof userEvent.setup>) { await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Alpha task' })); }

describe('native overlay protection', () => {
  it('keeps the drawer open when a native-style menu portal is used', async () => {
    // Native action popovers portal out of the drawer; the page-body outside-close
    // handler is a sibling, so selecting inside that portal must leave the task open.
    const mock = fakeApi(); const user = userEvent.setup();
    render(<BoardView api={mock.api} renderConversation={() => createPortal(<div role="tree" aria-label="Native subagent tree">native menu</div>, document.body)} />);
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await user.click(screen.getByRole('button', { name: 'Open task Alpha task' }));
    fireEvent.pointerDown(screen.getByLabelText('Native subagent tree'));
    expect(screen.getByRole('heading', { name: 'Alpha task', level: 2 })).toBeTruthy();
  });
});

describe('board header layout', () => {
  it('defines the fallback native-action row and the native header wrapper', () => {
    expect(styles).toContain('.dsh-kanban .kb-conversation-status{');
    expect(styles).toContain('container-type:inline-size');
    expect(styles).toContain('.dsh-kanban .kb-conversation-status:empty{display:none}');
    expect(styles).toContain('.dsh-kanban .kb-native-session-header{');
  });

  it('reserves the host frame leading clearance for the collapsed sidebar', () => {
    const rule = styles.match(/\.dsh-kanban \.kb-header\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('padding-inline-start:max(20px,var(--dsh-frame-leading-clearance,20px))');
    expect(styles).toContain('.dsh-kanban .kb-header{padding:12px;padding-inline-start:max(12px,var(--dsh-frame-leading-clearance,12px))}');
  });
});

describe('scoped Kanban page', () => {
  it('renders grouped columns, search/project intersection, and simultaneous independent attention', async () => {
    const { user } = mount(); await loaded();
    expect(screen.getByRole('region', { name: 'Planning' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Unread messages' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Awaiting reply' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Agent failure' })).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy(); expect(screen.getByText('1 job')).toBeTruthy();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open task Alpha task' }).closest('.kb-card')?.getAttribute('data-working')).toBe('true');
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'documentation');
    expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull(); expect(screen.getByRole('button', { name: 'Open task Beta task' })).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    expect(screen.queryByRole('button', { name: 'Open task Beta task' })).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search tasks' })); expect(screen.getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy();
  });

  it('shows background work on its own after the turn ends', async () => {
    const { publish, get } = mount(); await loaded();
    const next = get();
    next.attention.t2 = { running: false, background: [{ kind: 'job', label: 'Run tests' }], unread: false, awaitingReply: false, failed: false };
    act(() => { publish(next); });
    const beta = screen.getByRole('button', { name: 'Open task Beta task' }).closest('.kb-card') as HTMLElement;
    expect(within(beta).getByText('1 job')).toBeTruthy();
    expect(within(beta).getByTitle('Run tests')).toBeTruthy();
    expect(beta.getAttribute('data-working')).toBeNull();
  });

  it('keeps the task execution status in the drawer header across sections', async () => {
    const { user } = mount(); await openAlpha(user);
    const drawer = screen.getByLabelText('Task details');
    expect(within(drawer).getByText('Working')).toBeTruthy();
    expect(within(drawer).getByText('Background: Run tests')).toBeTruthy();
    await user.click(within(drawer).getByRole('tab', { name: 'Info' }));
    expect(within(drawer).getByText('Working')).toBeTruthy();
    expect(within(drawer).getByText('Background: Run tests')).toBeTruthy();
  });

  it('clears the drawer status and background detail without a reload when the task settles', async () => {
    const { user, publish, get } = mount(); await openAlpha(user);
    const drawer = screen.getByLabelText('Task details');
    expect(within(drawer).getByText('Working')).toBeTruthy();
    const next = get();
    next.attention.t1 = { running: false, background: [], unread: false, awaitingReply: false, failed: false };
    act(() => { publish(next); });
    expect(within(drawer).queryByText('Working')).toBeNull();
    expect(within(drawer).queryByText(/Background:/)).toBeNull();
  });

  it('creates from the top-level action without starting an agent or hardcoding backlog', async () => {
    const { user, command } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'New API task');
    await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Specification');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project' }), 'p2');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.create', projectId: 'p2', title: 'New API task', description: 'Specification' }));
    expect(command.mock.calls.some(([value]) => value.type === 'task.move')).toBe(false); expect(screen.getByRole('button', { name: 'Open task New API task' })).toBeTruthy();
  });

  it('withholds the first conversation until the task worktree choice is made', async () => {
    const { user, command } = mount(); await loaded();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Gated task');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project' }), 'p2');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    const start = await screen.findByRole('button', { name: 'Start conversation' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Continue in base project' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue in base project' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Start conversation' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'conversation.create' })));
  });

  it('starts a zero-conversation folder task without a worktree gate', async () => {
    const data = fixture(); data.state.tasks[0]!.sessionIds = []; delete data.state.projects[0]!.gitRootPath;
    const { user } = mount(data); await openAlpha(user);
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts a zero-conversation task with a ready worktree', async () => {
    const data = fixture(); const task = data.state.tasks[0]!; task.sessionIds = []; task.worktree = { path: '/trees/alpha', branch: 'alpha', owned: true, status: 'ready' }; task.effectiveCwd = '/trees/alpha';
    const { user } = mount(data); await openAlpha(user);
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('withholds the start for a zero-conversation preparing worktree and points to Git', async () => {
    const data = fixture(); const task = data.state.tasks[0]!; task.sessionIds = []; task.worktree = { path: '/trees/alpha', branch: 'alpha', owned: true, status: 'preparing' }; task.effectiveCwd = '/trees/alpha';
    const { user } = mount(data); await openAlpha(user);
    expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull();
    expect(screen.getByText('Resolve the worktree setup in Git before starting.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('withholds the start when the task project is unavailable', async () => {
    const data = fixture(); data.state.tasks[0]!.sessionIds = []; data.state.tasks[0]!.projectId = 'missing-project';
    const { user } = mount(data); await openAlpha(user);
    expect(screen.getByText('Refresh the board: the task project is unavailable.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an existing conversation ungated and allows another tab', async () => {
    const { user } = mount(); await openAlpha(user);
    expect(screen.queryByRole('button', { name: 'Start conversation' })).toBeNull();
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('starts the new task project empty and requires an explicit choice', async () => {
    const { user } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Needs a project');
    const project = within(dialog).getByRole('combobox', { name: 'Project' }) as HTMLSelectElement;
    expect(project.value).toBe('');
    expect((within(dialog).getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(project, 'p1');
    expect((within(dialog).getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project filter' }), 'p1');
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const filtered = screen.getByRole('dialog', { name: 'New task' });
    expect((within(filtered).getByRole('combobox', { name: 'Project' }) as HTMLSelectElement).value).toBe('');
  });

  it('shows read-only Info and edits inline without a worktree-stage restriction', async () => {
    const { user, command } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); await user.click(screen.getByRole('tab', { name: 'Info' }));
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText('Searchable documentation')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByRole('textbox', { name: 'Title' }); await user.clear(title); await user.type(title, 'Updated Beta');
    const description = screen.getByRole('textbox', { name: 'Description' }); await user.clear(description); await user.type(description, '**Bold** <script>bad()</script>');
    expect(document.querySelector('script')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.edit', taskId: 't2', title: 'Updated Beta', description: '**Bold** <script>bad()</script>' })));
    expect(command.mock.calls.some(([value]) => value.type === 'task.move')).toBe(false);
  });

  it('uses distinct injected native sessions, plus, close and reopen without history deletion', async () => {
    const { user, renderer, command } = mount(); await openAlpha(user);
    expect(screen.getByTestId('native-s1')).toBeTruthy(); await user.click(screen.getByRole('tab', { name: 'Agent 2' })); expect(screen.getByTestId('native-s2')).toBeTruthy(); expect(screen.queryByTestId('native-s1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New conversation' })); await screen.findByTestId('native-s3');
    await user.click(screen.getByRole('button', { name: 'Close Agent 3' })); expect(screen.queryByTestId('native-s3')).toBeNull();
    await user.click(screen.getByRole('button', { name: '1 closed conversation' })); await user.click(screen.getByRole('button', { name: 'Reopen Agent 3' })); await screen.findByTestId('native-s3');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Agent 3' })).toBe(document.activeElement));
    expect(command).toHaveBeenCalledWith({ type: 'conversation.create', taskId: 't1' }); expect(command).toHaveBeenCalledWith({ type: 'conversation.close', taskId: 't1', sessionId: 's3' }); expect(command).toHaveBeenCalledWith({ type: 'conversation.reopen', taskId: 't1', sessionId: 's3' }); expect(renderer).toHaveBeenCalledWith('s2', undefined);
  });

  it('dismisses the closed-conversation popover without closing the drawer', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    const { user } = mount(data); await openAlpha(user);
    await user.click(screen.getByRole('button', { name: '1 closed conversation' }));
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Closed conversations' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Alpha task', level: 2 })).toBeTruthy();
  });

  it('persists the base-project choice from the missing-tree notice', async () => {
    const { user, command } = mount(); await openAlpha(user); expect(screen.getByRole('note', { name: 'Worktree not created' })).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Continue in base project' })); await waitFor(() => expect(screen.queryByRole('note', { name: 'Worktree not created' })).toBeNull()); expect(command).toHaveBeenCalledWith({ type: 'worktree.dismiss', taskId: 't1' });
  });

  it('shares notes across tabs and strips unsafe raw HTML and javascript links', async () => {
    const { user, command } = mount(); await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Notes' }));
    await user.type(screen.getByRole('textbox', { name: 'New note Markdown' }), '**Shared** <img src=x onerror=alert(1)> [bad](javascript:alert)'); await user.click(screen.getByRole('button', { name: 'Save note' })); await screen.findByText('Shared');
    expect(document.querySelector('img[onerror]')).toBeNull(); expect(document.querySelector('a[href^="javascript:"]')).toBeNull(); expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'note.save', taskId: 't1' }));
    await user.click(screen.getByRole('tab', { name: 'Conversations' })); await user.click(screen.getByRole('tab', { name: 'Agent 2' })); await user.click(screen.getByRole('tab', { name: 'Notes' })); expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('configures projects and YAML inside Kanban and reports host errors', async () => {
    const { user, command } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker'); await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/mono/apps/worker'); await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/mono'); await user.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.save', project: { name: 'Worker', projectPath: '/mono/apps/worker', gitRootPath: '/mono' } })));
    await user.click(screen.getByRole('tab', { name: 'Board' })); const yaml = screen.getByRole('textbox', { name: 'Workflow YAML' }); await user.clear(yaml); await user.type(yaml, 'name: Host Reject' + String.fromCharCode(10) + 'initial_column: one' + String.fromCharCode(10) + 'columns:' + String.fromCharCode(10) + '  - id: one' + String.fromCharCode(10) + '    label: One'); command.mockRejectedValueOnce({ code: 'INVALID_WORKFLOW', message: 'Column is missing.' }); const save = screen.getByRole('button', { name: 'Save workflow' }) as HTMLButtonElement; await waitFor(() => expect(save.disabled).toBe(false)); await user.click(save); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.getByText('Column is missing.')).toBeTruthy();
  });

  it('edits a newly saved project rather than creating it again', async () => {
    const { user, command } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Configuration' })); await user.click(screen.getByRole('tab', { name: 'Projects' })); await user.click(screen.getByRole('button', { name: 'New project' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Worker'); await user.type(screen.getByRole('textbox', { name: 'Project path' }), '/mono/apps/worker'); await user.type(screen.getByRole('textbox', { name: 'Git root' }), '/mono'); await user.click(screen.getByRole('button', { name: 'Save project' })); await screen.findByText('Project saved.'); await user.click(screen.getByRole('button', { name: 'Edit project Worker' })); await user.clear(screen.getByRole('textbox', { name: 'Project name' })); await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Updated Worker'); await user.click(screen.getByRole('button', { name: 'Save project' })); await waitFor(() => expect(command).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'project.save', project: { id: 'p3', name: 'Updated Worker', projectPath: '/mono/apps/worker', gitRootPath: '/mono' } })));
  });

  it('opens General first and saves or clears the worktree base path', async () => {
    const { user, command } = mount(); await loaded();
    await user.click(screen.getByRole('button', { name: 'Configuration' }));
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
    const input = screen.getByRole('textbox', { name: 'Worktree base path' });
    await user.type(input, '/worktrees');
    expect(screen.getByText('/worktrees/fix-login')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'settings.save', settings: { worktreeBasePath: '/worktrees' }, expectedRevision: 1 }));
    await screen.findByText('Settings saved.');
    expect((screen.getByRole('textbox', { name: 'Worktree base path' }) as HTMLInputElement).value).toBe('/worktrees');
    await user.clear(screen.getByRole('textbox', { name: 'Worktree base path' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'settings.save', settings: {}, expectedRevision: 2 }));
    expect((screen.getByRole('textbox', { name: 'Worktree base path' }) as HTMLInputElement).value).toBe('');
  });

  it('browses for the worktree base path and reports a validation error', async () => {
    const mock = fakeApi(); const pick = vi.fn(async () => '/picked/trees');
    const user = userEvent.setup(); render(<BoardView api={mock.api} picker={{ pick }} renderConversation={() => null} />);
    await loaded(); await user.click(screen.getByRole('button', { name: 'Configuration' }));
    await user.click(screen.getByRole('button', { name: 'Browse for worktree base path' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Worktree base path' }) as HTMLInputElement).value).toBe('/picked/trees'));
    mock.command.mockRejectedValueOnce({ code: 'INVALID_WORKTREE_BASE_PATH', message: 'The base path must be an existing directory.' });
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('The base path must be an existing directory.')).toBeTruthy();
  });

  it('shows project onboarding without an invented default project', async () => {
    const initial = fixture(); initial.state.projects = []; initial.state.tasks = []; const { user, command } = mount(initial); await screen.findByText('Add your first project'); expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(true); await user.click(screen.getByRole('button', { name: 'Configure projects' })); expect(screen.getByRole('dialog', { name: 'Kanban configuration' })).toBeTruthy(); expect(screen.getByRole('tab', { name: 'Projects' }).getAttribute('aria-selected')).toBe('true'); expect(command).not.toHaveBeenCalled();
  });
});

describe('workflow confirmation', () => {
  it('moves immediately to an uninstructed stage without a worktree prompt', async () => {
    const { user, command } = mount(); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'doing');
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'doing' }));
    expect(screen.queryByText('Worktree is optional')).toBeNull();
  });

  it('moves immediately to an instructed stage without opening a dialog', async () => {
    const { user, command } = mount(); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move and run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move only' })).toBeNull();
    expect(command.mock.calls.every(([value]) => value.type !== 'task.runInstruction')).toBe(true);
  });

  it('lists the complete workflow in order and marks only restricted stages', async () => {
    const { user } = mount(restrictedFixture()); await openAlpha(user);
    const select = screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement;
    expect([...select.options].map(option => option.value)).toEqual(['intake', 'doing', 'review', 'blocked']);
    expect(select.value).toBe('intake');
    expect(select.options[3]!.className).toContain('kb-stage-option-restricted');
    expect(select.options[3]!.disabled).toBe(false);
    expect(select.options[3]!.getAttribute('aria-label')).toBe('Blocked, requires confirmation');
    expect(select.options[1]!.className).not.toContain('kb-stage-option-restricted');
    const hint = document.getElementById(select.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('require confirmation before moving');
  });

  it('asks for confirmation before a restricted select and cancels without a command', async () => {
    const { user, command } = mount(restrictedFixture()); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const dialog = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    expect(within(dialog).getByText('Alpha task')).toBeTruthy();
    expect(within(dialog).getByText('Delivery')).toBeTruthy();
    expect(within(dialog).getByText(/does not allow moving this card from Intake to Blocked/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).disabled).toBe(true);
    expect(command).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).value).toBe('intake');
    expect(command).not.toHaveBeenCalled();
  });

  it('moves after confirming a restricted stage and sends the override flag', async () => {
    const { user, command, get } = mount(restrictedFixture()); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const dialog = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(dialog).getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'blocked', overrideTransition: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(get().state.tasks[0]!.columnId).toBe('blocked');
    expect(command.mock.calls.some(([value]) => value.type === 'task.runInstruction')).toBe(false);
  });

  it('keeps the confirmation open on host rejection and retries', async () => {
    const { user, command } = mount(restrictedFixture()); await openAlpha(user);
    command.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'The task is busy.' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    const dialog = await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    await user.click(within(dialog).getByRole('button', { name: 'Move anyway' }));
    expect(await screen.findByText('The task is busy.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports a stale source and closes without a pointless retry', async () => {
    const { user, command, publish, get } = mount(restrictedFixture()); await openAlpha(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'blocked');
    await screen.findByRole('dialog', { name: 'Move to Blocked?' });
    const next = get(); next.state.tasks[0]!.columnId = 'doing'; next.sequence += 1;
    act(() => { publish(next); });
    await user.click(screen.getByRole('button', { name: 'Move anyway' }));
    expect(await screen.findByText(/moved to another stage while this confirmation was open/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Git controls and destructive actions', () => {
  it('creates a new branch using real branch discovery and the exact shared command', async () => {
    const { user, api, command } = mount(); await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Git' })); await waitFor(() => expect(api.branches).toHaveBeenCalledWith('t1'));
    await user.clear(screen.getByRole('textbox', { name: 'Branch name' })); await user.type(screen.getByRole('textbox', { name: 'Branch name' }), 'feature/work'); await user.type(screen.getByRole('textbox', { name: 'Worktree path' }), '/trees/work'); await user.click(screen.getByRole('button', { name: 'Create worktree' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'new', branchName: 'feature/work', sourceBranch: 'main', path: '/trees/work' })); expect(screen.getByText('/trees/work/apps/api')).toBeTruthy();
  });

  it('creates for an existing branch rather than treating it as an existing worktree', async () => {
    const { user, command } = mount(); await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Git' })); await screen.findByDisplayValue('main'); await user.selectOptions(screen.getByRole('combobox', { name: 'Branch mode' }), 'existing'); const existing = screen.getByRole('combobox', { name: 'Existing branch' }); await user.clear(existing); await user.type(existing, 'feature'); await user.type(screen.getByRole('textbox', { name: 'Worktree path' }), '/trees/existing'); await user.click(screen.getByRole('button', { name: 'Create worktree' })); await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.create', taskId: 't1', mode: 'existing', branchName: 'feature', path: '/trees/existing' }));
  });

  it('attaches an external checkout with a separate form', async () => {
    const { user, command } = mount(); await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Git' })); await user.click(screen.getByRole('button', { name: 'Attach existing worktree' })); await user.type(screen.getByRole('textbox', { name: 'Existing worktree path' }), '/external/tree'); await user.click(screen.getByRole('button', { name: 'Attach worktree' })); await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'worktree.attach', taskId: 't1', path: '/external/tree' })); expect(screen.getByText('Attached external worktree')).toBeTruthy();
  });

  it('shows failed operation recovery and sends retry and return commands', async () => {
    const initial = fixture(); initial.state.tasks[0]!.operation = { id: 'op', request: { kind: 'attach', path: '/missing' }, phase: 'failed', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now', error: { code: 'MISSING_PATH', message: 'The directory is unavailable.' } };
    const { user, command, publish, get } = mount(initial); await openAlpha(user); expect(screen.getByText('The directory is unavailable.')).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Retry worktree attachment' })); await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'operation.retry', taskId: 't1' })); const next = get(); next.state.tasks[0]!.operation = initial.state.tasks[0]!.operation; next.sequence++; act(() => { publish(next); }); await user.click(screen.getByRole('button', { name: 'Return chats to project' })); await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'operation.return', taskId: 't1' }));
  });

  it('shows a failed confirmed workflow action and exposes explicit retry/cancel recovery', async () => {
    const initial = fixture(); initial.state.tasks[0]!.pendingTransition = { id: 'transition', fromColumnId: 'intake', columnId: 'review', mode: 'run', sessionId: 's2', status: 'failed', error: { code: 'SEND_FAILED', message: 'The approved instruction was not delivered.' } };
    const { user, command, publish, get } = mount(initial); await openAlpha(user); expect(screen.getByText('The approved instruction was not delivered.')).toBeTruthy(); expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).disabled).toBe(true); await user.click(screen.getByRole('button', { name: 'Retry confirmed action' })); expect(command).toHaveBeenCalledWith({ type: 'operation.retry', taskId: 't1' }); const next = get(); next.sequence++; act(() => { publish(next); }); await user.click(screen.getByRole('button', { name: 'Cancel action and return to base' })); expect(command).toHaveBeenCalledWith({ type: 'operation.return', taskId: 't1' });
  });

  it('reports branch lookup errors and permits an explicit refresh', async () => {
    const mock = fakeApi(); vi.mocked(mock.api.branches).mockRejectedValueOnce({ code: 'BRANCH_LOOKUP_FAILED', message: 'Branch lookup is unavailable.' }); const user = userEvent.setup(); render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); await openAlpha(user); await user.click(screen.getByRole('tab', { name: 'Git' })); expect(await screen.findByText('Branch lookup is unavailable.')).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Refresh branches' })); await waitFor(() => expect(mock.api.branches).toHaveBeenCalledTimes(2)); await waitFor(() => expect(screen.queryByText('Branch lookup is unavailable.')).toBeNull());
  });

  it('requires a second explicit discard confirmation and never auto-forces removal', async () => {
    const { user, command } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); await user.click(screen.getByRole('tab', { name: 'Git' }));
    command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.', details: { path: '/trees/beta' } }); await user.click(screen.getByRole('button', { name: 'Remove worktree' })); await user.click(screen.getByRole('button', { name: 'Confirm worktree removal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); expect(command.mock.calls).toHaveLength(1); expect(command.mock.calls[0]![0]).toEqual({ type: 'worktree.remove', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta' });
    expect((within(dialog).getByRole('button', { name: 'Discard changes and continue' }) as HTMLButtonElement).disabled).toBe(true); await user.click(within(dialog).getByRole('checkbox')); expect(command.mock.calls).toHaveLength(1); await user.click(within(dialog).getByRole('button', { name: 'Discard changes and continue' })); await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'worktree.remove', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta', discardChanges: true }));
  });

  it('rejects a discard confirmation if its displayed worktree target changes', async () => {
    const { user, command, get, publish } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); await user.click(screen.getByRole('tab', { name: 'Git' })); command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' }); await user.click(screen.getByRole('button', { name: 'Remove worktree' })); await user.click(screen.getByRole('button', { name: 'Confirm worktree removal' })); const dialog = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); const changed = get(); changed.sequence++; changed.state.tasks[1]!.worktree!.path = '/different/checkout'; act(() => { publish(changed); }); await user.click(within(dialog).getByRole('checkbox')); await user.click(within(dialog).getByRole('button', { name: 'Discard changes and continue' })); expect(await within(dialog).findByText(/worktree changed while confirmation/)).toBeTruthy(); expect(command.mock.calls).toHaveLength(1);
  });

  it('retains the originally displayed target if a snapshot changes before DISCARD_REQUIRED arrives', async () => {
    const { user, command, get, publish } = mount(); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); await user.click(screen.getByRole('tab', { name: 'Git' })); let reject!: (error: unknown) => void; command.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; })); await user.click(screen.getByRole('button', { name: 'Remove worktree' })); await user.click(screen.getByRole('button', { name: 'Confirm worktree removal' })); const changed = get(); changed.sequence++; changed.state.tasks[1]!.worktree!.path = '/trees/replaced'; act(() => { publish(changed); }); await act(async () => { reject({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.', details: { path: '/trees/replaced' } }); }); const dialog = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); const identity = dialog.querySelector('.kb-destructive-identity'); expect(identity?.textContent).toContain('/trees/beta'); expect(identity?.textContent).not.toContain('/trees/replaced'); await user.click(within(dialog).getByRole('checkbox')); await user.click(within(dialog).getByRole('button', { name: 'Discard changes and continue' })); await within(dialog).findByText(/worktree changed while confirmation/); expect(command.mock.calls).toHaveLength(1); expect(command.mock.calls[0]![0]).toEqual({ type: 'worktree.remove', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta' });
  });

  it('retains a failed operation journal target instead of recapturing the current checkout', async () => {
    const initial = fixture(); initial.state.tasks[1]!.operation = { id: 'old-target', request: { kind: 'remove', discardChanges: false, expectedWorktreePath: '/trees/original' }, targetPath: '/trees/original', phase: 'failed', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' }; const { user, command } = mount(initial); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' }); await user.click(screen.getByRole('button', { name: 'Retry worktree removal' })); const dialog = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); expect(within(dialog).getByText('/trees/original')).toBeTruthy(); await user.click(within(dialog).getByRole('checkbox')); await user.click(within(dialog).getByRole('button', { name: 'Discard changes and continue' })); await within(dialog).findByText(/worktree changed while confirmation/); expect(command.mock.calls).toHaveLength(1);
  });

  it('skips a bulk task with local changes without opening the single-task discard dialog', async () => {
    const { user, command } = mount(); await loaded();
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete selected tasks' });
    command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete selected' }));
    await screen.findByRole('dialog', { name: 'Deletion results' });
    expect(screen.queryByRole('dialog', { name: 'Discard local worktree changes?' })).toBeNull();
    expect(screen.getByText(/Local changes exist\./)).toBeTruthy();
  });

  it('keeps a shared-worktree failure inside the delete dialog without a duplicate board error', async () => {
    const { user, command } = mount(); await openAlpha(user);
    command.mockRejectedValueOnce({ code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child' } });
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    expect(await within(dialog).findByText('Another DSH conversation is using this checkout.')).toBeTruthy();
    expect(screen.getAllByText('Another DSH conversation is using this checkout.')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Delete task' })).toBeTruthy();
  });

  it('keeps the delete confirmation busy and dismissable only after the command settles', async () => {
    const { user, command, get, publish } = mount(); await openAlpha(user);
    const gate = deferred<KanbanSnapshot>();
    command.mockImplementationOnce(() => gate.promise);
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    expect((within(dialog).getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    const next = get(); next.sequence += 1; next.state.tasks = next.state.tasks.filter(task => task.id !== 't1');
    act(() => { publish(next); });
    gate.resolve(next);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete task' })).toBeNull());
  });

  it('reports bulk progress while a selected deletion is deferred', async () => {
    const { user, command, get, publish } = mount(); await loaded();
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete selected tasks' });
    const gate = deferred<KanbanSnapshot>();
    command.mockImplementationOnce(() => gate.promise);
    command.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'Wait for Beta.' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete selected' }));
    expect(await screen.findByText('Deleting 1 of 2: Alpha task')).toBeTruthy();
    const next = get(); next.sequence += 1; next.state.tasks = next.state.tasks.filter(task => task.id !== 't1');
    act(() => { publish(next); });
    gate.resolve(next);
    const result = await screen.findByRole('dialog', { name: 'Deletion results' });
    expect(within(result).getByText('1 task deleted.')).toBeTruthy();
    expect(within(result).getByText(/Wait for Beta/)).toBeTruthy();
  });

  it('keeps a deferred deletion failure in the confirmation surface', async () => {
    const { user, command, get, publish } = mount(); await openAlpha(user);
    const operation = { id: 'op', request: { kind: 'delete' as const, discardChanges: false, expectedWorktreePath: null }, phase: 'waiting' as const, targetPath: undefined, previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now' };
    const initial = get();
    const waiting = { ...initial, sequence: initial.sequence + 1, state: { ...initial.state, tasks: initial.state.tasks.map(task => task.id === 't1' ? { ...task, operation } : task) } as typeof initial.state };
    command.mockResolvedValueOnce(waiting);
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete task' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    expect(await within(dialog).findByRole('button', { name: 'Retry deletion' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).toBeNull();
    const failedTask = { ...waiting.state.tasks.find(task => task.id === 't1')!, operation: { ...operation, phase: 'failed' as const, error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child' } } } };
    act(() => { publish({ ...waiting, sequence: waiting.sequence + 1, state: { ...waiting.state, tasks: waiting.state.tasks.map(task => task.id === 't1' ? failedTask : task) } as typeof waiting.state }); });
    expect(within(dialog).getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Return chats to project' })).toBeTruthy();
    expect(within(dialog).getByText('Another DSH conversation is using this checkout.')).toBeTruthy();
  });

  it('can keep local changes after DISCARD_REQUIRED without a forced retry', async () => {
    const { user, command } = mount(); await openAlpha(user); command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' }); await user.click(screen.getByRole('button', { name: 'Delete task' })); const deleteDialog = screen.getByRole('dialog', { name: 'Delete task' }); expect(within(deleteDialog).getByText(/archived; their histories remain/)).toBeTruthy(); await user.click(within(deleteDialog).getByRole('button', { name: 'Delete task' })); await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); await user.click(screen.getByRole('button', { name: 'Keep local changes' })); expect(command.mock.calls).toHaveLength(1); expect(command.mock.calls[0]![0]).toEqual({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null }); expect(screen.getByRole('button', { name: 'Open task Alpha task' })).toBeTruthy();
  });

  it('requires explicit discard consent when retrying a failed destructive operation', async () => {
    const initial = fixture(); initial.state.tasks[1]!.operation = { id: 'remove-op', request: { kind: 'remove', discardChanges: false, expectedWorktreePath: '/trees/beta' }, phase: 'failed', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: [], gitCompleted: false, createdAt: 'now', error: { code: 'DISCARD_REQUIRED', message: 'Local changes exist.' } }; const { user, command } = mount(initial); await loaded(); await user.click(screen.getByRole('button', { name: 'Open task Beta task' })); command.mockRejectedValueOnce({ code: 'DISCARD_REQUIRED', message: 'Local changes exist.' }); await user.click(screen.getByRole('button', { name: 'Retry worktree removal' })); const dialog = await screen.findByRole('dialog', { name: 'Discard local worktree changes?' }); expect(command.mock.calls[0]![0]).toEqual({ type: 'operation.retry', taskId: 't2' }); await user.click(within(dialog).getByRole('checkbox')); await user.click(within(dialog).getByRole('button', { name: 'Discard changes and continue' })); await waitFor(() => expect(command).toHaveBeenLastCalledWith({ type: 'worktree.remove', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta', discardChanges: true }));
  });

  it('deletes task data only after the explicit archive-chats confirmation', async () => {
    const { user, command } = mount(); await openAlpha(user); await user.click(screen.getByRole('button', { name: 'Delete task' })); const deleteDialog = screen.getByRole('dialog', { name: 'Delete task' }); expect(command).not.toHaveBeenCalled(); await user.click(within(deleteDialog).getByRole('button', { name: 'Delete task' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull()); expect(command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null }); expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull();
  });

  it('deletes selected tasks best-effort and reports blocked tasks', async () => {
    const { user, command } = mount(); await loaded();
    await user.click(screen.getByRole('button', { name: 'Select cards to delete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha task' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta task' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete selected tasks' });
    expect(within(dialog).getByText(/3 conversations/)).toBeTruthy();
    expect(within(dialog).getByText(/1 worktree/)).toBeTruthy();
    command.mockRejectedValueOnce({ code: 'TASK_BUSY', message: 'Wait for Alpha.' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete selected' }));
    const result = await screen.findByRole('dialog', { name: 'Deletion results' });
    expect(within(result).getByText('1 task deleted.')).toBeTruthy();
    expect(screen.getByText(/Wait for Alpha/)).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't1', confirmed: true, expectedWorktreePath: null, requireIdle: true });
    expect(command).toHaveBeenCalledWith({ type: 'task.delete', taskId: 't2', confirmed: true, expectedWorktreePath: '/trees/beta', requireIdle: true });
  });
});

describe('accessibility, pending, subscriptions and errors', () => {
  it('provides keyboard tabs, dialog focus and Escape without dispatching', async () => {
    const { user, command } = mount(); await openAlpha(user); const tab = screen.getByRole('tab', { name: 'Conversations' }); tab.focus(); await user.keyboard('{ArrowRight}'); expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Info' })); await user.click(screen.getByRole('button', { name: 'New task' })); expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true); await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull(); expect(command).not.toHaveBeenCalled();
  });

  it('shows initial load errors and permits retry, unsubscribing on unmount', async () => {
    const mock = fakeApi(); vi.mocked(mock.api.snapshot).mockRejectedValueOnce({ code: 'OFFLINE', message: 'Reconnect to the host.' }); const user = userEvent.setup(); const view = render(<BoardView api={mock.api} renderConversation={id => <span>{id}</span>} />); expect(await screen.findByText('Reconnect to the host.')).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Retry loading board' })); await loaded(); expect(mock.listeners.size).toBe(1); view.unmount(); expect(mock.listeners.size).toBe(0);
  });

  it('does not replace a newer subscribed snapshot with a late initial snapshot', async () => {
    const mock = fakeApi(); let resolve!: (value: KanbanSnapshot) => void; vi.mocked(mock.api.snapshot).mockImplementationOnce(() => new Promise(done => { resolve = done; })); render(<BoardView api={mock.api} renderConversation={() => null} />); const fresh = fixture(); fresh.sequence = 4; fresh.state.tasks[0]!.title = 'Latest task'; act(() => { mock.publish(fresh); }); await screen.findByRole('button', { name: 'Open task Latest task' }); await act(async () => { resolve(fixture()); }); expect(screen.getByRole('button', { name: 'Open task Latest task' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Open task Alpha task' })).toBeNull();
  });

  it('keeps pending forms disabled until a command settles and reports failures inline', async () => {
    const { user, command } = mount(); await loaded(); let reject!: (error: unknown) => void; command.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; })); await user.click(screen.getByRole('button', { name: 'New task' })); await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Pending'); await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'p1'); await user.click(screen.getByRole('button', { name: 'Create task' })); expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole('button', { name: 'Close New task' }) as HTMLButtonElement).disabled).toBe(true); await act(async () => { reject({ code: 'POLICY_DENIED', message: 'The destination is not permitted.' }); }); expect(await screen.findByText('The destination is not permitted.')).toBeTruthy(); expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps styling scoped away from native chat controls and renders groups once', () => {
    expect(styles.includes('.dsh-kanban button')).toBe(false); expect(styles).not.toMatch(/(^|})\s*body\s*\{/m); const layout = columnLayout(fixture().state.workflow); expect(layout.flatMap(slot => slot.columns.map(column => column.id))).toEqual(['intake', 'review', 'doing']); expect(layout[0]!.group?.name).toBe('Planning');
  });

  it('maps primary actions and accents to host theme tokens', () => {
    for (const token of ['--dsw-alias-button-primary-fill', '--dsw-alias-label-primary-foreground', '--dsw-alias-button-primary-hover', '--dsw-alias-state-business-primary', '--dsw-focus-ring-width', '--dsw-focus-ring-color']) expect(styles).toContain(token);
    expect(styles).not.toContain('Highlight');
    expect(styles).toContain('var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color');
    const genericHover = styles.indexOf('.dsh-kanban .kb-button:hover:not(:disabled)');
    const primaryHover = styles.indexOf('.dsh-kanban .kb-primary:hover:not(:disabled)');
    expect(genericHover).toBeGreaterThan(-1);
    expect(primaryHover).toBeGreaterThan(genericHover);
  });
});

describe('drawer-wide operation recovery', () => {
  it('shows a failed deletion from Info and Notes and hides Return after archiving', async () => {
    const initial = fixture();
    initial.state.tasks[1]!.operation = {
      id: 'delete-op', request: { kind: 'delete', discardChanges: false, expectedWorktreePath: '/trees/beta' },
      phase: 'failed', targetPath: '/trees/beta', previousDirectories: {}, switchedSessionIds: [], archivedSessionIds: ['s-beta'], gitCompleted: true,
      createdAt: 'now', error: { code: 'SHARED_WORKTREE', message: 'Another DSH conversation is using this checkout.', details: { sessionId: 'child', path: '/trees/beta' } },
    };
    const { user } = mount(initial); await loaded();
    await user.click(screen.getByRole('button', { name: 'Open task Beta task' }));
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    expect(screen.getAllByText('Task deletion needs attention').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry deletion' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Return chats to project' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getAllByText('Task deletion needs attention').length).toBeGreaterThan(0);
  });
});
