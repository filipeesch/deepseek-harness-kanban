import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const topTabs = (page: Page) => page.getByRole('tablist', { name: 'Configuration sections', exact: true });
const boardTabs = (page: Page) => page.getByRole('tablist', { name: 'Board configuration sections', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Kanban configuration' });

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('sizes configuration surfaces per section and presents the board sub-sections', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model');
  const wide = (await dialog(page).boundingBox())!.width;
  expect(wide).toBeGreaterThan(1100);
  for (const name of ['General', 'Projects', 'Defaults', 'Workflow', 'Danger zone']) {
    await expect(boardTabs(page).getByRole('tab', { name })).toBeVisible();
  }
  await page.screenshot({ path: path.join(OUT, 'configuration-board-light.png') });
  await topTabs(page).getByRole('tab', { name: 'General' }).click();
  const form = (await dialog(page).boundingBox())!.width;
  expect(form).toBeLessThan(wide);
  expect(form).toBeGreaterThan(700);
  await expect(dialog(page)).toHaveClass(/kb-dialog-settings/);
  await expect(dialog(page)).not.toHaveClass(/kb-dialog-settings-wide/);
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'configuration-general-dark.png') });
});

test('asks before discarding a dirty board panel and keeps the workflow draft', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  const name = page.getByLabel('Board name');
  await name.fill('Harness board renamed');
  await boardTabs(page).getByRole('tab', { name: 'Projects' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Discard board panel changes' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(name).toHaveValue('Harness board renamed');
  await boardTabs(page).getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('alertdialog', { name: 'Discard board panel changes' }).getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page.getByRole('group', { name: 'Board project scope' })).toBeVisible();

  // The workflow draft is retained above the panel, so switching to it asks nothing
  // and switching away from it keeps the text.
  await boardTabs(page).getByRole('tab', { name: 'Workflow' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await page.keyboard.insertText(String.fromCharCode(10) + '# sub-tab draft');
  await boardTabs(page).getByRole('tab', { name: 'General' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard board panel changes' })).toHaveCount(0);
  await boardTabs(page).getByRole('tab', { name: 'Workflow' }).click();
  await expect(page.locator('.cm-content')).toContainText('# sub-tab draft');
});

test('asks before leaving Board and before closing with board edits', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await page.getByLabel('Board name').fill('Harness board renamed');
  await topTabs(page).getByRole('tab', { name: 'General' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Discard board changes' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Board name')).toHaveValue('Harness board renamed');
  await topTabs(page).getByRole('tab', { name: 'General' }).click();
  await page.getByRole('alertdialog', { name: 'Discard board changes' }).getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page.getByRole('textbox', { name: 'Worktree base path' })).toBeVisible();

  await topTabs(page).getByRole('tab', { name: 'Board' }).click();
  await page.getByLabel('Board name').fill('Harness board renamed again');
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  const close = page.getByRole('alertdialog', { name: 'Discard configuration changes' });
  await expect(close).toBeVisible();
  await close.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('alertdialog', { name: 'Discard configuration changes' }).getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test('leaves dialogs outside configuration at their previous width', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog).toHaveClass(/kb-dialog/);
  await expect(taskDialog).not.toHaveClass(/kb-dialog-settings/);
  expect((await taskDialog.boundingBox())!.width).toBeLessThan(1000);
});
