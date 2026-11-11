import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const schemes = ['light', 'dark'] as const;

/** Evidence captures for the UX review of the notice changes; not an assertion suite. */
for (const scheme of schemes) {
  test(`evidence: retained checkouts board (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=retained-many');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const notice = page.getByRole('region', { name: 'Destructive operations' });
    await expect(notice).toBeVisible();
    await page.screenshot({ path: `.verification/notice-board-${scheme}.png` });
    await notice.screenshot({ path: `.verification/notice-retained-group-${scheme}.png` });
  });

  test(`evidence: team changes banner (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=updates');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toBeVisible();
    await page.screenshot({ path: `.verification/notice-team-banner-${scheme}.png` });
  });

  test(`evidence: failed destructive operations without dismissal (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=appearance');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const notice = page.getByRole('region', { name: 'Destructive operations' });
    await expect(notice).toBeVisible();
    await notice.screenshot({ path: `.verification/notice-operations-${scheme}.png` });
  });
}
