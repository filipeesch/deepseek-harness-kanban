// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionDiagnosis, type SessionDiagnosisPort, type SessionDiagnosisSession } from '../../src/client/session-diagnosis.js';
import { UNREADABLE_SESSION_CODE } from '../../src/domain/session-observation.js';
import { MISSING_SESSION_CODE } from '../../src/domain/session-observation.js';

afterEach(cleanup);

const failed = (code = UNREADABLE_SESSION_CODE, message = 'stored session failed validation: PTC dispatch repeats subCallId'): SessionDiagnosisSession => ({ openState: 'error', openError: { code, message } });

function port(overrides: Partial<SessionDiagnosisPort> = {}): SessionDiagnosisPort {
  return { inspect: vi.fn(async () => ({ observation: { state: 'unreadable' as const, cause: 'still corrupt' } })), ...overrides };
}

describe('session diagnosis seat', () => {
  it('renders nothing for a healthy conversation', () => {
    const { container } = render(<SessionDiagnosis sessionId='s1' session={{ openState: 'open' }} port={port()} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing for an unclassified open failure', () => {
    const { container } = render(<SessionDiagnosis sessionId='s1' session={failed('GATEWAY_UNAVAILABLE', 'socket closed')} port={port()} />);
    expect(container.textContent).toBe('');
  });

  it('presents the unreadable state, its cause, the Session and the log path', async () => {
    const inspect = vi.fn(async () => ({ observation: { state: 'unreadable' as const, cause: 'PTC dispatch repeats subCallId' }, location: { kind: 'jsonl', path: '/sessions/session-s1/session.v4.jsonl.zstd', revision: 'r1' } }));
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={port({ inspect })} />);
    expect(screen.getByRole('alert').textContent).toContain('Session log unreadable');
    fireEvent.click(screen.getByText('Details'));
    await screen.findByText('/sessions/session-s1/session.v4.jsonl.zstd');
    expect(inspect).toHaveBeenCalledWith('s1');
    expect(screen.getByRole('alert').textContent).toContain('stored session failed validation: PTC dispatch repeats subCallId');
    expect(screen.getByRole('alert').textContent).toContain('s1');
  });

  it('presents the missing state without promising a log path', async () => {
    const inspect = vi.fn(async () => ({ observation: { state: 'missing' as const, cause: 'no stored log' } }));
    render(<SessionDiagnosis sessionId='s2' session={failed(MISSING_SESSION_CODE, 'no stored log')} port={port({ inspect })} />);
    expect(screen.getByRole('alert').textContent).toContain('Session log missing');
    fireEvent.click(screen.getByText('Details'));
    await screen.findByText('no stored log');
    expect(screen.queryByText('Log')).toBeNull();
    expect(screen.queryByText('Repair…')).toBeNull();
  });

  it('replaces the diagnosis with a recovered notice after a successful recheck', async () => {
    const inspect = vi.fn(async () => ({ observation: null }));
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={port({ inspect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    await screen.findByText('Session log readable again');
    expect(screen.queryByText('Session log unreadable')).toBeNull();
  });

  it('requires an explicit confirmation before repairing', async () => {
    const repair = vi.fn(async () => ({ backupPath: '/backups/s1', renamed: 1 }));
    const inspect = vi.fn(async () => ({ observation: null }));
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={port({ repair, inspect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repair…' }));
    expect(repair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(repair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Repair…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repair this log' }));
    await waitFor(() => expect(repair).toHaveBeenCalledWith('s1'));
    await screen.findByText('Session log readable again');
  });

  it('returns to the diagnosis when a completed check reports the log unreadable again', async () => {
    const repair = vi.fn(async () => ({ backupPath: '/backups/s1', renamed: 1 }));
    const inspect = vi.fn()
      .mockResolvedValueOnce({ observation: null })
      .mockResolvedValueOnce({ observation: { state: 'unreadable' as const, cause: 'corrupt again' } });
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={port({ repair, inspect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repair…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repair this log' }));
    await screen.findByText('Session log readable again');
    fireEvent.click(screen.getByRole('button', { name: 'Check the log again' }));
    await screen.findByText('Session log unreadable');
    expect(screen.queryByText('Session log readable again')).toBeNull();
  });

  it('presents a repair failure without claiming the Session recovered', async () => {
    const repair = vi.fn(async () => { throw new Error('the artifact changed since it was read'); });
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={port({ repair })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Repair…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repair this log' }));
    await screen.findByText('the artifact changed since it was read');
    expect(screen.getByText('Session log unreadable')).toBeTruthy();
    expect(screen.queryByText('Session log readable again')).toBeNull();
  });

  it('presents the diagnosis without actions on a host that cannot inspect', () => {
    render(<SessionDiagnosis sessionId='s1' session={failed()} port={undefined} />);
    expect(screen.getByRole('alert').textContent).toContain('Session log unreadable');
    expect((screen.getByRole('button', { name: 'Recheck' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Repair…' })).toBeNull();
  });
});
