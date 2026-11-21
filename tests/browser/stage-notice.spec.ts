import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Workflow } from '../../src/shared/types.js';
import { createStageNoticeMessage } from '../../src/host/stage-notice.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification/stage-notice');

const workflow: Workflow = {
  name: 'Delivery', initialColumnId: 'plan', groups: [],
  columns: [
    { id: 'plan', name: 'Plan', description: 'Owns the plan of the change.', onEnterPrompt: 'Plan it.' },
    { id: 'review', name: 'Review', description: 'Owns the verification of the change and reports each finding.', onEnterPrompt: 'Review it.', allowedTransitions: [{ to: 'archive', when: 'Every finding is resolved.' }, { to: 'plan', when: 'A task is unfinished.' }] },
    { id: 'archive', name: 'Archive', description: 'Owns closing the change once it is verified.', onEnterPrompt: 'Archive it.' },
  ],
};
const notice = createStageNoticeMessage(workflow, 'review', 'entry-2');
const text = (notice!.content[0] as { text: string }).text;

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const scheme of ['light', 'dark'] as const) {
  test('the stage notice row delegates to the native disclosure in ' + scheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=stage-notice&text=' + encodeURIComponent(text));
    await page.waitForSelector('details.kb-native-context');
    if (scheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    const row = page.locator('details.kb-native-context');
    await expect(row.locator('summary')).toHaveText('Stage: Review');
    await expect(page.locator('.kb-stage-context-fallback')).toHaveCount(0);
    await expect(row.locator('pre')).toBeHidden();
    await page.screenshot({ path: path.join(OUT, 'stage-notice-' + scheme + '-collapsed.png'), fullPage: true });

    await row.locator('summary').click();
    await expect(row.locator('pre')).toBeVisible();
    await expect(row.locator('pre')).toContainText('Stage notice: the task moved to the Review stage.');
    await expect(row.locator('pre')).toContainText('Stage orientation (facts from the active workflow):');
    await expect(row.locator('pre')).toContainText('Condition: Every finding is resolved.');
    await expect(row.locator('pre')).not.toContainText('Review it.');
    await page.screenshot({ path: path.join(OUT, 'stage-notice-' + scheme + '-expanded.png'), fullPage: true });
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test('the fallback row keeps the stage summary, a disclosure, and host contrast in ' + scheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=stage-notice&fallback=1&text=' + encodeURIComponent(text));
    const row = page.locator('.kb-stage-context-fallback');
    await expect(row).toBeVisible();
    if (scheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    const summary = row.locator('summary');
    await expect(summary).toHaveText('Stage: Review');
    // A flex summary would hide the disclosure marker that tells a reader the row expands.
    expect(await summary.evaluate(element => getComputedStyle(element).display)).not.toBe('flex');
    const colors = await row.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    expect(contrastRatio(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
    await expect(row.locator('pre')).toBeHidden();
    await summary.click();
    await expect(row.locator('pre')).toContainText('the task moved to the Review stage');
    await page.screenshot({ path: path.join(OUT, 'stage-notice-fallback-' + scheme + '.png'), fullPage: true });
  });
}

for (const mode of ['native', 'fallback'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test('a stage notice sits beside a stage instruction row, ' + mode + ' in ' + scheme, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const query = '?scenario=stage-rows' + (mode === 'fallback' ? '&fallback=1' : '') + '&notice=' + encodeURIComponent(text) + '&instruction=' + encodeURIComponent('Stage orientation (facts from the active workflow):\nStage: Review (review), agent-instruction\n\nReview it.');
      await page.goto(HARNESS + query);
      const rows = mode === 'native' ? page.locator('details.kb-native-context') : page.locator('.kb-stage-context-fallback');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('summary')).toHaveText('Stage: Review');
      await expect(rows.nth(1).locator('summary')).toHaveText('Stage: Review - next: Archive');
      await page.screenshot({ path: path.join(OUT, 'stage-rows-' + mode + '-' + scheme + '-collapsed.png'), fullPage: true });
      await rows.nth(0).locator('summary').click();
      await rows.nth(1).locator('summary').click();
      await page.screenshot({ path: path.join(OUT, 'stage-rows-' + mode + '-' + scheme + '-expanded.png'), fullPage: true });
    });
  }
}

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
