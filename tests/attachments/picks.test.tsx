// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useAttachmentPicks } from '../../src/attachments/picks.js';

afterEach(cleanup);

function file(name: string): File { return new File(['abc'], name); }

/** One surface stand-in that exposes the hook's live state and actions. */
function Harness({ accept }: { accept: (files: readonly File[]) => Promise<void> }) {
  const picks = useAttachmentPicks();
  return <div>
    <p data-testid="state">{picks.pending + '/' + picks.failed}</p>
    <button type="button" onClick={() => picks.pick([file('first.txt')], accept)}>pick first</button>
    <button type="button" onClick={() => picks.pick([file('second.txt')], accept)}>pick second</button>
    <button type="button" onClick={picks.retryFailed}>retry</button>
    <button type="button" onClick={picks.discardFailed}>discard</button>
  </div>;
}

function recording() {
  const calls: string[] = [];
  const accept = vi.fn(async (files: readonly File[]) => { calls.push(...files.map(entry => entry.name)); });
  return { calls, accept };
}

describe('attachment picks', () => {
  it('stores selections one after another so pick order survives', async () => {
    const user = userEvent.setup();
    const { calls, accept } = recording();
    // The first selection resolves last; the hook must still store it first.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ordered = async (files: readonly File[]) => {
      if (files[0]!.name === 'first.txt') await gate;
      await accept(files);
    };
    render(<Harness accept={ordered} />);
    await user.click(screen.getByRole('button', { name: 'pick first' }));
    await user.click(screen.getByRole('button', { name: 'pick second' }));
    release();
    await waitFor(() => expect(calls).toEqual(['first.txt', 'second.txt']));
  });

  it('counts a file in flight until its selection settles', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    render(<Harness accept={async () => { await gate; }} />);
    await user.click(screen.getByRole('button', { name: 'pick first' }));
    expect(screen.getByTestId('state').textContent).toBe('1/0');
    release();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/0'));
  });

  it('keeps a failure blocking until it is retried', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const accept = vi.fn(async () => { attempt += 1; if (attempt === 1) throw new Error('The file could not be stored.'); });
    render(<Harness accept={accept} />);
    await user.click(screen.getByRole('button', { name: 'pick first' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/1'));
    // A second successful selection never releases the earlier failure.
    await user.click(screen.getByRole('button', { name: 'pick second' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/1'));
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/0'));
    expect(accept).toHaveBeenCalledTimes(3);
  });

  it('replays the files a failed selection carried', async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    let attempt = 0;
    const accept = async (files: readonly File[]) => {
      attempt += 1;
      seen.push(files.map(entry => entry.name));
      if (attempt === 1) throw new Error('nope');
    };
    render(<Harness accept={accept} />);
    await user.click(screen.getByRole('button', { name: 'pick first' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/1'));
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/0'));
    expect(seen).toEqual([['first.txt'], ['first.txt']]);
  });

  it('lets a discarded selection stop blocking the surface', async () => {
    const user = userEvent.setup();
    const accept = vi.fn(async () => { throw new Error('The file could not be stored.'); });
    render(<Harness accept={accept} />);
    await user.click(screen.getByRole('button', { name: 'pick first' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('0/1'));
    await user.click(screen.getByRole('button', { name: 'discard' }));
    expect(screen.getByTestId('state').textContent).toBe('0/0');
  });

  it('reports the live gate even before the next render', async () => {
    let picks: ReturnType<typeof useAttachmentPicks> | undefined;
    function Probe() { picks = useAttachmentPicks(); return null; }
    render(<Probe />);
    expect(picks!.outstanding()).toBe(false);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    act(() => picks!.pick([file('now.txt')], async () => { await gate; }));
    // The handler that queued the pick could submit in the same tick; the live gate
    // must see the read that render has not published yet.
    expect(picks!.outstanding()).toBe(true);
    release();
    await picks!.waitForReads();
    expect(picks!.outstanding()).toBe(false);
  });

  it('settles only after an in-flight selection and reports its failure', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let picks: ReturnType<typeof useAttachmentPicks> | undefined;
    function Probe() { picks = useAttachmentPicks(); return null; }
    render(<Probe />);
    let settled: boolean | undefined;
    const settlement = picks!.settle().then(value => { settled = value; });
    act(() => { picks!.pick([file('later.txt')], async files => { await gate; throw new Error('gone'); }); });
    await Promise.resolve();
    expect(settled).toBeUndefined();
    release();
    await settlement;
    // The failure is reported by the surface's notice, so settling only reports the state.
    expect(settled).toBe(false);
    await expect(picks!.settle()).resolves.toBe(false);
    act(() => picks!.discardFailed());
    await expect(picks!.settle()).resolves.toBe(true);
  });
});
