import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.join(import.meta.dirname, '..', '..', '.verification');

/** Open the seeded task and its Info section. */
async function openFiles(page: Page) {
  await page.goto(`${HARNESS}?scenario=task-files`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(page.getByRole('region', { name: 'Task files' })).toBeVisible();
}

test('lists the task files with their sizes and actions', async ({ page }) => {
  await openFiles(page);
  await expect(page.getByText('monthly-reconciliation-output.csv')).toBeVisible();
  await expect(page.getByText('1.4 MB')).toBeVisible();
  await expect(page.getByText('architecture-review.pdf')).toBeVisible();
  await expect(page.getByText('282.6 KB')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a file' })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'task-files-list.png'), fullPage: true });
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
  await page.screenshot({ path: path.join(OUT, 'task-files-remove-confirm.png'), fullPage: true });
});

test('presents the empty state for a task with no files', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=board`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(page.getByText('This task has no files.')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'task-files-empty.png'), fullPage: true });
});

test('shows the answer file controls with restored attachments', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=question&case=files`);
  await expect(page.getByRole('group', { name: 'Files for this question' })).toBeVisible();
  await expect(page.getByText('storage-comparison.csv')).toBeVisible();
  await expect(page.getByText('18.0 KB')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'answer-files-question.png'), fullPage: true });
});

test('shows the round-wide answer file control on Additional Notes', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=question&case=files`);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('group', { name: 'Files for the whole round' })).toBeVisible();
  await expect(page.getByText('review-notes.txt')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'answer-files-round.png'), fullPage: true });
});