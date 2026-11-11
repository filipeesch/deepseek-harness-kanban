// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IconTabs } from '../../src/client/ui.js';
import { DrawerTitle } from '../../src/client/drawer-title.js';
import { DrawerStageControl } from '../../src/client/drawer-stage-control.js';
import { DrawerActions } from '../../src/client/drawer-actions.js';
import { DrawerSectionNav } from '../../src/client/drawer-section-nav.js';
import { autoModeView } from '../../src/client/auto-mode.js';
import { nextStage, transitionDestinations } from '../../src/domain/transitions.js';
import { transitions } from '../support/transition-rules.js';
import type { Column, Task, Workflow } from '../../src/shared/types.js';

afterEach(cleanup);

const now = '2026-01-01T00:00:00Z';
const column = (id: string, name: string, extra: Partial<Column> = {}): Column => ({ id, name, ...extra });
const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'backlog',
  columns: [
    column('backlog', 'Backlog', { allowedTransitions: transitions('plan') }),
    column('plan', 'Plan'),
    column('done', 'Done'),
  ],
  groups: [],
};
const restrictedFlow: Workflow = {
  ...workflow,
  columns: [column('backlog', 'Backlog', { allowedTransitions: [] }), column('plan', 'Plan'), column('done', 'Done')],
};
const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task', projectId: 'project', title: 'Alpha task', description: '', columnId: 'backlog', position: 0,
  sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
  createdAt: now, updatedAt: now, ...overrides,
});

describe('IconTabs', () => {
  const items = [
    { id: 'alpha', label: 'Alpha', icon: <span>a</span> },
    { id: 'beta', label: 'Beta', icon: <span>b</span> },
    { id: 'gamma', label: 'Gamma', icon: <span>c</span> },
  ];

  it('exposes each label as the accessible name and the tooltip', () => {
    render(<IconTabs label="Sections" items={items} selected="alpha" onSelect={() => {}} id="t" />);
    const tab = screen.getByRole('tab', { name: 'Alpha' });
    expect(tab.getAttribute('title')).toBe('Alpha');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('tabindex')).toBe('-1');
  });

  it('lets an item override its name and tooltip with reported state', () => {
    render(<IconTabs label="Sections" selected="alpha" onSelect={() => {}} id="t"
      items={[{ id: 'alpha', label: 'Alpha', icon: <span>a</span>, accessibleName: 'Alpha, running', tooltip: 'Alpha, running' }]} />);
    const tab = screen.getByRole('tab', { name: 'Alpha, running' });
    expect(tab.getAttribute('title')).toBe('Alpha, running');
  });

  it('keeps the roving tabindex and arrow-key navigation', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<IconTabs label="Sections" items={items} selected="alpha" onSelect={onSelect} id="t" />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('beta');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }));
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('gamma');
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('alpha');
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('gamma');
  });
});

describe('DrawerTitle', () => {
  it('keeps the full title in the tooltip and the project in one line', () => {
    render(<DrawerTitle id="title" title="A very long task title that must truncate" projectName="API" />);
    const heading = screen.getByRole('heading', { name: 'A very long task title that must truncate' });
    expect(heading.getAttribute('id')).toBe('title');
    expect(heading.getAttribute('title')).toBe('A very long task title that must truncate');
    expect(screen.getByText('API').getAttribute('title')).toBe('API');
    expect(screen.getByText('API').className).toBe('kb-drawer-project');
  });

  it('does not add a second project line', () => {
    const { container } = render(<DrawerTitle id="title" title="Alpha" projectName="API" />);
    expect(container.querySelector('.kb-drawer-title .kb-hint')).toBeNull();
    expect(container.querySelectorAll('h2')).toHaveLength(1);
  });
});

