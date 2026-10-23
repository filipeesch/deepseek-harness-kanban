// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { QuestionForm, QuestionIndex } from '../../src/questions/index.js';
import { call, choice, end, free, human, multi, ptcResult, ptcStart, result, round } from './fixtures.js';

afterEach(cleanup);
const nextButton = () => screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
const backButton = () => screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement;
const submitButton = () => screen.getByRole('button', { name: /Submit|Submitting/ }) as HTMLButtonElement;
const headerButton = () => screen.getByRole('button', { name: /Questions from the agent/ }) as HTMLButtonElement;

describe('QuestionForm strip', () => {
  it('renders Markdown, a weight pill and the recommendation, then ends in Additional Notes', async () => {
    const user = userEvent.setup();
    const index = new QuestionIndex();
    index.apply('a', call(1, 2, 'q'));
    index.apply('a', result(2, 2, 'q'));
    const onSubmit = vi.fn();
    const view = render(<QuestionForm round={index.getRounds('a')[0]!} onSubmit={onSubmit} />);
    expect(screen.getByRole('heading', { name: 'Choose storage' }).querySelector('strong')?.textContent).toBe('storage');
    expect(screen.getByText('Hard to change later')).toBeTruthy();
    expect(screen.queryByText(/Importance:/)).toBeNull();
    expect(screen.getByText('Local', { selector: 'strong' }).textContent).toBe('Local');
    expect(screen.getByText(/No extra service./)).toBeTruthy();
    expect(screen.getByText('Select an option to see details.')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('1 / 2').getAttribute('aria-live')).toBe('polite');
    const heading = screen.getByRole('heading', { name: 'Choose storage' });
    expect(heading.closest('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(nextButton().disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Local' }));
    expect(screen.getByText('files', { selector: 'strong' })).toBeTruthy();
    expect(nextButton().disabled).toBe(false);
    index.apply('a', end(3, 2));
    view.rerender(<QuestionForm round={index.getRounds('a')[0]!} onSubmit={onSubmit} />);
    await user.click(nextButton());
    expect(screen.getByRole('heading', { name: 'Additional Notes' })).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toContain('Answer: Local');
  });

  it('retains page choices, Other text, per-answer notes and Additional Notes in one reply', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm round={round([choice, multi, free])} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: 'Remote' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes for this answer' }), 'Use only if needed.');
    await user.click(nextButton());
    await user.click(screen.getByRole('checkbox', { name: 'Read' }));
    await user.click(screen.getByRole('checkbox', { name: 'Write' }));
    await user.click(screen.getByRole('checkbox', { name: 'Other (write your own answer)' }));
    await user.type(screen.getByRole('textbox', { name: 'Other answer' }), 'Audit');
    await user.click(backButton());
    expect((screen.getByRole('radio', { name: 'Remote' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Notes for this answer' }) as HTMLTextAreaElement).value).toBe('Use only if needed.');
    await user.click(nextButton());
    expect((screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Other answer' }) as HTMLTextAreaElement).value).toBe('Audit');
    await user.click(nextButton());
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Preserve histories.');
    await user.click(nextButton());
    const submit = submitButton();
    expect(submit.disabled).toBe(false);
    await user.type(screen.getByRole('textbox', { name: 'Additional Notes' }), 'Stay local.');
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const text = onSubmit.mock.calls[0]![0] as string;
    for (const expected of ['Choose **storage**', 'Answer: Remote', 'Notes: Use only if needed.', 'Answer: Read; Write', 'Other: Audit', 'Answer: Preserve histories.', '## Additional context', 'Stay local.']) expect(text).toContain(expected);
  });

  it('ignores the second click of a double-click on Next instead of submitting the round', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm round={round()} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: 'Local' }));
    await user.click(nextButton());
    fireEvent.click(submitButton(), { detail: 2 });
    expect(screen.getByRole('heading', { name: 'Additional Notes' })).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(submitButton(), { detail: 1 });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('requires a valid current answer before leaving a question slide', async () => {
    const user = userEvent.setup();
    render(<QuestionForm round={round()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Other (write your own answer)' }));
    expect(nextButton().disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Other answer' }), 'A different option');
    expect(nextButton().disabled).toBe(false);
    await user.click(nextButton());
    expect(submitButton().disabled).toBe(false);
    await user.click(backButton());
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Other answer' }) as HTMLTextAreaElement).value).toBe('A different option');
  });

  it('retains the active slide and its answer when incremental pages reorder', async () => {
    const user = userEvent.setup();
    const initial = { ...round([free], false), pages: [{ callId: 'original', sequence: 5, page: free }] };
    const view = render(<QuestionForm round={initial} onSubmit={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Already entered.');
    view.rerender(<QuestionForm round={{ ...initial, pages: [{ callId: 'earlier', sequence: 1, page: free }, ...initial.pages, { callId: 'later', sequence: 8, page: multi }] }} onSubmit={vi.fn()} />);
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Already entered.');
    await user.click(backButton());
    expect(screen.getByText('1 / 4')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Earlier.');
    await user.click(nextButton());
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('Already entered.');
  });

  it('collapses to its header bar and expands again without losing the round', async () => {
    const user = userEvent.setup();
    render(<QuestionForm round={round()} onSubmit={vi.fn()} />);
    await user.tab();
    expect(document.activeElement).toBe(headerButton());
    expect(headerButton().getAttribute('aria-expanded')).toBe('true');
    await user.click(headerButton());
    expect(headerButton().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Choose storage' })).toBeNull();
    expect(headerButton()).toBeTruthy();
    await user.click(headerButton());
    expect(screen.getByRole('heading', { name: 'Choose storage' })).toBeTruthy();
  });

  it('reports an answered round and cannot submit it', async () => {
    const user = userEvent.setup();
    const index = new QuestionIndex();
    for (const event of [call(1, 3, 'root', 'run_code'), ptcStart(2, 'root', 'page'), ptcResult(3, 'root', 'page'), end(4, 3)]) index.apply('a', event);
    const restored = new QuestionIndex(JSON.parse(JSON.stringify(index.serialize())));
    restored.apply('a', human(5));
    const view = render(<QuestionForm round={restored.getRounds('a')[0]!} onSubmit={vi.fn()} />);
    expect(screen.getByText('This round has been answered in the conversation.')).toBeTruthy();
    expect(nextButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Close question form' })).toBeNull();
    view.rerender(<QuestionForm round={restored.getRounds('a')[0]!} onSubmit={vi.fn()} />);
    expect(restored.pending('a')).toBe(false);
  });

  it('starts a new round without reusing a prior round answer', async () => {
    const user = userEvent.setup();
    const view = render(<QuestionForm round={round([free])} onSubmit={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Old answer');
    view.rerender(<QuestionForm round={{ ...round([free]), id: 'next-round', turnId: '2' }} onSubmit={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('');
    expect(nextButton().disabled).toBe(true);
  });

  it('locks duplicate submission, reports errors, and allows a retry', async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    const onSubmit = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValue(undefined);
    const view = render(<QuestionForm round={round([free])} onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Answer');
    await user.click(nextButton());
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
    const view = render(<QuestionForm round={round([value], false)} onSubmit={vi.fn()} />);
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('img')).toBeNull();
    view.rerender(<QuestionForm round={round([], false)} onSubmit={vi.fn()} />);
    expect(screen.getByText('Waiting for question pages.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it('keeps the footer Dismiss action optional and left-aligned', async () => {
    const without = render(<QuestionForm round={round([free])} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    without.unmount();
    const onDismiss = vi.fn();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} onDismiss={onDismiss} />);
    const footer = screen.getByRole('form', { name: 'Questions from the agent' }).querySelector('.kq-footer')!;
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(footer.firstElementChild).toBe(dismiss);
    await userEvent.setup().click(dismiss);
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('confirms only when a draft exists and keeps the draft on cancel', async () => {
    const user = userEvent.setup(); const onDismiss = vi.fn();
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} onDismiss={onDismiss} />);
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'A draft answer');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText(/Discard this and other unanswered rounds/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep answering' })));
    await user.click(screen.getByRole('button', { name: 'Keep answering' }));
    expect(screen.queryByText(/Discard this and other unanswered rounds/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value).toBe('A draft answer');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss questions' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('reports a dismissal failure and leaves an untouched round available for retry', async () => {
    const user = userEvent.setup(); const onDismiss = vi.fn().mockRejectedValue(new Error('Dismissal failed'));
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Dismissal failed')).toBeTruthy();
    expect(screen.queryByText(/Discard this and other unanswered rounds/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('disables dismissal on an answered round', () => {
    const answered = { ...round([free]), answered: true };
    render(<QuestionForm round={answered} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a structured host dismissal error instead of [object Object]', async () => {
    const user = userEvent.setup(); const onDismiss = vi.fn().mockRejectedValue({ code: 'STORAGE_FAILED', message: 'Could not persist dismissal.' });
    render(<QuestionForm round={round([free])} onSubmit={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Could not persist dismissal.')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('confirms before dismissing after a choice draft', async () => {
    const user = userEvent.setup(); const onDismiss = vi.fn();
    render(<QuestionForm round={round([choice])} onSubmit={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('radio', { name: 'Local' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText(/Discard this and other unanswered rounds/)).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
