import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

/**
 * The team-changes banner speaks for the active board. It names that board when the
 * pending work is its own, says so when the work belongs to another board, asks for a
 * plugin update on the board that needs one, and presents a storage block where the
 * action would be instead of failing after the click.
 */
for (const scheme of ['light', 'dark'] as const) {
  test('banner names the active board own work (' + scheme + ')', async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=draft');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toContainText('You have changes to send for this board “Harness board”.');
    await expect(banner.getByRole('button', { name: 'Publish board' })).toBeVisible();
    await page.screenshot({ path: '.verification/banner-active-board-' + scheme + '.png' });
  });

  test('banner does not attribute another board work (' + scheme + ')', async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=draft-other');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toContainText('Another board of this Hub has changes to send.');
    await expect(banner.getByRole('button', { name: 'Publish board' })).toHaveCount(0);
    await page.screenshot({ path: '.verification/banner-other-board-' + scheme + '.png' });
  });

  test('banner presents a storage block before the action (' + scheme + ')', async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=update-required');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toContainText('This team storage was written by a newer plugin version. Update dsh-kanban to read or publish it.');
    await expect(banner.getByRole('button', { name: 'Publish board' })).toHaveCount(0);
    await page.screenshot({ path: '.verification/banner-storage-block-' + scheme + '.png' });
  });

  test('banner asks for a plugin update on one board (' + scheme + ')', async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=update-required-board');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toContainText('This team board was written by a newer plugin version. Update dsh-kanban, then refresh “Harness board”.');
    await expect(banner.getByRole('button', { name: 'Publish board' })).toHaveCount(0);
    await page.screenshot({ path: '.verification/banner-plugin-update-' + scheme + '.png' });
  });
}
