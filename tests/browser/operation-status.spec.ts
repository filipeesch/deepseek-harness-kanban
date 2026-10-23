import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('failed deletion recovery is visible above the tabs from Info', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Failed delete' }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  const status = page.locator('.kb-status-stack');
  await expect(status).toBeVisible();
  await expect(status.getByText('Task deletion needs attention').first()).toBeVisible();
  await expect(status.getByRole('button', { name: 'Retry deletion' })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Return chats to project' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(status).toBeVisible();
  await expect(status.getByText('Task deletion needs attention').first()).toBeVisible();
  const statusBox = await status.boundingBox();
  const tabsBox = await page.locator('.kb-drawer-toolbar').boundingBox();
  expect(statusBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(statusBox!.y).toBeLessThan(tabsBox!.y);
  await expect(page.locator('.kb-drawer-panel .kb-operation')).toHaveCount(0);
});

test('failed preflight deletion keeps Return visible from Notes', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Failed return' }).click();
  await page.getByRole('tab', { name: 'Notes' }).click();
  const status = page.locator('.kb-status-stack');
  await expect(status).toBeVisible();
  await expect(status.getByRole('button', { name: 'Retry deletion' })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Return chats to project' })).toBeVisible();
});
