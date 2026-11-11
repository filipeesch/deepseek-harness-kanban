import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification/task-message');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('the fallback row keeps the sender summary, a disclosure, and host contrast', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=task-message&fallback=1');
    const row = page.locator('.kb-task-message-fallback');
    await expect(row).toBeVisible();
    if (scheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    const summary = row.locator('summary');
    await expect(summary).toHaveText('Task message from Prepare release');
    expect(await summary.evaluate(element => getComputedStyle(element).display)).not.toBe('flex');
    const colors = await row.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    expect(colors.background).toBe(scheme === 'light' ? 'rgb(247, 247, 247)' : 'rgb(31, 31, 35)');
    expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
    await expect(row.locator('pre')).toBeHidden();
    await summary.click();
    await expect(row.locator('pre')).toBeVisible();
    await expect(row.locator('pre')).toContainText('deployment window');
    await page.screenshot({ path: path.join(OUT, 'task-message-fallback-' + scheme + '.png'), fullPage: true });
  }
});

function channel(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}
function luminance(value: string): number {
  const [red, green, blue] = (value.match(/\d+/g) ?? []).map(Number);
  return 0.2126 * channel(red ?? 0) + 0.7152 * channel(green ?? 0) + 0.0722 * channel(blue ?? 0);
}
function contrastRatio(foreground: string, background: string): number {
  const [high = 0, low = 0] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

for (const scheme of ['light', 'dark'] as const) {
  test('the task-message row delegates to the native disclosure in ' + scheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=task-message');
    await page.waitForSelector('details.kb-native-context');
    if (scheme === 'dark') {
      await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    }
    const row = page.locator('details.kb-native-context');
    await expect(row.locator('summary')).toHaveText('Task message from Prepare release');
    await expect(page.locator('.kb-task-message-fallback')).toHaveCount(0);
    await expect(row.locator('pre')).toBeHidden();
    await page.screenshot({ path: path.join(OUT, 'task-message-' + scheme + '-collapsed.png'), fullPage: true });

    await row.locator('summary').click();
    await expect(row.locator('pre')).toBeVisible();
    await expect(row.locator('pre')).toContainText('Prepare release');
    await expect(row.locator('pre')).toContainText('deployment window');
    await page.screenshot({ path: path.join(OUT, 'task-message-' + scheme + '-expanded.png'), fullPage: true });
  });
}
