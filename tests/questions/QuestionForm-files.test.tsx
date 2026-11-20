// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QuestionForm, type QuestionAttachmentPort } from '../../src/questions/QuestionForm.js';
import type { QuestionAttachment } from '../../src/shared/types.js';
import { free, round } from './fixtures.js';

afterEach(cleanup);

function port(): QuestionAttachmentPort & { stored: Array<{ name: string; bytes: number }>; loaded: string[] } {
  const stored: Array<{ name: string; bytes: number }> = [];
  const loaded: string[] = [];
  return {
    stored,
    loaded,
    save: async file => { stored.push({ name: file.name, bytes: file.bytes }); return { id: 'att-' + stored.length, name: file.name, bytes: file.bytes } as QuestionAttachment; },
    load: async attachment => { loaded.push(attachment.name); return 'YWJj'; },
  };
}

describe('question answer files', () => {
  it('offers no attachment control when the host provides no port', () => {
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Attach file' })).toBeNull();
  });

  it('offers one control per question and one for the round', () => {
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    expect(screen.getByLabelText('Files for this question')).toBeTruthy();
    expect(screen.queryByLabelText('Files for the whole round')).toBeNull();
  });

  it('keeps the answer untouched when a file is attached', async () => {
    const user = userEvent.setup();
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    const input = screen.getByLabelText('Files for this question: choose a file') as HTMLInputElement;
    await user.upload(input, new File(['abc'], 'spec.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(files.stored).toEqual([{ name: 'spec.pdf', bytes: 3 }]));
    expect(screen.getByText('spec.pdf')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('submits the attached file bytes with the reply and names it in the block', async () => {
    const user = userEvent.setup();
    const files = port();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(screen.getByLabelText('Files for this question: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeTruthy());
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [text, attached] = onSubmit.mock.calls[0]!;
    expect(text).toContain('Attached files: spec.pdf');
    expect(attached).toEqual([{ id: 'att-1', name: 'spec.pdf', bytes: 3, data: 'YWJj' }]);
    expect(files.loaded).toEqual(['spec.pdf']);
  });

  it('keeps the draft and reports the failure when a file cannot be read', async () => {
    const user = userEvent.setup();
    const files = port();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    files.load = async () => { throw new Error('The stored file is gone.'); };
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(screen.getByLabelText('Files for this question: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeTruthy());
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('The stored file is gone.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    // The draft survives the failure: going back finds the page answer and its file.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Reviewed.');
    expect(screen.getByText('spec.pdf')).toBeTruthy();
  });

  it('waits for a pending read before submitting instead of dropping the file', async () => {
    const user = userEvent.setup();
    const files = port();
    // Hold the save open so the click lands while the read is still in flight.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const save = files.save;
    files.save = async file => { await gate; return save(file); };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(screen.getByLabelText('Files for this question: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    // The submission is gated on the read: nothing is sent while the file is pending.
    expect(onSubmit).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1]).toEqual([{ id: 'att-1', name: 'spec.pdf', bytes: 3, data: 'YWJj' }]);
  });

  it('offers a way out when a selection fails, instead of blocking Submit forever', async () => {
    const user = userEvent.setup();
    const files = port();
    files.save = async () => { throw new Error('The file could not be stored.'); };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(screen.getByLabelText('Files for this question: choose a file') as HTMLInputElement, new File(['abc'], 'spec.pdf'));
    expect(await screen.findByText('The file could not be stored.')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).not.toHaveBeenCalled();
    // The person can discard the failed selection and finish the answer.
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1]).toEqual([]);
  });
});
