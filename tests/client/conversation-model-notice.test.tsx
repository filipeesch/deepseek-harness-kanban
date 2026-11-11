// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import type { Command, ConversationModelOutcome, ModelSelection } from '../../src/shared/types.js';
import { fakeApi, fixture, type TestSnapshot } from './helpers.js';
import { PresetProvider, presetPort } from './agent-preset-fixture.js';

afterEach(cleanup);

/** The route the board names, and the one this host actually runs. */
const requested: ModelSelection = { provider: 'deepseek', model: 'reason' };
const inUse: ModelSelection = { provider: 'deepseek', model: 'chat' };
const fallback: ConversationModelOutcome = { requested, applied: false, reason: 'unavailable', inUse };

function boardNamingAModel(): TestSnapshot {
  const data = fixture();
  const board = data.state.hubs[0]!.boards[0]!;
  board.workflow = { ...board.workflow, model: requested };
  return data;
}

function taskWithoutConversation(): TestSnapshot {
  const data = boardNamingAModel();
  const task = data.state.tasks[0]!;
  task.sessionIds = [];
  task.closedSessionIds = [];
  return data;
}

/** The same board with an instructed initial stage, so creating a task starts one. */
function boardStartingCreatedTasks(): TestSnapshot {
  const data = boardNamingAModel();
  data.state.hubs[0]!.boards[0]!.workflow.columns.find(column => column.id === 'intake')!.onEnterPrompt = 'Start work.';
  return data;
}

function mount(options: { model?: ConversationModelOutcome; data?: TestSnapshot } = {}) {
  const mock = fakeApi(options.data ?? boardNamingAModel(), options.model === undefined ? {} : { conversationModel: options.model });
  render(
    <PresetProvider port={presetPort()}>
      <BoardView api={mock.api} renderConversation={id => <div data-testid={'native-' + id} />} />
    </PresetProvider>,
  );
  return { ...mock, user: userEvent.setup() };
}

/** Open the drawer and start a conversation from the preset cards, as a person does. */
async function createConversation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
  await createConversationInDrawer(user);
}

async function createConversationInDrawer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'New conversation' }));
  const cards = await screen.findByRole('group', { name: 'Start a conversation' });
  await user.click(within(cards).getByRole('button', { name: /Standard/ }));
  await screen.findAllByTestId(/^native-/);
}

async function prepareFirstExecution(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Move task to' }), 'review');
  const preparation = await screen.findByRole('dialog', { name: 'Prepare the first execution' });
  await user.click(within(preparation).getByRole('button', { name: 'Continue in base project' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** The notice as one whole: its heading, its sentence, and that it is a live hint. */
async function noticeText(): Promise<string> {
  const heading = await screen.findByText('Board model unavailable');
  const container = heading.closest('.kb-model-notice') as HTMLElement;
  expect(container.getAttribute('role')).toBe('status');
  return container.textContent ?? '';
}

async function expectNoNotice(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('button', { name: 'New conversation' })).toBeTruthy());
  expect(screen.queryByText('Board model unavailable')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
}

describe('conversation model fallback notice', () => {
  it('names the board model, the host that does not offer it, and the model in use', async () => {
    const { user } = mount({ model: fallback });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('This host does not offer deepseek · reason.');
    expect(copy).toContain('This conversation started on deepseek · chat.');
    // The route the board wanted is named once; the sentence does not repeat it.
    expect(copy.match(/deepseek · reason/gu)).toHaveLength(1);
  });

  it('says the host could not be asked when the host itself failed, and does not blame the model', async () => {
    const { user } = mount({ model: { requested, applied: false, reason: 'failed', inUse } });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('The host could not be asked to apply deepseek · reason to this conversation.');
    expect(copy).toContain('deepseek · chat');
    expect(copy).not.toContain('does not offer');
  });

  it('says the host cannot scope a model to one conversation when it has no such face', async () => {
    const { user } = mount({ model: { requested, applied: false, reason: 'unsupported', inUse } });
    await createConversation(user);
    const copy = await noticeText();
    expect(copy).toContain('This host cannot apply deepseek · reason to one conversation without changing the installation default.');
    expect(copy).not.toContain('does not offer');
  });

  it('names the host default when the catalog could not say what is in use', async () => {
    const { user } = mount({ model: { requested, applied: false, reason: 'failed' } });
    await createConversation(user);
    expect(await noticeText()).toContain('This conversation started on the host default model');
  });

  it('shows the same notice for a conversation the board created with a new task', async () => {
    const { user, command } = mount({ model: fallback, data: boardStartingCreatedTasks() });
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Started task');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project' }), 'p1');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    // The only announcement of the model this automatic creation started on is the
    // command receipt, so this is the path that proves the board reads it.
    await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.prepareFirstExecution' })));
    expect(await noticeText()).toContain('deepseek · chat');
  });

  it('dismisses the notice without recording anything', async () => {
    const { user, command } = mount({ model: fallback });
    await createConversation(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Board model unavailable')).toBeNull();
    // Nothing about the fallback is saved: the only command of this flow is the creation.
    expect(command.mock.calls.map(call => (call[0] as Command).type)).toEqual(['conversation.create']);
  });

  it('keeps the notice dismissed across the other sections of the same drawer', async () => {
    const { user } = mount({ model: fallback });
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    await createConversationInDrawer(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Leaving the section and coming back is not a reason to say it again.
    await user.click(screen.getByRole('tab', { name: 'Git' }));
    await user.click(screen.getByRole('tab', { name: /^Conversations/ }));
    expect(screen.queryByText('Board model unavailable')).toBeNull();
  });

  it('announces again when the conversation is reopened', async () => {
    const { user } = mount({ model: fallback });
    await createConversation(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Board model unavailable')).toBeNull();
    await user.click(await screen.findByRole('button', { name: /^Close Agent/ }));
    const chip = await screen.findByRole('button', { name: /closed conversation/ });
    await user.click(chip);
    await user.click(await screen.findByRole('button', { name: /Reopen / }));
    expect(await noticeText()).toContain('deepseek · chat');
  });

  it('announces again when the drawer is closed and opened again', async () => {
    const { user } = mount({ model: fallback });
    await createConversation(user);
    await noticeText();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Board model unavailable')).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Close task details' }));
    // The drawer holds the dismissal, so the reset is only proven once it is gone.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull(), { timeout: 2000 });
    await user.click(await screen.findByRole('button', { name: 'Open task Alpha task' }));
    expect(await noticeText()).toContain('deepseek · chat');
  });

  it('stays silent when the board model was applied', async () => {
    const { user } = mount({ model: { requested, applied: true } });
    await createConversation(user);
    await expectNoNotice();
  });

  it('stays silent when the board names no model', async () => {
    const { user } = mount({ data: fixture() });
    await createConversation(user);
    await expectNoNotice();
  });

  it('never blocks the preparation move that created the conversation', async () => {
    const { user, command } = mount({ model: fallback, data: taskWithoutConversation() });
    await prepareFirstExecution(user);
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.move', taskId: 't1', columnId: 'review' }));
    // The stage instruction is armed and sendable while the notice is on screen, and
    // the preparation reports no failure: the fallback never blocks the execution.
    const countdowns = await screen.findAllByRole('button', { name: /Cancel automatic Review instruction/ });
    await noticeText();
    expect(countdowns.every(button => (button as HTMLButtonElement).disabled === false)).toBe(true);
    expect(screen.queryByText(/could not be started|preparation failed|failed to prepare/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
