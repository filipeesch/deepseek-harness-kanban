import { expect, test } from '@playwright/test';
import path from 'node:path';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const shot = (name: string) => path.join('.verification', name);

test('a failed creation names the incomplete checkout and offers discard', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Failed create' }).click();
  const status = page.locator('.kb-status-stack');
  await expect(status.getByText('Worktree creation needs attention').first()).toBeVisible();
  await expect(status.getByText('Incomplete (directory on disk, not registered)')).toBeVisible();
  await expect(status.getByText('abc1234')).toBeVisible();
  await expect(status.getByRole('button', { name: 'Discard incomplete checkout and retry…' })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Return chats to project' })).toBeVisible();
  await status.screenshot({ path: shot('create-recovery-status.png') });

  await status.getByRole('button', { name: 'Discard incomplete checkout and retry…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Discard the incomplete checkout?');
  await expect(dialog).toContainText('/worktrees/team/failed-create');
  await expect(dialog).toContainText('is reused when its tip is still abc1234');
  // The candidate list is its own region, so the destination cannot satisfy this.
  await expect(dialog.locator('.kb-destructive-consequences code')).toHaveText(['/worktrees/team']);
  await dialog.screenshot({ path: shot('create-recovery-discard-dialog.png') });
});

test('the Git section names the checkout state', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Failed create' }).click();
  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(page.getByText('Checkout: Incomplete (directory on disk, not registered)')).toBeVisible();
  await page.locator('.kb-git').screenshot({ path: shot('create-recovery-git-section.png') });
});

test('a running checkout offers cancellation', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Creating checkout' }).click();
  const status = page.locator('.kb-status-stack');
  await expect(status.getByRole('button', { name: 'Cancel checkout', exact: true })).toBeVisible();
  await expect(status.getByText('Creating the checkout.')).toBeVisible();
  await expect(status.getByText('Reuses the branch left by the failed attempt')).toBeVisible();
  await status.screenshot({ path: shot('create-recovery-cancel.png') });
});
