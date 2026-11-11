// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ModelCatalog, ModelSelection } from '../../src/shared/types.js';
import { ModelPickerField, modelOptionValue, modelOptions, modelRows } from '../../src/client/settings/model-picker-field.js';

afterEach(cleanup);

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  providers: [{
    id: 'deepseek', name: 'DeepSeek',
    models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }],
  }],
  failures: [],
};
const stored: ModelSelection = { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' };

/** The closed control that names the current route. */
function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Model:/ });
}

/** Open the picker and return its searchable list. */
async function open(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(trigger());
  return screen.getByRole('dialog', { name: 'Choose the model' });
}

/** Open the picker and choose one row by its visible text. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  const dialog = await open(user);
  await user.click(within(dialog).getByRole('option', { name }));
}

describe('the shared model picker', () => {
  it('offers the host default and every catalog route, and names the stored route', async () => {
    const user = userEvent.setup();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={() => {}} />);
    // A closed picker says which route is stored, which is what the plain select never did.
    expect(trigger().getAttribute('aria-label')).toBe('Model: DeepSeek · Reason');
    const dialog = await open(user);
    expect(within(dialog).getAllByRole('option').map(option => option.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(within(dialog).getByRole('option', { name: /Host default model/ })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'DeepSeek' })).toBeTruthy();
    expect(modelOptionValue(undefined)).toBe('default');
  });

  it('keeps a stored route the catalog no longer lists and says so without hiding the choice', async () => {
    const user = userEvent.setup();
    const stale: ModelSelection = { provider: 'anthropic', model: 'claude', reasoningEffort: 'high' };
    render(<ModelPickerField value={stale} catalog={catalog} onChange={() => {}} />);
    expect(trigger().getAttribute('aria-label')).toBe('Model: anthropic · claude (not in the catalog)');
    const dialog = await open(user);
    expect(within(dialog).getByRole('group', { name: 'Not in the catalog' })).toBeTruthy();
    expect(within(dialog).getByRole('option', { name: /claude \(not in the catalog\)/ }).getAttribute('aria-selected')).toBe('true');
    // The effort select still appears, offering the stored effort as its own choice.
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('high');
  });

  it('filters the routes as the person types and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={() => {}} />);
    const dialog = await open(user);
    const search = within(dialog).getByRole('combobox', { name: 'Search models' });
    await user.type(search, 'chat');
    expect(within(dialog).getAllByRole('option').map(option => option.textContent)).toEqual(['ChatDeepSeek · chat']);
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(within(dialog).queryAllByRole('option')).toHaveLength(0);
    expect(within(dialog).getByRole('status').textContent).toContain('No model matches');
  });

  it('matches a provider and an accent-insensitive fragment', async () => {
    const user = userEvent.setup();
    render(<ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} />);
    const dialog = await open(user);
    const search = within(dialog).getByRole('combobox', { name: 'Search models' });
    // Both terms must match the same row, and folding makes the provider searchable by accent.
    await user.type(search, 'deep REA');
    expect(within(dialog).getAllByRole('option').map(option => option.textContent)).toEqual(['ReasonDeepSeek · reason']);
  });

  it('moves with the arrow keys and accepts the highlighted row with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    const dialog = await open(user);
    await user.type(within(dialog).getByRole('combobox', { name: 'Search models' }), 'chat');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat' });
  });

  it('closes on Escape without choosing anything', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose the model' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never submits the form that holds it when Enter confirms a row', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => { event.preventDefault(); });
    render(<form onSubmit={submit}><ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} /></form>);
    const dialog = await open(user);
    await user.type(within(dialog).getByRole('combobox', { name: 'Search models' }), 'chat');
    await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
  });

  it('hands the caller a route with no effort when another route is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await choose(user, /Chat/);
    expect(onChange).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat' });
  });

  it('hands the caller nothing when the host default is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await choose(user, /Host default model/);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps the effort when the same route is chosen again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await choose(user, /Reason/);
    expect(onChange).toHaveBeenCalledWith(stored);
  });

  it('sets a reasoning effort, and clears it back to the model default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={{ provider: 'deepseek', model: 'reason' }} catalog={catalog} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Reasoning effort'), 'low');
    expect(onChange).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'reason', reasoningEffort: 'low' });
    await user.selectOptions(screen.getByLabelText('Reasoning effort'), '');
    expect(onChange).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'reason' });
  });

  it('drops the effort it was handed when the effort is cleared', async () => {
    // The picker holds the stored route, so clearing has to say "no effort" rather
    // than re-emit the one it was given — otherwise the board keeps the effort the
    // person just removed.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('high');
    await user.selectOptions(screen.getByLabelText('Reasoning effort'), '');
    expect(onChange).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'reason' });
  });

  it('reads the catalog again through the caller-provided refresh, reachable while it is unreadable', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    render(<ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} refresh={refresh} />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reload models' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
    // An unreadable catalog keeps the picker openable, because reloading lives inside it.
    render(<ModelPickerField value={undefined} catalog={null} onChange={() => {}} refresh={refresh} />);
    const empty = await open(user);
    expect(trigger().hasAttribute('disabled')).toBe(false);
    expect(within(empty).getByRole('status').textContent).toContain('Only the stored route is listed');
    // A caller with no refresh affordance gets no reload button.
    cleanup();
    render(<ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} />);
    const quiet = await open(user);
    expect(within(quiet).queryByRole('button', { name: 'Reload models' })).toBeNull();
  });

  it('offers no route beyond the default while the catalog is unreadable', () => {
    expect(modelOptions(null, undefined)).toEqual([{ value: 'default', label: 'Host default model' }]);
    expect(modelOptions(undefined, undefined)).toEqual([{ value: 'default', label: 'Host default model' }]);
    expect(modelRows(null, stored).map(row => row.value)).toEqual(['default', 'deepseek::reason']);
  });
});
