// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QuestionForm, QuestionIndex } from '../../src/questions/index.js';
import { call, choice, end, free, human, multi, ptcResult, ptcStart, result, round } from './fixtures.js';

afterEach(cleanup);
function submitButton(): HTMLButtonElement { return screen.getByRole('button', { name: /Submit answers|Submitting/ }) as HTMLButtonElement; }

describe('QuestionForm', () => {
  it('renders Markdown, recommendation/weight and waits for actual round completion', async () => {
    const user = userEvent.setup();
    const index = new QuestionIndex();
    index.apply('a', call(1, 2, 'q'));
    index.apply('a', result(2, 2, 'q'));
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();
    const view = render(<QuestionForm round={index.getRounds('a')[0]!} onSubmit={onSubmit} onDismiss={onDismiss} />);
    expect(screen.getByRole('heading', { name: 'Choose storage' }).querySelector('strong')?.textContent).toBe('storage');
    expect(screen.getByText('Importance: critical')).toBeTruthy();
    expect(screen.getByLabelText('Agent recommendation').textContent).toContain('Local');
    expect(screen.getByText('No extra service.')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Local' }));
    expect(submitButton().disabled).toBe(true);
    index.apply('a', end(3, 2));
    view.rerender(<QuestionForm round={index.getRounds('a')[0]!} onSubmit={onSubmit} onDismiss={onDismiss} />);
    expect(submitButton().disabled).toBe(false);
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toContain('Answer: Local');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('retains page choices, Other text and notes and submits the whole round once', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm round={round([choice, multi, free])} onSubmit={onSubmit} onDismiss={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Remote' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes for this answer' }), 'Use only if needed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('checkbox', { name: 'Read' }));
    await user.click(screen.getByRole('checkbox', { name: 'Write' }));
    await user.click(screen.getByRole('checkbox', { name: 'Other (write your own answer)' }));
    await user.type(screen.getByRole('textbox', { name: 'Other answer' }), 'Audit');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByRole('radio', { name: 'Remote' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Notes for this answer' }) as HTMLTextAreaElement).value).toBe('Use only if needed.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect((screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Other answer' }) as HTMLTextAreaElement).value).toBe('Audit');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(submitButton().disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Preserve histories.');
    await user.type(screen.getByRole('textbox', { name: 'Additional context for this round' }), 'Stay local.');
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const text = onSubmit.mock.calls[0]![0] as string;
    for (const expected of ['Choose **storage**', 'Answer: Remote', 'Notes: Use only if needed.', 'Answer: Read; Write', 'Other: Audit', 'Answer: Preserve histories.', 'Additional context', 'Stay local.']) expect(text).toContain(expected);
  });

  it('requires nonblank Other text before submitting a selected Other answer', async () => {
    const user = userEvent.setup();
    render(<QuestionForm round={round()} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Other (write your own answer)' }));
    expect(submitButton().disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Other answer' }), 'A different option');
    expect(submitButton().disabled).toBe(false);
  });

  it('retains the active page and its answer when incremental pages reorder', async () => {
    const user = userEvent.setup();
    const initial = { ...round([free], false), pages: [{ callId: 'original', sequence: 5, page: free }] };
    const view = render(<QuestionForm round={initial} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Already entered.');
    view.rerender(<QuestionForm round={{ ...initial, pages: [{ callId: 'earlier', sequence: 1, page: choice }, ...initial.pages, { callId: 'later', sequence: 8, page: multi }] }} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Question 2 of 3')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Already entered.');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Already entered.');
  });

  it('closes without submitting or cancelling and accepts a normal text answer after native/PTC reload', async () => {
    const user = userEvent.setup();
    const index = new QuestionIndex();
    for (const event of [call(1, 3, 'root', 'run_code'), ptcStart(2, 'root', 'page'), ptcResult(3, 'root', 'page'), end(4, 3)]) index.apply('a', event);
    const restored = new QuestionIndex(JSON.parse(JSON.stringify(index.serialize())));
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();
    const view = render(<QuestionForm round={restored.getRounds('a')[0]!} onSubmit={onSubmit} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Close question form' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(restored.pending('a')).toBe(true);
    restored.apply('a', human(5));
    view.rerender(<QuestionForm round={restored.getRounds('a')[0]!} onSubmit={onSubmit} onDismiss={onDismiss} />);
    expect(screen.getByText('This round has been answered in the conversation.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    expect(restored.pending('a')).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('starts a new round without reusing a prior round answer', async () => {
    const user = userEvent.setup();
    const view = render(<QuestionForm round={round([free])} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Old answer');
    view.rerender(<QuestionForm round={{ ...round([free]), id: 'next-round', turnId: '2' }} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('');
    expect(submitButton().disabled).toBe(true);
  });

  it('locks duplicate submission, reports errors, and allows a retry', async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    const onSubmit = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValue(undefined);
    const view = render(<QuestionForm round={round([free])} onSubmit={onSubmit} onDismiss={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Answer');
    await user.click(submitButton());
    fireEvent.submit(view.container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    reject(new Error('Native message was not admitted.'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not admitted'));
    expect(submitButton().disabled).toBe(false);
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('Response submitted.')).toBeTruthy());
    expect(submitButton().disabled).toBe(true);
  });

  it('does not render raw HTML or remote Markdown images and handles empty incoming rounds', () => {
    const value = { ...free, context: '<script>alert(1)</script>\n\n![remote](https://example.invalid/image.png)' };
    const view = render(<QuestionForm round={round([value], false)} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('img')).toBeNull();
    view.rerender(<QuestionForm round={round([], false)} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Waiting for question pages.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });
});
