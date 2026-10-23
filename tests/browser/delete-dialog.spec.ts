import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('delete confirmation is structured, focused, and contained', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Delete target' }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete task' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('/worktrees/delete-target', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText(/created by Kanban/)).toBeVisible();
  await expect(dialog.getByText(/2 conversations/)).toBeVisible();
  await expect(dialog.getByRole('note', { name: 'Unclaimed checkout deletion warning' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const geometry = await dialog.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
