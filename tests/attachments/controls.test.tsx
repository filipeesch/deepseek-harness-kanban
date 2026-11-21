// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AttachButton } from '../../src/attachments/AttachButton.js';
import { AttachmentChips } from '../../src/attachments/AttachmentChips.js';
import { AttachmentFailureNotice } from '../../src/attachments/AttachmentFailureNotice.js';
import { clipboardFiles } from '../../src/attachments/clipboard.js';
import { useRestoreFocusAfterFailure } from '../../src/attachments/focus.js';

afterEach(cleanup);

const tokens = [
  { id: 'a1', name: 'storage-comparison.csv', bytes: 18432 },
  { id: 'a2', name: 'review-notes.txt', bytes: 2048 },
];

describe('attachment controls', () => {
  it('offers one icon action that opens the file dialog', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<AttachButton label="Attach files to this question" onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'Attach files to this question' })).toBeTruthy();
    const input = screen.getByLabelText('Attach files to this question: choose a file') as HTMLInputElement;
    await user.upload(input, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(Array.from(onPick.mock.calls[0]![0] as readonly File[]).map(file => file.name)).toEqual(['spec.pdf']);
    // The picker clears its value, so picking the same file twice still reports both picks.
    expect(input.value).toBe('');
  });

  it('disables the action without removing it', () => {
    render(<AttachButton label="Attach files" disabled onPick={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists tokens with name, size, and a named removal', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<AttachmentChips attachments={tokens} onRemove={onRemove} />);
    expect(screen.getByText('storage-comparison.csv')).toBeTruthy();
    expect(screen.getByText('18.0 KB')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove review-notes.txt' }));
    expect(onRemove).toHaveBeenCalledWith('a2');
  });

  it('renders no list when nothing is attached', () => {
    const { container } = render(<AttachmentChips attachments={[]} onRemove={vi.fn()} />);
    expect(container.querySelector('.ka-chips')).toBeNull();
  });

  it('moves focus to a control that stays when a token is removed', async () => {
    const user = userEvent.setup();
    const fallback = React.createRef<HTMLButtonElement>();
    const onRemove = vi.fn();
    render(<>
      <button ref={fallback} type="button">Attach files</button>
      <AttachmentChips attachments={tokens} onRemove={onRemove} focusFallback={fallback} />
    </>);
    const first = screen.getByRole('button', { name: 'Remove storage-comparison.csv' });
    const second = screen.getByRole('button', { name: 'Remove review-notes.txt' });
    first.focus();
    await user.click(first);
    expect(onRemove).toHaveBeenCalledWith('a1');
    // The next token keeps the keyboard flow going instead of dropping to the body.
    expect(document.activeElement).toBe(second);
  });

  it('returns focus to the add action when the last token is removed', async () => {
    const user = userEvent.setup();
    const fallback = React.createRef<HTMLButtonElement>();
    render(<>
      <button ref={fallback} type="button">Attach files</button>
      <AttachmentChips attachments={[tokens[0]!]} onRemove={vi.fn()} focusFallback={fallback} />
    </>);
    const remove = screen.getByRole('button', { name: 'Remove storage-comparison.csv' });
    remove.focus();
    await user.click(remove);
    expect(document.activeElement).toBe(fallback.current);
  });

  it('returns focus to the add action when the recovery notice closes', async () => {
    const user = userEvent.setup();
    function Surface() {
      const [failed, setFailed] = React.useState(1);
      const attach = React.useRef<HTMLButtonElement>(null);
      useRestoreFocusAfterFailure(failed, true, attach);
      return <>
        <AttachButton label="Attach files" buttonRef={attach} onPick={() => {}} />
        <AttachmentFailureNotice failed={failed} message="The file could not be stored." onRetry={() => {}} onDiscard={() => setFailed(0)} />
      </>;
    }
    render(<Surface />);
    const discard = screen.getByRole('button', { name: 'Discard failed files' });
    discard.focus();
    await user.click(discard);
    // The notice and its button unmount; focus returns to the surface's add action.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attach files' }));
  });

  it('waits for the add action to become usable before restoring focus', async () => {
    const user = userEvent.setup();
    // A retry that keeps reading leaves the add action disabled, so the restore must wait.
    function Surface() {
      const [failed, setFailed] = React.useState(1);
      const [reading, setReading] = React.useState(false);
      const attach = React.useRef<HTMLButtonElement>(null);
      useRestoreFocusAfterFailure(failed, !reading, attach);
      // The read finishes on its own, without the person touching another control.
      React.useEffect(() => {
        if (!reading) return;
        const timer = setTimeout(() => setReading(false), 10);
        return () => clearTimeout(timer);
      }, [reading]);
      return <>
        <AttachButton label="Attach files" buttonRef={attach} disabled={reading} onPick={() => {}} />
        {failed > 0 ? <button type="button" onClick={() => { setFailed(0); setReading(true); }}>Try again</button> : null}
      </>;
    }
    render(<Surface />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.click(retry);
    // The notice unmounted while the retry reads, so the add action is not focused yet.
    const attach = screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement;
    expect(attach.disabled).toBe(true);
    expect(document.activeElement).not.toBe(attach);
    // Once the action is usable, focus lands on it instead of being lost.
    await waitFor(() => expect(document.activeElement).toBe(attach));
  });

  it('takes only files from a paste', () => {
    const picked = new File(['abc'], 'clip.txt');
    expect(clipboardFiles({ files: [picked] } as unknown as DataTransfer)).toEqual([picked]);
    expect(clipboardFiles({ files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(clipboardFiles(null)).toEqual([]);
  });

  it('reports a failed selection with both ways out', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(<AttachmentFailureNotice failed={0} message="ignored" onRetry={onRetry} onDiscard={onDiscard} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<AttachmentFailureNotice failed={1} message="The file could not be stored." onRetry={onRetry} onDiscard={onDiscard} />);
    expect(screen.getByRole('alert').textContent).toContain('The file could not be stored.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
