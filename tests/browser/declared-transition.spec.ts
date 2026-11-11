import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

/**
 * The fixture starts in the light appearance and follows the media preference. A
 * contrast measurement is meaningless unless the host really is in the theme the
 * capture claims, so each half asserts the attribute the host sets.
 */
const lightTheme = async (page: import('@playwright/test').Page) => {
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme'), { timeout: 5_000 }).toBeNull();
};
const darkTheme = async (page: import('@playwright/test').Page) => {
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme'), { timeout: 5_000 }).toBe('');
};

/**
 * A transition the agent declared is named for what it is. The status region is
 * the only place the product presents it, and the card's auto chip stays off
 * because the declaration never turns auto mode on.
 */
test('names a declared transition instead of a confirmed action', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=declared');
  await page.waitForSelector('.kb-column');
  await lightTheme(page);
  const card = page.locator('[data-task-id="short"]');
  const line = card.locator('.kb-card-status-line');
  await expect(line).toContainText('Agent-declared transition: waiting');
  await expect(line).not.toContainText('Confirmed action');
  await expect(card.locator('.kb-auto-chip')).toHaveAttribute('aria-pressed', 'false');
  // The status text stays legible against the card the host paints behind it.
  await expectLegible(page, '[data-task-id="short"] .kb-card-status-line');
  await card.screenshot({ path: path.join(OUT, 'declared-transition-card-light.png') });
  await page.screenshot({ path: path.join(OUT, 'declared-transition-board-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await darkTheme(page);
  await expect(line).toContainText('Agent-declared transition: waiting');
  await expectLegible(page, '[data-task-id="short"] .kb-card-status-line');
  await card.screenshot({ path: path.join(OUT, 'declared-transition-card-dark.png') });
  await page.screenshot({ path: path.join(OUT, 'declared-transition-board-dark.png') });
});

/**
 * The drawer carries the longer copy, the error detail, and the recovery
 * controls, so it is captured in the failed state where all three are present.
 */
test('presents a failed declared transition with its recovery in the drawer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=declared-failed');
  await page.waitForSelector('.kb-column');
  await lightTheme(page);
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  const status = drawer.locator('.kb-operation');
  await expect(status).toBeVisible();
  await expect(status.getByRole('status')).toContainText('The agent-declared transition needs attention.');
  await expect(status).toContainText('The agent declared this transition at the end of its turn.');
  await expect(status).toContainText('The instruction could not be admitted.');
  await expect(status.getByRole('button', { name: 'Retry declared transition' })).toBeEnabled();
  await expect(status.getByRole('button', { name: 'Dismiss failed advance' })).toBeEnabled();
  await expectLegible(page, '.kb-drawer .kb-operation [role="status"]');
  await drawer.screenshot({ path: path.join(OUT, 'declared-transition-drawer-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await darkTheme(page);
  await expect(status.getByRole('status')).toContainText('The agent-declared transition needs attention.');
  await expectLegible(page, '.kb-drawer .kb-operation [role="status"]');
  await drawer.screenshot({ path: path.join(OUT, 'declared-transition-drawer-dark.png') });
});
