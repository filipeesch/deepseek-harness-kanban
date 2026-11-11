import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

/** Wait until the drawer's opening fade finished, so evidence shows the settled surface. */
async function waitForDrawerSettled(page: Page): Promise<void> {
  await expect.poll(() => page.locator('.kb-drawer').evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
  await page.locator('.kb-drawer').evaluate(async element => {
    const animations = element.getAnimations({ subtree: true })
      .filter(animation => (animation.effect?.getComputedTiming().iterations ?? 1) !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  });
}

async function openHistory(page: Page, scheme: 'light' | 'dark', scenario = 'history'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(HARNESS + '?scenario=' + scenario);
  await page.waitForSelector('.kb-card');
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await page.waitForSelector('.kb-drawer');
  await waitForDrawerSettled(page);
  await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
  await page.waitForSelector('.kb-history');
}

/** Contrast of one cell's text against the surface it is painted on. */
function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate(element => {
    const channels = (value: string): [number, number, number] => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(value);
      if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return [0, 0, 0];
      const parts = match[1]!.split(',').map(part => Number(part.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const luminance = (value: string): number => {
      const [red, green, blue] = channels(value).map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (left: string, right: string): number => {
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const backgroundOf = (start: Element | null): string => {
      let current = start;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return contrast(getComputedStyle(element).color, backgroundOf(element));
  });
}

test('the History section presents the recorded flow as a four-column table', async ({ page }) => {
  await openHistory(page, 'light');
  const table = page.getByRole('table', { name: 'Task history' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['When', 'Event', 'Detail', 'In stage']);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  // Newest first: the worktree outcome precedes the creation it followed.
  await expect(rows.first()).toContainText('Worktree created');
  await expect(rows.first()).toContainText('/worktrees/harness (task/harness)');
  await expect(rows.last()).toContainText('Created');
  await expect(rows.last()).toContainText('Explore');
  // A stage row carries its duration; a non-stage row shows the placeholder.
  await expect(rows.nth(1).locator('.kb-history-duration')).toHaveText('—');
  await expect(rows.nth(2)).toContainText('Stage changed');
  await expect(rows.nth(2).locator('.kb-history-duration')).not.toHaveText('—');
  // The moment is machine-readable and the visible text is the reader's local form.
  const moment = await rows.first().locator('time').getAttribute('datetime');
  expect(moment).toBe('2026-11-11T10:00:00.000Z');
});

test('the History section keeps the drawer open and keeps host contrast in both appearances', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await openHistory(page, scheme);
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(scheme === 'dark' ? '' : null);
    await expect(page.locator('.kb-drawer').getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.kb-history')).toBeVisible();
    // Every text cell keeps AA, including the warning label and the muted columns.
    expect(await contrastOf(page, '.kb-history tr[data-tone=warning] .kb-history-event')).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.kb-history tr[data-tone=accent] .kb-history-event')).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.kb-history .kb-history-time')).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, '.kb-history th')).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(OUT, 'history-' + scheme + '.png') });
    await page.locator('.kb-drawer').getByRole('tab', { name: 'Info' }).click();
    await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('.kb-history')).toBeVisible();
  }
});

test('a long record is reachable by scrolling the section, with nothing withheld', async ({ page }) => {
  await openHistory(page, 'light', 'history-long');
  const rows = page.locator('.kb-history tbody tr');
  await expect(rows).toHaveCount(41);
  await expect(rows.last()).toContainText('Created');
  const metrics = await page.locator('.kb-drawer-panel').evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);
  expect(await rows.count()).toBe(41);
  await expect(page.getByRole('button', { name: /load more|show more/i })).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'history-long-light.png') });
  // The narrowest supported drawer keeps every column without horizontal scrolling.
  await page.setViewportSize({ width: 420, height: 900 });
  await expect.poll(() => page.locator('.kb-history').evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await expect(rows).toHaveCount(41);
  await page.screenshot({ path: path.join(OUT, 'history-narrow-light.png') });
});
