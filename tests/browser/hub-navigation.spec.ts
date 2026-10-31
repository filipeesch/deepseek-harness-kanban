import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('creates a Hub and its first board, then remembers the Hub after reload', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=hubs');
  await expect(page.getByRole('tab', { name: /Harness Hub.*4 tasks running/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Harness board.*4 tasks running/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Second Hub' }).click();
  const hubTab = page.getByRole('tab', { name: /Harness Hub.*4 tasks running/ });
  await expect(hubTab.locator('.kb-tab-running')).toBeVisible();
  await expect(hubTab.locator('.kb-tab-running-count')).toHaveText('4');
  await expect(hubTab.locator('.kb-tab-running')).toHaveAttribute('aria-label', '4 tasks running');
  await expect(hubTab.locator('.kb-tab-running')).toHaveAttribute('title', '4 tasks running: Long column task 0, Long column task 1, Long column task 2, Long column task 3');
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
  await page.locator('.kb-empty').getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('textbox', { name: 'Board name' }).fill('Second board');
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Second board/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Second Hub' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
});
