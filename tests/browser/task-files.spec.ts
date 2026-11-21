import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.join(import.meta.dirname, '..', '..', '.verification');

interface HarnessCommand { type: string; [key: string]: unknown }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] } };

/** Open the seeded task and its Info section under a themed or plain harness scenario. */
async function openFiles(page: Page, scenario = 'task-files') {
  await page.goto(`${HARNESS}?scenario=${scenario}`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(page.getByRole('region', { name: 'Task files' })).toBeVisible();
}

/** The picture the person sees for the files surface; the theme fixture supplies tokens. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

test('lists the task files with their sizes and actions', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The dark capture needs the themed harness, which paints the host's dark tokens.
    await openFiles(page, scheme === 'dark' ? 'task-files-themed' : 'task-files');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await expect(page.getByText('monthly-reconciliation-output.csv')).toBeVisible();
    await expect(page.getByText('1.4 MB')).toBeVisible();
    await expect(page.getByText('architecture-review.pdf')).toBeVisible();
    await expect(page.getByText('282.6 KB')).toBeVisible();
    // Adding is one icon action; no host-path field and no per-source buttons remain.
    await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible();
    await expect(page.getByLabel('Attachment host path')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose a file' })).toHaveCount(0);
    await shoot(page, `task-files-list-${scheme}.png`);
  }
});

test('adds a file through the one icon action', async ({ page }) => {
  await openFiles(page);
  await page.getByLabel('Attach files: choose a file').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await expect(page.getByText('evidence.txt')).toBeVisible();
  const stored = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
  expect(stored.filter(command => command.type === 'task.edit').at(-1)).toMatchObject({
    attachmentUploads: [{ name: 'evidence.txt', origin: 'upload', data: 'YWJj' }],
  });
  await shoot(page, 'task-files-added.png');
});

test('confirms a removal that deletes stored bytes', async ({ page }) => {
  await openFiles(page);
  // The Info section also carries other Remove actions; scope to the file list.
  const files = page.getByRole('region', { name: 'Task files' });
  await files.getByRole('button', { name: 'Remove' }).first().click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm file removal' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('monthly-reconciliation-output.csv');
  await expect(confirm).toContainText('deletes its stored bytes');
  await shoot(page, 'task-files-remove-confirm.png');
});

test('presents the empty state for a task with no files', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=board`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(page.getByText('This task has no files.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible();
  // The drawer animates in; capture the settled surface, not a frame of the transition.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await shoot(page, 'task-files-empty.png');
});

test('shows the answer file tokens in the question footer', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${HARNESS}?scenario=question&case=files`);
    // The footer owns the one attach action and the active slide's tokens.
    await expect(page.getByRole('group', { name: 'Files for this question' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach files to this question' })).toBeVisible();
    await expect(page.getByText('storage-comparison.csv')).toBeVisible();
    await expect(page.getByText('18.0 KB')).toBeVisible();
    // The question slide no longer spends a block on attachments.
    await expect(page.getByRole('button', { name: 'Attach file', exact: true })).toHaveCount(0);
    await shoot(page, `answer-files-question-${scheme}.png`);
  }
});

test('shows the round-wide answer file control on Additional Notes', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=question&case=files`);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('group', { name: 'Files for the whole round' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach files to the round' })).toBeVisible();
  await expect(page.getByText('review-notes.txt')).toBeVisible();
  await shoot(page, 'answer-files-round.png');
});

test('submits the round carrying its restored files', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=question&case=files`);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  // The harness records the submit the surface produced: the reply text it would send,
  // not the native conversation and not the delivered bytes (both belong to the host).
  const reply = page.getByTestId('answer-reply');
  await expect(reply).toBeVisible();
  await expect(reply).toContainText('Attached files: storage-comparison.csv');
  await expect(reply).toContainText('Attached files: review-notes.txt');
  await expect(reply).toHaveAttribute('data-files', 'storage-comparison.csv,review-notes.txt');
  await shoot(page, 'answer-files-submitted.png');
});

test('reports a failed selection above the question footer in both appearances', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${HARNESS}?scenario=question&case=files-failed`);
    await page.getByLabel('Attach files to this question: choose a file').setInputFiles({ name: 'spec.pdf', mimeType: 'application/pdf', buffer: Buffer.from('abc') });
    const failure = page.getByRole('alert');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('The file could not be stored.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard failed files' })).toBeVisible();
    await shoot(page, `answer-files-failure-${scheme}.png`);
  }
});

test('creates a task carrying a file from the dialog footer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  // The appearance scenario is the themed board, so both captures carry the host tokens.
  await page.goto(`${HARNESS}?scenario=appearance`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Attach files: choose a file').setInputFiles({ name: 'brief.md', mimeType: 'text/markdown', buffer: Buffer.from('abc') });
  await expect(dialog.getByText('brief.md')).toBeVisible();
  await expect(dialog.getByLabel('Attachment host path')).toHaveCount(0);
  await shoot(page, 'new-task-files-footer-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await shoot(page, 'new-task-files-footer-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Task carrying evidence');
  await dialog.getByRole('combobox', { name: 'Project' }).selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toHaveCount(0);
  const stored = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
  expect(stored.filter(command => command.type === 'task.create').at(-1)).toMatchObject({
    title: 'Task carrying evidence',
    attachmentUploads: [{ name: 'brief.md', origin: 'upload', data: 'YWJj' }],
  });
});
