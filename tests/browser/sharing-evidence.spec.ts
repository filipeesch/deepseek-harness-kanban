import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const schemes = ['light', 'dark'] as const;

/** Evidence captures for the UX review of per-board publishing. Not an assertion suite. */
for (const scheme of schemes) {
  test(`evidence: board banner offers the board update action (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=updates');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const banner = page.locator('.kb-share-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Get updates' })).toBeVisible();
    await page.screenshot({ path: `.verification/sharing-banner-${scheme}.png` });
    await banner.screenshot({ path: `.verification/sharing-banner-only-${scheme}.png` });
  });

  if (scheme === 'light') test('evidence: Team Settings per-board actions (light)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(HARNESS + '?scenario=publishing&sharing=review');
    const section = page.getByRole('region', { name: 'Changes' });
    await expect(section).toBeVisible();
    await page.screenshot({ path: '.verification/sharing-settings-light.png' });
  });

  test(`evidence: Team Settings board drafts and updates (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=sharing&sharing=mixed');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await page.getByRole('button', { name: 'Configuration' }).click();
    await page.getByRole('tab', { name: 'Team Settings' }).click();
    await page.screenshot({ path: `.verification/sharing-settings-mixed-${scheme}.png` });
  });
}
