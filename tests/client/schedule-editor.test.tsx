// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ClientApi, KanbanSnapshot, ScheduleModelCatalog } from '../../src/shared/types.js';
import { ScheduleEditorDialog } from '../../src/client/settings/schedules/schedule-editor-dialog.js';

afterEach(cleanup);

const projects = [{ id: 'p1', projectKey: 'web', name: 'Web', projectPath: '/web' }];
const catalog: ScheduleModelCatalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }], failures: [] };

function harness(options: { catalogFailure?: boolean; schedule?: Parameters<typeof ScheduleEditorDialog>[0]['schedule'] } = {}) {
  const run = vi.fn(async (_command: unknown) => ({}) as KanbanSnapshot);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const api = {
    modelCatalog: options.catalogFailure === true ? vi.fn(async () => { throw new Error('catalog offline'); }) : vi.fn(async () => catalog),
  } as unknown as ClientApi;
  return { run, onSaved, onClose, api };
}

function mount(harnessed: ReturnType<typeof harness>, schedule?: Parameters<typeof ScheduleEditorDialog>[0]['schedule'], revision = 4) {
  return render(<ScheduleEditorDialog hubId="hub" expectedRevision={revision} projects={projects} api={harnessed.api} run={harnessed.run} onClose={harnessed.onClose} onSaved={harnessed.onSaved} {...(schedule === undefined ? {} : { schedule })} />);
}

function storedSchedule(overrides: Partial<Parameters<typeof ScheduleEditorDialog>[0]['schedule'] & object> = {}) {
  return {
    id: 'schedule', title: 'Stored', prompt: 'Do it', cron: '0 9 * * *', timeZone: 'UTC', projectId: 'p1',
    newConversation: true, archiveWhenIdle: true, enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('ScheduleEditorDialog', () => {
  it('previews a new schedule from its defaults', () => {
    const harnessed = harness();
    mount(harnessed);
    expect(screen.getByRole('dialog', { name: 'New schedule' })).toBeTruthy();
    expect((screen.getByLabelText('Cron expression') as HTMLInputElement).value).toBe('0 9 * * *');
    expect(screen.getByText('Every day at 09:00')).toBeTruthy();
    expect(screen.getByText(/^Next: /)).toBeTruthy();
  });

  it('saves a valid schedule and closes through the callback', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed);
    await user.type(screen.getByLabelText('Schedule title'), 'Morning review');
    await user.type(screen.getByLabelText('Prompt'), 'Summarize the pull requests.');
    await user.selectOptions(screen.getByLabelText('Project'), 'p1');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(harnessed.run).toHaveBeenCalledTimes(1));
    expect(harnessed.run).toHaveBeenCalledWith(expect.objectContaining({
      type: 'schedule.save', hubId: 'hub', title: 'Morning review', prompt: 'Summarize the pull requests.',
      cron: '0 9 * * *', projectId: 'p1', newConversation: true, archiveWhenIdle: true, expectedRevision: 4,
    }));
    expect(harnessed.onSaved).toHaveBeenCalled();
  });

  it('refuses an invalid expression without sending a command', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed);
    await user.type(screen.getByLabelText('Schedule title'), 'Broken');
    await user.type(screen.getByLabelText('Prompt'), 'Do it');
    await user.selectOptions(screen.getByLabelText('Project'), 'p1');
    const cron = screen.getByLabelText('Cron expression');
    await user.clear(cron);
    await user.type(cron, '61 * * * *');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(harnessed.run).not.toHaveBeenCalled();
    expect(screen.getByText(/Expected minute between 0 and 59/)).toBeTruthy();
  });

  it('fills the expression from a quick choice', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed);
    await user.selectOptions(screen.getByLabelText('Quick schedule'), 'weekly');
    expect((screen.getByLabelText('Cron expression') as HTMLInputElement).value).toBe('0 0 * * 1');
    expect(screen.getByText('Every Monday at 00:00')).toBeTruthy();
  });

  it('disables archiving for a continuous conversation', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed);
    const archive = screen.getByLabelText('Archive when idle') as HTMLInputElement;
    expect(archive.disabled).toBe(false);
    await user.click(screen.getByLabelText('New conversation per run'));
    expect(archive.disabled).toBe(true);
    expect(archive.checked).toBe(false);
  });

  it('keeps a stored selection and selects a catalog model', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed, {
      id: 'schedule', title: 'Stored', prompt: 'Do it', cron: '0 9 * * *', timeZone: 'UTC', projectId: 'p1',
      model: { provider: 'deepseek', model: 'reason' }, newConversation: true, archiveWhenIdle: true, enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(false));
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('deepseek::reason');
    await user.selectOptions(screen.getByLabelText('Model'), 'deepseek::chat');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(harnessed.run).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: 'deepseek', model: 'chat' }, scheduleId: 'schedule' })));
  });


  it('keeps the revision captured when the editor opened', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    const view = mount(harnessed);
    await user.type(screen.getByLabelText('Schedule title'), 'Revision');
    await user.type(screen.getByLabelText('Prompt'), 'Do it');
    await user.selectOptions(screen.getByLabelText('Project'), 'p1');
    view.rerender(<ScheduleEditorDialog hubId="hub" expectedRevision={9} projects={projects} api={harnessed.api} run={harnessed.run} onClose={harnessed.onClose} onSaved={harnessed.onSaved} />);
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(harnessed.run).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 })));
  });

  it('preserves and edits the stored reasoning effort and clears it on a route change', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed, storedSchedule({ model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' } }));
    await waitFor(() => expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('high'));
    await user.selectOptions(screen.getByLabelText('Reasoning effort'), 'low');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(harnessed.run).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'low' } })));
    cleanup();
    const second = harness();
    mount(second, storedSchedule({ model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' } }));
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(screen.getByLabelText('Model'), 'deepseek::chat');
    expect(screen.queryByLabelText('Reasoning effort')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(second.run).toHaveBeenCalledWith(expect.objectContaining({ model: { provider: 'deepseek', model: 'chat' } })));
  });

  it('refreshes the catalog when it opens and blocks a model outside it', async () => {
    const user = userEvent.setup();
    const harnessed = harness();
    mount(harnessed, storedSchedule({ model: { provider: 'deepseek', model: 'gone' } }));
    await waitFor(() => expect(harnessed.api.modelCatalog).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText(/not in the host catalog/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(harnessed.run).not.toHaveBeenCalled();
    expect(screen.getByText(/Choose a model from the host catalog/)).toBeTruthy();
  });

  it('reports an unavailable catalog without blocking the stored model', async () => {
    const harnessed = harness({ catalogFailure: true });
    mount(harnessed);
    await waitFor(() => expect(screen.getByText(/The model catalog is unavailable/)).toBeTruthy());
  });
});