// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import type { Command, ConversationPresetOutcome } from '../../src/shared/types.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';
import { PresetProvider, presetPort } from './agent-preset-fixture.js';

afterEach(cleanup);

const fallback: ConversationPresetOutcome = { requested: 'standard', applied: false, reason: 'unavailable' };

function boardNamingAPreset(preset: string | undefined = 'standard'): TestSnapshot {
  const data = fixture();
  const board = data.state.hubs[0]!.boards[0]!;
  board.workflow = { ...board.workflow, ...(preset === undefined ? {} : { agentPreset: preset }) };
  return data;
}

function mount(options: { preset?: ConversationPresetOutcome; data?: TestSnapshot } = {}) {
  const mock = fakeApi(options.data ?? boardNamingAPreset(), options.preset === undefined ? {} : { conversationPreset: options.preset });
  render(
    <PresetProvider port={presetPort()}>
      <BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} />
    </PresetProvider>,
  );
  return { ...mock, user: userEvent.setup() };
}

async function createConversation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
  await user.click(await screen.findByRole('button', { name: 'New conversation' }));
  const cards = await screen.findByRole('group', { name: 'Start a conversation' });
  await user.click(within(cards).getByRole('button', { name: /Standard/ }));
  await screen.findAllByTestId(/^native-/);
}

async function noticeText(): Promise<string> {
  const heading = await screen.findByText('Board preset unavailable');
  const container = heading.closest('.kb-preset-notice') as HTMLElement;
  expect(container.getAttribute('role')).toBe('status');
  return container.textContent ?? '';
}

function expectNoNotice(): void {
  expect(screen.queryByText('Board preset unavailable')).toBeNull();
}

describe('conversation preset fallback notice', () => {
  it('names the requested preset and the host default it started on', async () => {
    const { user } = mount({ preset: fallback });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('This host does not offer standard.');
    expect(copy).toContain('This conversation started on the host default preset.');
  });

  it('says the host could not be asked when the host itself failed', async () => {
    const { user } = mount({ preset: { requested: 'standard', applied: false, reason: 'failed' } });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('The host could not be asked to apply standard to this conversation.');
    expect(copy).not.toContain('does not offer');
  });

  it('says the host cannot scope a preset to one conversation when it has no such face', async () => {
    const { user } = mount({ preset: { requested: 'standard', applied: false, reason: 'unsupported' } });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('This host cannot apply standard to one conversation.');
    expect(copy).not.toContain('does not offer');
  });

  it('dismisses the notice without recording anything and keeps it dismissed across sections', async () => {
    const { user, command } = mount({ preset: fallback });
    await createConversation(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expectNoNotice();
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    await user.click(screen.getByRole('tab', { name: /^Conversations/ }));
    expectNoNotice();
    // Nothing about the fallback is saved: the only command of this flow is the creation.
    expect(command.mock.calls.map(call => (call[0] as Command).type)).toEqual(['conversation.create']);
  });

  it('announces again when the conversation is reopened', async () => {
    const { user } = mount({ preset: fallback });
    await createConversation(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expectNoNotice();
    await user.click(await screen.findByRole('button', { name: /^Close Agent/ }));
    const chip = await screen.findByRole('button', { name: /closed conversation/ });
    await user.click(chip);
    await user.click(await screen.findByRole('button', { name: /Reopen / }));
    expect(await noticeText()).toContain('host default preset');
  });

  it('stays silent when the board preset was applied', async () => {
    const { user } = mount({ preset: { requested: 'standard', applied: true } });
    await createConversation(user);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New conversation' })).toBeTruthy());
    expectNoNotice();
  });

  it('stays silent when the board names no preset', async () => {
    const { user } = mount({ data: boardNamingAPreset(undefined) });
    await createConversation(user);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New conversation' })).toBeTruthy());
    expectNoNotice();
  });
});
