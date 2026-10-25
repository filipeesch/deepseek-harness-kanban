// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskDrawer } from '../../src/client/drawer.js';
import { createTaskPageState } from '../../src/client/page-state.js';
import type { DraftResult, InstructionDraftPort } from '../../src/client/instruction-draft.js';
import type { DrawerSubagentAddress } from '../../src/client/conversation-navigation.js';
import { fakeApi, fixture } from './helpers.js';

afterEach(cleanup);
const child: DrawerSubagentAddress = { parentSessionId: 's1', childSessionId: 'child-1', mode: 'continuable' };
function draft() {
  const prepare = vi.fn(async (): Promise<DraftResult> => 'applied');
  const replace = vi.fn(async (): Promise<DraftResult> => 'applied');
  const port: InstructionDraftPort = { prepare, replace, attach: () => () => {} };
  return { port, prepare, replace };
}
function mount(options: { initialPeek?: DrawerSubagentAddress; draftPort?: InstructionDraftPort; onPeek?: (target: DrawerSubagentAddress | null) => void; onMove?: () => Promise<boolean> } = {}) {
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
      {...(options.draftPort === undefined ? {} : { draftPort: options.draftPort })}
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

  it('clears the peek before a stage instruction targets the active root composer', async () => {
    const { prepare, port } = draft(); const onPeek = vi.fn();
    mount({ initialPeek: child, draftPort: port, onPeek });
    await screen.findByRole('tab', { name: 'Agent 1' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Agent 1' }).getAttribute('aria-selected')).toBe('true'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Move task to' }), { target: { value: 'review' } });
    await waitFor(() => expect(onPeek).toHaveBeenCalledWith(null));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('s1', 'Review **carefully**.', expect.any(AbortSignal)));
  });
});