describe('DrawerStageControl', () => {
  const destinations = transitionDestinations(workflow, 'backlog');

  it('selects a stage and advances to the next stage through the same move callback', () => {
    const onMove = vi.fn();
    render(<DrawerStageControl id="stage" destinations={destinations} currentColumnId="backlog" next={nextStage(workflow, 'backlog')} movingTo={null} blocked={false} onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Plan' }));
    expect(onMove).toHaveBeenCalledWith(workflow.columns[1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'done' } });
    expect(onMove).toHaveBeenCalledWith(workflow.columns[2]);
  });

  it('names a restricted next stage and hides the action in the last stage', () => {
    const first = render(<DrawerStageControl id="stage" destinations={transitionDestinations(restrictedFlow, 'backlog')} currentColumnId="backlog" next={nextStage(restrictedFlow, 'backlog')} movingTo={null} blocked={false} onMove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Move to Plan, requires confirmation' })).toBeTruthy();
    first.unmount();
    render(<DrawerStageControl id="stage" destinations={destinations} currentColumnId="done" next={nextStage(workflow, 'done')} movingTo={null} blocked={false} onMove={() => {}} />);
    expect(screen.queryByRole('button', { name: /Move to/ })).toBeNull();
  });

  it('refuses a stale recorded transition instead of moving', () => {
    const onMove = vi.fn();
    const onRefuse = vi.fn();
    const message = 'The recorded transition is no longer a configured transition of the Backlog stage.';
    render(<DrawerStageControl id="stage" destinations={destinations} currentColumnId="backlog" staleNext={message} movingTo={null} blocked={false} onMove={onMove} onRefuse={onRefuse} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recorded transition unavailable: ' + message }));
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('disables both controls while the task is blocked and reflects the moving stage', () => {
    render(<DrawerStageControl id="stage" destinations={destinations} currentColumnId="backlog" next={nextStage(workflow, 'backlog')} movingTo="plan" blocked={false} onMove={() => {}} />);
    expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move to Plan' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Move task to' }) as HTMLSelectElement).value).toBe('plan');
  });
});

describe('DrawerActions', () => {
  const view = () => autoModeView(task(), workflow);

  it('toggles auto mode, deletes, and closes through its callbacks', () => {
    const onToggle = vi.fn(); const onDelete = vi.fn(); const onClose = vi.fn();
    render(<DrawerActions autoMode={view()} autoModePending={false} onToggleAutoMode={onToggle} blocked={false} onDelete={onDelete} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on auto mode' }));
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables delete while blocked and omits the auto control without a toggle', () => {
    const { rerender } = render(<DrawerActions autoMode={view()} autoModePending={false} onToggleAutoMode={() => {}} blocked onDelete={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('button', { name: 'Delete task' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<DrawerActions autoModePending={false} blocked={false} onDelete={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /auto mode/i })).toBeNull();
  });
});

describe('DrawerSectionNav', () => {
  const activity = { running: true, background: [{ kind: 'job' as const, label: 'Run tests' }] };

  it('names the Conversations tab with its activity and carries the dot', () => {
    const onSelect = vi.fn();
    render(<DrawerSectionNav id="sections" sections={['Conversations', 'Info', 'Notes']} selected="Conversations" onSelect={onSelect} activity={activity} />);
    const conversations = screen.getByRole('tab', { name: 'Conversations, Agent running. Background activity: Run tests' });
    expect(conversations.querySelector('.kb-activity-dot')).toBeTruthy();
    expect(conversations.getAttribute('title')).toBe('Conversations, Agent running. Background activity: Run tests');
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    expect(onSelect).toHaveBeenCalledWith('Info');
  });

  it('leaves the Conversations name alone while idle', () => {
    render(<DrawerSectionNav id="sections" sections={['Conversations', 'Info', 'Notes']} selected="Conversations" onSelect={() => {}} activity={{ running: false, background: [] }} />);
    expect(screen.getByRole('tab', { name: 'Conversations' }).querySelector('.kb-activity-dot')).toBeNull();
  });

  it('exposes the History section by name, after Notes', () => {
    const onSelect = vi.fn();
    const sections = ['Conversations', 'Info', 'Git', 'Notes', 'History'] as const;
    render(<DrawerSectionNav id="sections" sections={sections} selected="History" onSelect={onSelect} activity={{ running: false, background: [] }} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual([...sections]);
    expect(screen.getByRole('tab', { name: 'History' }).querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(onSelect).toHaveBeenCalledWith('Notes');
  });
});
