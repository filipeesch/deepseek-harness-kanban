// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDrawer } from '../../src/client/drawer.js';
import { createTaskPageState } from '../../src/client/page-state.js';
import type { DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';
import type { Attention } from '../../src/shared/types.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const child: DrawerSubagentAddress = { parentSessionId: 's1', childSessionId: 'child-1', mode: 'continuable' };
function mount(options: { initialPeek?: DrawerSubagentAddress; onPeek?: (target: DrawerSubagentAddress | null) => void; onMove?: () => Promise<boolean> } = {}) {
  const data = fixture(); const mock = fakeApi(data); const renderConversation = vi.fn((id: string, target?: DrawerSubagentAddress) => <div data-testid={'native-' + id} data-target={target?.childSessionId} />);
  const onPeek = options.onPeek ?? vi.fn();
  function Harness() {
    const [peek, setPeek] = useState<DrawerSubagentAddress | null>(options.initialPeek ?? null);
    const update = (target: DrawerSubagentAddress | null) => { onPeek(target); setPeek(target); };
    return <TaskDrawer
      task={data.state.tasks[0]!}
      state={data.state}
      api={mock.api}
      run={mock.api.command}
      renderConversation={renderConversation}
      onClose={() => {}}
      onMove={options.onMove ?? (async () => true)}
      onDanger={() => {}}
      viewState={createTaskPageState()}
      peek={peek}
      onPeek={update}
    />;
  }
  const view = render(<Harness />);
  return { ...mock, renderConversation, onPeek, ...view };
}
function agentTabs() { return within(screen.getByRole('tablist', { name: 'Agent conversations' })); }

describe('drawer conversation peek', () => {
  it('clears the peek when the drawer closes or switches task identity', async () => {
    const data = fixture(); const mock = fakeApi(data); const onPeek = vi.fn();
    const renderConversation = vi.fn((id: string) => <div data-testid={'native-' + id} />);
    function Harness() {
      const [taskIndex, setTaskIndex] = useState(0); const [peek, setPeek] = useState<DrawerSubagentAddress | null>(child); const [closing, setClosing] = useState(false);
      const update = (target: DrawerSubagentAddress | null) => { onPeek(target); setPeek(target); };
      return <><button onClick={() => setTaskIndex(1)}>Switch task</button><button onClick={() => setClosing(true)}>Start close</button><TaskDrawer
        task={data.state.tasks[taskIndex]!}
        state={data.state}
        api={mock.api}
        run={mock.api.command}
        renderConversation={renderConversation}
        onClose={() => {}}
        onMove={async () => true}
        onDanger={() => {}}
        viewState={createTaskPageState()}
        peek={peek}
        onPeek={update}
        closing={closing}
      /></>;
    }
    render(<Harness />);
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch task' }));
    await waitFor(() => expect(onPeek).toHaveBeenCalledWith(null));
    fireEvent.click(screen.getByRole('button', { name: 'Start close' }));
    await waitFor(() => expect(onPeek).toHaveBeenCalledTimes(2));
  });

  it('renders an owned child in place while keeping root task tabs', async () => {
    const { renderConversation, command } = mount({ initialPeek: child });
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(renderConversation).toHaveBeenCalledWith('child-1', child);
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByTestId('native-child-1').getAttribute('data-target')).toBe('child-1');
    expect(agentTabs().getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Agent 1', 'Agent 2']);
  });

  it('exits the peek when a root tab is selected', async () => {
    const { renderConversation, onPeek } = mount({ initialPeek: child });
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(agentTabs().getByRole('tab', { name: 'Agent 1' }));
    expect(onPeek).toHaveBeenCalledWith(null);
    await waitFor(() => expect(renderConversation).toHaveBeenLastCalledWith('s1', undefined));
  });

  it('clears the peek when the active root is closed without changing task session ids', async () => {
    const { onPeek, command, get } = mount({ initialPeek: child });
    await screen.findByRole('tab', { name: 'Agent 1' });
    const before = [...get().state.tasks[0]!.sessionIds];
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent 1' }));
    expect(onPeek).toHaveBeenCalledWith(null);
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'conversation.close', taskId: 't1', sessionId: 's1' }));
    expect(get().state.tasks[0]!.sessionIds).toEqual(before);
  });

  it('clears the peek when the drawer leaves Conversations or creates another conversation', async () => {
    const { onPeek } = mount({ initialPeek: child });
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    expect(onPeek).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('tab', { name: 'Conversations' }));
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(onPeek).toHaveBeenCalledWith(null));
  });
});

describe('conversation tab attention', () => {
  const attention = (overrides: Partial<Attention> = {}): Attention => ({ running: false, background: [], unread: false, awaitingReply: false, failed: false, ...overrides });
  function mountAttention(taskPatch: (task: ReturnType<typeof fixture>['state']['tasks'][number]) => ReturnType<typeof fixture>['state']['tasks'][number], initial: Record<string, Attention>) {
    const data = fixture(); const mock = fakeApi(data);
    const task = taskPatch(data.state.tasks[0]!);
    const renderConversation = vi.fn((id: string) => <div data-testid={'native-' + id} />);
    const props = (conversationAttention: Record<string, Attention>) => ({ task, state: data.state, api: mock.api, run: mock.api.command, renderConversation, onClose: () => {}, onMove: async () => true, onDanger: () => {}, viewState: createTaskPageState(), conversationAttention });
    const view = render(<TaskDrawer {...props(initial)} />);
    return { ...view, props };
  }

  it('shows each conversation status on its own tab and updates the dots live', async () => {
    const { rerender, props } = mountAttention(task => task, { s1: attention({ unread: true, awaitingReply: true }), s2: attention({ failed: true }) });
    const tabs = await screen.findByRole('tablist', { name: 'Agent conversations' });
    expect(within(tabs).getByRole('tab', { name: /Agent 1 Unread messages, Awaiting reply/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /Agent 2 Agent failure/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /Agent 1/ }).querySelectorAll('.kb-dot')).toHaveLength(2);
    expect(within(tabs).getByRole('tab', { name: /Agent 2/ }).querySelectorAll('.kb-dot')).toHaveLength(1);
    rerender(<TaskDrawer {...props({ s1: attention(), s2: attention({ failed: true }) })} />);
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: 'Agent 1' }).querySelectorAll('.kb-dot')).toHaveLength(0));
    expect(within(tabs).getByRole('tab', { name: /Agent 2 Agent failure/ }).querySelectorAll('.kb-dot')).toHaveLength(1);
  });

  it('keeps the dots out of closed-conversation entries', async () => {
    const { getByRole } = mountAttention(task => ({ ...task, closedSessionIds: ['s2'] }), { s1: attention(), s2: attention({ unread: true, failed: true }) });
    await screen.findByRole('tab', { name: 'Agent 1' });
    const reopen = getByRole('button', { name: 'Reopen Agent 2' });
    expect(reopen.querySelectorAll('.kb-dot')).toHaveLength(0);
    expect(reopen.textContent).not.toContain('Unread messages');
    expect(reopen.textContent).not.toContain('Agent failure');
  });
});
