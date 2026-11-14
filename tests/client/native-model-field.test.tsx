// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelCatalog, ModelSelection } from '../../src/shared/types.js';
import { NativeModelField } from '../../src/client/model/native-model-field.js';
import { MODEL_SELECTION_SLOT, type NativeSeat } from '../../src/client/native-slot-host.js';

afterEach(cleanup);

interface DirectoryState { current: ModelSelection | null; status: string; error: string | null; groups: readonly unknown[] }

function seat(options: { throwingInject?: boolean } = {}): NativeSeat {
  const Stub = (props: Record<string, unknown>) => {
    const directory = props.directory as { getSnapshot(): DirectoryState };
    const state = directory.getSnapshot();
    return <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="current">{state.current === null ? 'none' : state.current.provider + ' · ' + state.current.model + (state.current.reasoningEffort === undefined ? '' : ' · ' + state.current.reasoningEffort)}</span>
      <span data-testid="groups">{state.groups.length}</span>
      {state.error === null ? null : <span data-testid="error">{state.error}</span>}
      <button type="button" onClick={() => void (props.select as (value: unknown) => Promise<unknown>)({ provider: 'deepseek', model: 'chat' })}>Choose Chat</button>
      <button type="button" onClick={() => (props.load as () => void)()}>Reload</button>
    </div>;
  };
  const inject = options.throwingInject === true ? () => { throw new Error('no session'); } : () => ({});
  const entry = { component: Stub, options: { id: 'model' }, locale: 'model', inject } as unknown as StoredEntry;
  return {
    slots: { entriesOfSlot: key => key === MODEL_SELECTION_SLOT ? [entry] : [], subscribe: () => () => {} },
    locale: { bind: () => key => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} },
  };
}

const catalog: ModelCatalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }], failures: [] };
const reason = { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' };

describe('NativeModelField', () => {
  it('projects the catalog and the draft into the native selector', async () => {
    render(<NativeModelField seat={seat()} value={reason} catalog={catalog} onChange={() => {}} onRetry={() => {}} />);
    expect(await screen.findByTestId('status')).toHaveProperty('textContent', 'ready');
    expect(screen.getByTestId('current').textContent).toBe('deepseek · reason · high');
    expect(screen.getByTestId('groups').textContent).toBe('1');
  });

  it('turns a native selection into the form value', async () => {
    const onChange = vi.fn();
    render(<NativeModelField seat={seat()} value={reason} catalog={catalog} onChange={onChange} onRetry={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Chat' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat' }));
  });

  it('routes the native reload action to the catalog retry', async () => {
    const retry = vi.fn();
    render(<NativeModelField seat={seat()} value={reason} catalog={catalog} onChange={() => {}} onRetry={retry} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('forwards a catalog failure into the selector error surface', async () => {
    render(<NativeModelField seat={seat()} value={reason} catalog={null} catalogError={{ code: 'CATALOG', message: 'catalog offline' }} onChange={() => {}} onRetry={() => {}} />);
    expect(await screen.findByTestId('status')).toHaveProperty('textContent', 'error');
    expect(screen.getByTestId('error').textContent).toBe('catalog offline');
    expect(screen.getByTestId('current').textContent).toBe('deepseek · reason · high');
  });

  it('shows the loading state while the catalog is being read', async () => {
    render(<NativeModelField seat={seat()} value={undefined} catalog={null} catalogLoading onChange={() => {}} onRetry={() => {}} />);
    expect(await screen.findByTestId('status')).toHaveProperty('textContent', 'loading');
  });

  it('tolerates an inject that cannot resolve a session', async () => {
    render(<NativeModelField seat={seat({ throwingInject: true })} value={reason} catalog={catalog} onChange={() => {}} onRetry={() => {}} />);
    expect(await screen.findByTestId('status')).toHaveProperty('textContent', 'ready');
  });

  it('presents the stored route read-only when the host composes no entry', () => {
    render(<NativeModelField seat={{ slots: { entriesOfSlot: () => [], subscribe: () => () => {} }, locale: { bind: () => key => key, getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {} } }} value={reason} catalog={catalog} onChange={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/The native model selector is unavailable/)).toBeTruthy();
    expect(screen.getByText(/deepseek · reason/)).toBeTruthy();
  });

  it('presents the stored route read-only when no seat is available at all', () => {
    render(<NativeModelField value={reason} catalog={catalog} onChange={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/The native model selector is unavailable/)).toBeTruthy();
    expect(screen.getByText(/deepseek · reason/)).toBeTruthy();
  });
});
