import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('creates a Hub and its first board, then remembers the Hub after reload', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=hubs');
  await expect(page.getByRole('tab', { name: 'Harness Hub' })).toBeVisible();
  await page.getByRole('tab', { name: 'Second Hub' }).click();
  await expect(page.getByRole('tab', { name: 'Harness Hub' }).locator('.kb-dot.kb-activity')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
  await page.locator('.kb-empty').getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('textbox', { name: 'Board name' }).fill('Second board');
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Second board/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Second Hub' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Create your first board' })).toBeVisible();
});
