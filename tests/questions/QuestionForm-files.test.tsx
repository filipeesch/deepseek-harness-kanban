// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QuestionForm, type QuestionAttachmentPort } from '../../src/questions/QuestionForm.js';
import type { QuestionAttachment } from '../../src/shared/types.js';
import { choice, free, round } from './fixtures.js';

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

/** The picker of the slide currently shown; the panel has exactly one. */
function picker(label: 'this question' | 'the round'): HTMLInputElement {
  return screen.getByLabelText('Attach files to ' + label + ': choose a file') as HTMLInputElement;
}

describe('question answer files', () => {
  it('offers no attachment control when the host provides no port', () => {
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Attach files to this question' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Files for this question' })).toBeNull();
  });

  it('presents one control per slide, named for the slide it attaches to', async () => {
    const user = userEvent.setup();
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    expect(screen.getByRole('group', { name: 'Files for this question' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach files to this question' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Attach files to the round' })).toBeNull();
    // Next becomes available once the question is answered.
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('group', { name: 'Files for the whole round' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach files to the round' })).toBeTruthy();
  });

  it('keeps the answer untouched when a file is attached', async () => {
    const user = userEvent.setup();
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(files.stored).toEqual([{ name: 'spec.pdf', bytes: 3 }]));
    expect(screen.getByText('spec.pdf')).toBeTruthy();
    expect(screen.getByText('3 B')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('submits the attached file bytes with the reply and names it in the block', async () => {
    const user = userEvent.setup();
    const files = port();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf'));
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

  it('keeps each slide to its own files while the footer follows the active slide', async () => {
    const user = userEvent.setup();
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'page-file.pdf'));
    await waitFor(() => expect(screen.getByText('page-file.pdf')).toBeTruthy());
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The round's token list does not inherit the question's file.
    expect(screen.queryByText('page-file.pdf')).toBeNull();
    await user.upload(picker('the round'), new File(['abcd'], 'round-file.txt'));
    await waitFor(() => expect(screen.getByText('round-file.txt')).toBeTruthy());
    expect(screen.queryByText('page-file.pdf')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('page-file.pdf')).toBeTruthy();
    expect(screen.queryByText('round-file.txt')).toBeNull();
  });

  it('keeps the slide the person reached when a pick resolves later', async () => {
    const user = userEvent.setup();
    const files = port();
    // Hold the save open so the person can move on before the file lands.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const save = files.save;
    files.save = async file => { await gate; return save(file); };
    render(<QuestionForm round={round([free, choice])} onSubmit={vi.fn()} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'slow.txt'));
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: /Local/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The person is on Additional Notes while the pick is still reading.
    expect(screen.getByRole('textbox', { name: 'Additional Notes' })).toBeTruthy();
    release();
    await waitFor(() => expect(files.stored).toEqual([{ name: 'slow.txt', bytes: 3 }]));
    // The file lands on its own question without pulling the panel back to it.
    expect(screen.getByRole('textbox', { name: 'Additional Notes' })).toBeTruthy();
    expect(screen.queryByText('slow.txt')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('slow.txt')).toBeTruthy();
  });

  it('attaches a pasted file to the active slide and ignores pasted text', async () => {
    const user = userEvent.setup();
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    const answer = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.paste(answer, { clipboardData: { files: [new File(['abc'], 'pasted.png')] } });
    await waitFor(() => expect(files.stored).toEqual([{ name: 'pasted.png', bytes: 3 }]));
    // A text paste carries no files, so no attachment is invented from it.
    fireEvent.paste(answer, { clipboardData: { files: [], getData: () => 'just text' } });
    await waitFor(() => expect(files.stored).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('pasted.png')).toBeTruthy();
  });

  it('takes a pasted file when the footer attach control has focus', async () => {
    const files = port();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    const attach = screen.getByRole('button', { name: 'Attach files to this question' });
    attach.focus();
    fireEvent.paste(attach, { clipboardData: { files: [new File(['abc'], 'footer-paste.txt')] } });
    await waitFor(() => expect(screen.getByText('footer-paste.txt')).toBeTruthy());
    expect(files.stored).toEqual([{ name: 'footer-paste.txt', bytes: 3 }]);
  });

  it('keeps the draft and reports the failure when a file cannot be read at submit', async () => {
    const user = userEvent.setup();
    const files = port();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    files.load = async () => { throw new Error('The stored file is gone.'); };
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf'));
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
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf'));
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
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf'));
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('The file could not be stored.');
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // A failed selection keeps Submit unavailable until it is resolved.
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).not.toHaveBeenCalled();
    // The person can discard the failed selection and finish the answer.
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1]).toEqual([]);
  });

  it('keeps the reply order when a failed selection is retried after a later file', async () => {
    const user = userEvent.setup();
    const files = port();
    let attempts = 0;
    const save = files.save;
    files.save = async file => {
      attempts += 1;
      if (file.name === 'first.txt' && attempts === 1) throw new Error('The file could not be stored.');
      return save(file);
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'first.txt'));
    await screen.findByRole('alert');
    await user.upload(picker('this question'), new File(['abc'], 'second.txt'));
    await waitFor(() => expect(screen.getByText('second.txt')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('first.txt')).toBeTruthy());
    // The tokens show the pick order, not the order the files landed in.
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'first.txt3 B',
      'second.txt3 B',
    ]);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [text, delivered] = onSubmit.mock.calls[0]!;
    const attached = delivered as Array<{ name: string }>;
    // The reply travels in the order the person picked the files, not the order they landed,
    // and the text names them in that same order.
    expect(attached.map(file => file.name)).toEqual(['first.txt', 'second.txt']);
    expect(attached).toHaveLength(2);
    expect(text).toContain('Attached files: first.txt, second.txt');
  });

  it('retries the cleanup of a stored copy whose first delete failed', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files = port();
    let discards = 0;
    files.discard = vi.fn(async (attachment: QuestionAttachment) => {
      discards += 1;
      if (attachment.name === 'first.txt' && discards === 1) throw new Error('The copy could not be deleted.');
    });
    const save = files.save;
    // The second file of the batch fails, so the first file's copy must be cleaned up.
    files.save = async file => {
      if (file.name === 'second.txt') throw new Error('The file could not be stored.');
      return save(file);
    };
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    await user.upload(picker('this question'), [new File(['abc'], 'first.txt'), new File(['abc'], 'second.txt')]);
    await screen.findByRole('alert');
    expect(discards).toBe(1);
    // The failed delete is retried on the next selection instead of being swallowed.
    await user.upload(picker('this question'), new File(['abc'], 'third.txt'));
    await waitFor(() => expect(discards).toBe(2));
    warn.mockRestore();
  });

  it('reports a failed selection once and lets the round submit after it is discarded', async () => {
    const user = userEvent.setup();
    const files = port();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    files.save = async () => { await gate; throw new Error('The file could not be stored.'); };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'bad.txt'));
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Reviewed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // Submit is pressed while the read is still in flight, so it waits for it.
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    release();
    const readings = await screen.findAllByRole('alert');
    // The selection's own notice reports it; the submission invents no second error.
    expect(readings).toHaveLength(1);
    expect(readings[0]!.textContent).toContain('The file could not be stored.');
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1]).toEqual([]);
  });

  it('retries a failed cleanup when the selection is discarded, without another pick', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files = port();
    let discards = 0;
    files.discard = vi.fn(async () => {
      discards += 1;
      if (discards === 1) throw new Error('The copy could not be deleted.');
    });
    const save = files.save;
    files.save = async file => {
      if (file.name === 'second.txt') throw new Error('The file could not be stored.');
      return save(file);
    };
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} files={files} />);
    await user.upload(picker('this question'), [new File(['abc'], 'first.txt'), new File(['abc'], 'second.txt')]);
    await screen.findByRole('alert');
    expect(discards).toBe(1);
    // Resolving the selection finishes the copy, so the form holds nothing it cannot delete.
    await user.click(screen.getByRole('button', { name: 'Discard failed files' }));
    await waitFor(() => expect(discards).toBe(2));
    warn.mockRestore();
  });

  it('retries a failed selection with the files it carried', async () => {
    const user = userEvent.setup();
    const files = port();
    let attempt = 0;
    const save = files.save;
    files.save = async file => { attempt += 1; if (attempt === 1) throw new Error('The file could not be stored.'); return save(file); };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QuestionForm round={round([free])} onSubmit={onSubmit} files={files} />);
    await user.upload(picker('this question'), new File(['abc'], 'spec.pdf'));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('spec.pdf')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
