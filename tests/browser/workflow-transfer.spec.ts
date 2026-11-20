import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const topTabs = (page: Page) => page.getByRole('tablist', { name: 'Configuration sections', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Kanban configuration' });
const transferDialog = (page: Page, name: string) => page.getByRole('dialog', { name });

async function openBoardsSection(page: Page): Promise<void> {
  await page.goto(HARNESS + '?scenario=board-transfer');
  await topTabs(page).getByRole('tab', { name: 'Boards' }).click();
}

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the transfer actions in the Boards section only', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoardsSection(page);
  await expect(page.getByRole('button', { name: 'Export workflows' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import workflows' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Export board / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Import board / })).toHaveCount(0);
});

test('keeps the export dialog inside the configuration size and scroll region', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoardsSection(page);
  const sectionBox = (await dialog(page).boundingBox())!;
  await page.getByRole('button', { name: 'Export workflows' }).click();
  const exportDialog = transferDialog(page, 'Export workflows');
  await exportDialog.waitFor();
  const box = (await exportDialog.boundingBox())!;
  expect(Math.round(box.height)).toBeLessThanOrEqual(Math.round(sectionBox.height));
  expect(box.width).toBeLessThanOrEqual(1440);
  // The content scrolls inside the dialog rather than growing the dialog outside the viewport.
  const overflow = await exportDialog.evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
  expect(overflow.client).toBeLessThanOrEqual(900);
  await page.screenshot({ path: path.join(OUT, 'workflow-export-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'workflow-export-dark.png') });
});

test('keeps the import dialog inside the configuration size and scroll region', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoardsSection(page);
  const sectionBox = (await dialog(page).boundingBox())!;
  await page.getByRole('button', { name: 'Import workflows' }).click();
  const importDialog = transferDialog(page, 'Import workflows');
  await importDialog.waitFor();
  // The real browser port opens a file chooser; handing it one document reads the plan.
  const chooser = page.waitForEvent('filechooser');
  await importDialog.getByRole('button', { name: /Choose file/ }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({ name: 'export.json.gz', mimeType: 'application/gzip', buffer: Buffer.from([1, 2, 3]) });
  await expect(importDialog.getByText('Review flow')).toBeVisible();
  const box = (await importDialog.boundingBox())!;
  expect(Math.round(box.height)).toBeLessThanOrEqual(Math.round(sectionBox.height));
  expect(box.width).toBeLessThanOrEqual(1440);
  const overflow = await importDialog.evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
  expect(overflow.client).toBeLessThanOrEqual(900);
  await page.screenshot({ path: path.join(OUT, 'workflow-import-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'workflow-import-dark.png') });
});
