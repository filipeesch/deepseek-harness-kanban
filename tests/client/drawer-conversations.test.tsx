// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDrawer } from '../../src/client/drawer.js';
import { ConversationCloseAction } from '../../src/client/conversation-actions.js';
import { createTaskPageState } from '../../src/client/page-state.js';
import type { DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';
import type { Attention } from '../../src/shared/types.js';
import { deferred, fakeApi, fixture, type TestSnapshot } from './helpers.js';
import { NO_PENDING_USER_WORK } from '../../src/shared/types.js';

afterEach(cleanup);
const child: DrawerSubagentAddress = { parentSessionId: 's1', childSessionId: 'child-1', mode: 'continuable' };
function mount(options: { initialPeek?: DrawerSubagentAddress; onPeek?: (target: DrawerSubagentAddress | null) => void; onMove?: () => Promise<boolean>; data?: TestSnapshot; renderConversation?: (id: string, target?: DrawerSubagentAddress) => React.ReactNode } = {}) {
  const data = options.data ?? fixture(); const mock = fakeApi(data); const renderConversation = options.renderConversation === undefined
    ? vi.fn((id: string, target?: DrawerSubagentAddress) => <div data-testid={'native-' + id} data-target={target?.childSessionId}><ConversationCloseAction /></div>)
    : vi.fn(options.renderConversation);
  const onPeek = options.onPeek ?? vi.fn();
  function Harness() {
    const [live, setLive] = useState<TestSnapshot>(data);
    const [viewState] = useState(createTaskPageState);
    const [peek, setPeek] = useState<DrawerSubagentAddress | null>(options.initialPeek ?? null);
    useEffect(() => mock.api.subscribe(snapshot => setLive(snapshot as TestSnapshot)), []);
    const update = (target: DrawerSubagentAddress | null) => { onPeek(target); setPeek(target); };
    return <TaskDrawer
      task={live.state.tasks[0]!}
      state={live.state}
      api={mock.api}
      run={mock.api.command}
      renderConversation={renderConversation}
      onClose={() => {}}
      onMove={options.onMove ?? (async () => true)}
      onDanger={() => {}}
      viewState={viewState}
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

  it('hides the close action during a peek and closes the active root after exiting it', async () => {
    const { onPeek, command, get } = mount({ initialPeek: child });
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(screen.queryByRole('button', { name: 'Close Agent 1' })).toBeNull();
    fireEvent.click(agentTabs().getByRole('tab', { name: 'Agent 1' }));
    expect(onPeek).toHaveBeenCalledWith(null);
    const before = [...get().state.tasks[0]!.sessionIds];
    fireEvent.click(await screen.findByRole('button', { name: 'Close Agent 1' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'conversation.close', taskId: 't1', sessionId: 's1' }));
    expect(get().state.tasks[0]!.sessionIds).toEqual(before);
  });

  it('moves closed conversations into the chip and reopens from the popover', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    const { command, renderConversation } = mount({ data });
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(screen.queryByText(/Closed conversations \(/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 closed conversation' }));
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Agent 2' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'conversation.reopen', taskId: 't1', sessionId: 's2' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Closed conversations' })).toBeNull());
    await waitFor(() => expect(renderConversation).toHaveBeenLastCalledWith('s2', undefined));
    await waitFor(() => expect(document.activeElement).toBe(agentTabs().getByRole('tab', { name: 'Agent 2' })));
  });

  it('keeps a reopen failure inside the popover', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    const { command } = mount({ data });
    await screen.findByRole('tab', { name: 'Agent 1' });
    vi.mocked(command).mockRejectedValueOnce({ code: 'REOPEN_FAILED', message: 'Cannot reopen this conversation.' });
    fireEvent.click(screen.getByRole('button', { name: '1 closed conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Agent 2' }));
    await waitFor(() => expect(screen.getByText('Cannot reopen this conversation.')).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    expect(screen.getAllByText('Cannot reopen this conversation.')).toHaveLength(1);
  });

  it('keeps the popover open while a reopen is pending so its failure stays visible', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    const { command } = mount({ data });
    await screen.findByRole('tab', { name: 'Agent 1' });
    const pending = deferred<TestSnapshot>();
    vi.mocked(command).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '1 closed conversation' }));
    const row = screen.getByRole('button', { name: 'Reopen Agent 2' });
    fireEvent.click(row);
    await waitFor(() => expect(row.getAttribute('aria-disabled')).toBe('true'));
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    await act(async () => { pending.reject({ code: 'REOPEN_FAILED', message: 'Cannot reopen while pending.' }); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('Cannot reopen while pending.')).toBeTruthy());
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    expect(document.activeElement).toBe(row);
    expect(screen.getAllByText('Cannot reopen while pending.')).toHaveLength(1);
  });

  it('reopens a non-last closed conversation and focuses its tab while the chip remains', async () => {
    const data = fixture();
    data.state.tasks[0]!.sessionIds = ['s1', 's2', 's3'];
    data.state.tasks[0]!.closedSessionIds = ['s2', 's3'];
    mount({ data });
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(screen.getByRole('button', { name: '2 closed conversations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Agent 2' }));
    await waitFor(() => expect(document.activeElement).toBe(agentTabs().getByRole('tab', { name: 'Agent 2' })));
    expect(screen.getByRole('button', { name: '1 closed conversation' })).toBeTruthy();
  });

  it('disables the header close action while a close command is pending', async () => {
    const { command } = mount();
    await screen.findByRole('tab', { name: 'Agent 1' });
    const pending = deferred<TestSnapshot>();
    vi.mocked(command).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent 1' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close Agent 1' }) as HTMLButtonElement).disabled).toBe(true));
    await act(async () => { pending.resolve(fixture()); await Promise.resolve(); });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close Agent 1' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows a close failure in the toolbar notices', async () => {
    const { command } = mount();
    await screen.findByRole('tab', { name: 'Agent 1' });
    vi.mocked(command).mockRejectedValueOnce({ code: 'CLOSE_FAILED', message: 'Cannot close this conversation.' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent 1' }));
    await waitFor(() => expect(screen.getByText('Cannot close this conversation.')).toBeTruthy());
    expect(screen.getByText('CLOSE_FAILED')).toBeTruthy();
  });

  it('keeps the close action when the native conversation render fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('render failed'); };
    const { command } = mount({ renderConversation: () => <Boom /> });
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(await screen.findByText('render failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent 1' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'conversation.close', taskId: 't1', sessionId: 's1' }));
    consoleError.mockRestore();
  });

  it('explains a persisted selection problem after the drawer section remounts', async () => {
    const { command } = mount();
    await screen.findByRole('tab', { name: 'Agent 1' });
    vi.mocked(command).mockResolvedValueOnce(fixture());
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(screen.getByText('CREATION_RECEIPT_REQUIRED')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Info' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Conversations' }));
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(screen.getByText('Select a conversation tab explicitly before creating another conversation.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the all-closed empty state without duplicating the reopen list', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s1', 's2'];
    mount({ data });
    await screen.findByRole('button', { name: '2 closed conversations' });
    expect(screen.getByText('All conversations are closed. Use + to start a new one, or reopen one from the closed conversations above.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Closed conversations' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reopen / })).toBeNull();
  });

  it('hides the closed-conversations control when every tab is open', async () => {
    mount();
    await screen.findByRole('tab', { name: 'Agent 1' });
    expect(screen.queryByRole('button', { name: /closed conversation/ })).toBeNull();
  });

  it('dismisses the popover on an outside pointer and returns focus to the chip', async () => {
    const data = fixture(); data.state.tasks[0]!.closedSessionIds = ['s2'];
    mount({ data });
    await screen.findByRole('tab', { name: 'Agent 1' });
    const chip = screen.getByRole('button', { name: '1 closed conversation' });
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Closed conversations' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Closed conversations' })).toBeNull());
    expect(document.activeElement).toBe(chip);
  });

  it('keeps a creation receipt failure in the toolbar notices', async () => {
    const { command } = mount();
    await screen.findByRole('tab', { name: 'Agent 1' });
    vi.mocked(command).mockResolvedValueOnce(fixture());
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(screen.getByText('CREATION_RECEIPT_REQUIRED')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
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
  const attention = (overrides: Partial<Attention> = {}): Attention => ({ running: false, background: [], unread: false, awaitingReply: false, failed: false, pending: NO_PENDING_USER_WORK, ...overrides });
  function mountAttention(taskPatch: (task: ReturnType<typeof fixture>['state']['tasks'][number]) => ReturnType<typeof fixture>['state']['tasks'][number], initial: Record<string, Attention>) {
    const data = fixture(); const mock = fakeApi(data);
    const task = taskPatch(data.state.tasks[0]!);
    const renderConversation = vi.fn((id: string) => <div data-testid={'native-' + id} />);
    const props = (conversationAttention: Record<string, Attention>) => ({ task, state: data.state, api: mock.api, run: mock.api.command, renderConversation, onClose: () => {}, onMove: async () => true, onDanger: () => {}, viewState: createTaskPageState(), conversationAttention });
    const view = render(<TaskDrawer {...props(initial)} />);
    return { ...view, props };
  }

  it('shows each conversation status on its own tab and updates the dots live', async () => {
    const { rerender, props } = mountAttention(task => task, { s1: attention({ unread: true, awaitingReply: true }), s2: attention({ failed: true, pending: NO_PENDING_USER_WORK }) });
    const tabs = await screen.findByRole('tablist', { name: 'Agent conversations' });
    expect(within(tabs).getByRole('tab', { name: /Agent 1 Unread messages, Awaiting reply/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /Agent 2 Agent failure/ })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: /Agent 1/ }).querySelectorAll('.kb-dot')).toHaveLength(2);
    expect(within(tabs).getByRole('tab', { name: /Agent 2/ }).querySelectorAll('.kb-dot')).toHaveLength(1);
    rerender(<TaskDrawer {...props({ s1: attention(), s2: attention({ failed: true, pending: NO_PENDING_USER_WORK }) })} />);
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: 'Agent 1' }).querySelectorAll('.kb-dot')).toHaveLength(0));
    expect(within(tabs).getByRole('tab', { name: /Agent 2 Agent failure/ }).querySelectorAll('.kb-dot')).toHaveLength(1);
  });

  it('keeps the dots out of closed-conversation entries', async () => {
    const { getByRole } = mountAttention(task => ({ ...task, closedSessionIds: ['s2'] }), { s1: attention(), s2: attention({ unread: true, failed: true, pending: NO_PENDING_USER_WORK }) });
    await screen.findByRole('tab', { name: 'Agent 1' });
    fireEvent.click(getByRole('button', { name: '1 closed conversation' }));
    const reopen = getByRole('button', { name: 'Reopen Agent 2' });
    expect(reopen.querySelectorAll('.kb-dot')).toHaveLength(0);
    expect(reopen.textContent).not.toContain('Unread messages');
    expect(reopen.textContent).not.toContain('Agent failure');
  });
});
