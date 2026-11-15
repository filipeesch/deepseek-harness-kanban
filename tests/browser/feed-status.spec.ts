import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { contrastOf } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('keeps the board status on the page and out of an ordinary chat dock', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=feed-status');
    if (scheme === 'light') expect(await page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull();
    else await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');

    const strip = page.locator('.kanban-feed-error');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Kanban updates are unavailable: Kanban state stream ended; reconnecting.');
    // The strip renders the host error token for the current appearance, not a fixed color.
    expect(await strip.evaluate(element => getComputedStyle(element).color)).toBe(scheme === 'light' ? 'rgb(236, 19, 19)' : 'rgb(242, 90, 90)');
    // The host's error token sits exactly on the AA boundary in light appearance
    // (rgb(236,19,19) on white measures ~4.4977:1); the 0.01 tolerance absorbs rounding only.
    expect(await contrastOf(page, '.kanban-feed-error')).toBeGreaterThanOrEqual(4.49);

    const dock = page.locator('[data-conversation="ordinary"]');
    await expect(dock.getByRole('alert')).toContainText('Question rounds are unavailable: Question rounds stream ended; reconnecting.');
    await expect(dock.getByRole('button', { name: 'Retry questions' })).toBeVisible();
    // A board failure is never presented by the question dock.
    await expect(dock.getByText(/Kanban updates are unavailable/)).toHaveCount(0);
    await expect(dock.getByRole('button', { name: 'Retry updates' })).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT, `feed-status-separation-${scheme}.png`) });
  }
});

test('presents no board status when the feed is available and keeps the dock usable', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=feed-status&state=healthy');
    if (scheme === 'light') expect(await page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull();
    else await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');

    await expect(page.locator('.kanban-feed-error')).toHaveCount(0);
    const dock = page.locator('[data-conversation="ordinary"]');
    await expect(dock.getByRole('heading', { name: /Which storage should we use/ })).toBeVisible();
    await expect(dock.getByRole('alert')).toHaveCount(0);

    await page.screenshot({ path: path.join(OUT, `feed-status-healthy-${scheme}.png`) });
  }
});

test('keeps the question surface usable while the board feed is unavailable', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=feed-status&state=round');
    await expect(page.locator('.kanban-feed-error')).toBeVisible();
    const dock = page.locator('[data-conversation="ordinary"]');
    // The round is present and answerable while the board reports its own failure.
    await expect(dock.getByRole('heading', { name: /Which storage should we use/ })).toBeVisible();
    const local = dock.getByRole('radio', { name: 'Local' });
    await local.check();
    await expect(local).toBeChecked();
    await expect(dock.getByRole('alert')).toHaveCount(0);
    await expect(dock.getByText(/Kanban updates are unavailable/)).toHaveCount(0);
    await page.screenshot({ path: path.join(OUT, `feed-status-question-during-board-failure-${scheme}.png`) });
  }
});

