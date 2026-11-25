import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const topTabs = (page: Page) => page.getByRole('tablist', { name: 'Configuration sections', exact: true });
const boardTabs = (page: Page) => page.getByRole('tablist', { name: 'Board configuration sections', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Kanban configuration' });
const overlay = (page: Page) => page.getByRole('dialog', { name: /Board configuration · / });

/** Board configuration is reached from the Boards section: Edit opens it over the list. */
async function openBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Edit board / }).click();
  await boardTabs(page).waitFor();
}

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the section row without a board section and keeps one size', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model');
  expect(await topTabs(page).getByRole('tab').allTextContents()).toEqual(['General', 'Hub', 'Boards', 'Projects', 'Schedules', 'Team Settings']);
  await expect(topTabs(page).getByRole('tab', { name: 'Board', exact: true })).toHaveCount(0);
  await expect(dialog(page)).toHaveClass(/kb-dialog-settings/);
  await expect(dialog(page)).not.toHaveClass(/kb-dialog-settings-wide/);
  const general = (await dialog(page).boundingBox())!;
  for (const name of ['Hub', 'Boards', 'Projects', 'Schedules', 'Team Settings']) {
    await topTabs(page).getByRole('tab', { name }).click();
    await page.waitForTimeout(120);
    const next = (await dialog(page).boundingBox())!;
    expect(Math.round(next.width)).toBe(Math.round(general.width));
    expect(Math.round(next.height)).toBe(Math.round(general.height));
  }
  await page.screenshot({ path: path.join(OUT, 'configuration-team-settings-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'configuration-team-settings-dark.png') });
});

test('opens one board overlay above the list with its sub-sections and one size', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await openBoard(page);
  await expect(overlay(page)).toHaveClass(/kb-dialog-settings-wide/);
  for (const name of ['General', 'Projects', 'Agents', 'MCP', 'Workflow', 'Danger zone']) {
    await expect(boardTabs(page).getByRole('tab', { name })).toBeVisible();
  }
  const first = (await overlay(page).boundingBox())!;
  for (const name of ['Projects', 'Agents', 'MCP', 'Workflow', 'Danger zone', 'General']) {
    await boardTabs(page).getByRole('tab', { name }).click();
    await page.waitForTimeout(120);
    const next = (await overlay(page).boundingBox())!;
    expect(Math.round(next.width)).toBe(Math.round(first.width));
    expect(Math.round(next.height)).toBe(Math.round(first.height));
  }
  await page.screenshot({ path: path.join(OUT, 'configuration-board-overlay-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'configuration-board-overlay-dark.png') });
});

test('keeps the fixed height at a narrow viewport', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await page.setViewportSize({ width: 720, height: 900 });
  const first = (await dialog(page).boundingBox())!;
  await topTabs(page).getByRole('tab', { name: 'Boards' }).click();
  await page.waitForTimeout(120);
  const next = (await dialog(page).boundingBox())!;
  expect(Math.round(next.height)).toBe(Math.round(first.height));
  expect(next.width).toBeLessThanOrEqual(720);
  await page.screenshot({ path: path.join(OUT, 'configuration-narrow.png') });
});

test('asks before discarding a section draft', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await topTabs(page).getByRole('tab', { name: 'General' }).click();
  await page.getByRole('textbox', { name: 'Worktree base path' }).fill('/tmp/trees');
  await topTabs(page).getByRole('tab', { name: 'Hub' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Discard section changes' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Worktree base path' })).toHaveValue('/tmp/trees');
  await topTabs(page).getByRole('tab', { name: 'Hub' }).click();
  await page.getByRole('alertdialog', { name: 'Discard section changes' }).getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page.getByRole('textbox', { name: 'Hub name' })).toBeVisible();
});

test('asks before closing a dirty board overlay and returns to the list', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await openBoard(page);
  await page.getByRole('textbox', { name: 'Board name' }).fill('Renamed board');
  const close = page.getByRole('button', { name: /^Close Board configuration · / });
  await close.click();
  const leave = page.getByRole('alertdialog', { name: 'Discard board configuration changes' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Board name' })).toHaveValue('Renamed board');
  await close.click();
  await page.getByRole('alertdialog', { name: 'Discard board configuration changes' }).getByRole('button', { name: 'Discard and close' }).click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit board / })).toBeVisible();
  await expect(dialog(page)).toBeVisible();
});

test('leaves dialogs outside configuration at their previous size', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog).toHaveClass(/kb-dialog/);
  await expect(taskDialog).not.toHaveClass(/kb-dialog-settings/);
  expect((await taskDialog.boundingBox())!.width).toBeLessThan(1000);
  expect((await taskDialog.boundingBox())!.height).toBeLessThan(820);
});

test('presents the Boards list and the Hub section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await topTabs(page).getByRole('tab', { name: 'Boards' }).click();
  await expect(page.getByRole('button', { name: /^Edit board / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete board / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'configuration-boards-light.png') });
  await topTabs(page).getByRole('tab', { name: 'Hub' }).click();
  await expect(page.getByRole('region', { name: 'Hub danger zone' })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'configuration-hub-light.png') });
  await toDark(page);
  await topTabs(page).getByRole('tab', { name: 'Boards' }).click();
  await page.screenshot({ path: path.join(OUT, 'configuration-boards-dark.png') });
});
