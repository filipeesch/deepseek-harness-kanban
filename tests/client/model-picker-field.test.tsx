// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ModelCatalog, ModelSelection } from '../../src/shared/types.js';
import { ModelPickerField, modelOptionValue, modelOptions } from '../../src/client/settings/model-picker-field.js';

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

describe('the shared model picker', () => {
  it('offers the host default and every catalog route, and selects the stored route', () => {
    render(<ModelPickerField value={stored} catalog={catalog} onChange={() => {}} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.value)).toEqual(['default', 'deepseek::chat', 'deepseek::reason']);
    expect(select.value).toBe('deepseek::reason');
    expect(screen.getByText('Host default model')).toBeTruthy();
    expect(modelOptionValue(undefined)).toBe('default');
  });

  it('keeps a stored route the catalog no longer lists and says so without hiding the choice', () => {
    const stale: ModelSelection = { provider: 'anthropic', model: 'claude', reasoningEffort: 'high' };
    render(<ModelPickerField value={stale} catalog={catalog} onChange={() => {}} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.value)).toEqual(['default', 'deepseek::chat', 'deepseek::reason', 'anthropic::claude']);
    expect(screen.getByText('anthropic · claude (not in the catalog)')).toBeTruthy();
    expect(select.value).toBe('anthropic::claude');
    // The effort select still appears, offering the stored effort as its own choice.
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('high');
  });

  it('hands the caller a route with no effort when another route is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Model'), 'deepseek::chat');
    expect(onChange).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat' });
  });

  it('hands the caller nothing when the host default is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Model'), 'default');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps the effort when the same route is chosen again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPickerField value={stored} catalog={catalog} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Model'), 'deepseek::reason');
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

  it('reads the catalog again through the caller-provided refresh and closes the route select without one', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const { rerender } = render(<ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} refresh={refresh} />);
    await user.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<ModelPickerField value={undefined} catalog={null} onChange={() => {}} refresh={refresh} />);
    expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(true);
    // A caller with no refresh affordance gets the two selects and nothing else.
    cleanup();
    render(<ModelPickerField value={undefined} catalog={catalog} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
  });

  it('offers no route beyond the default while the catalog is unreadable', () => {
    expect(modelOptions(null, undefined)).toEqual([{ value: 'default', label: 'Host default model' }]);
    expect(modelOptions(undefined, undefined)).toEqual([{ value: 'default', label: 'Host default model' }]);
  });
});
