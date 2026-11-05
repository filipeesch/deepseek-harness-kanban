import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('bulk deletion closes its confirmation without a result dialog', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /^Delete \d+$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete selected tasks' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete selected', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Deletion results' })).toHaveCount(0);
  // Selection mode is left immediately, so the board is usable right away.
  await expect(page.getByRole('button', { name: 'Select cards to delete' })).toBeVisible();
  await page.screenshot({ path: '.verification/bulk-deletion-admission.png', fullPage: false });
});
