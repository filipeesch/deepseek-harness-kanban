import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

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

async function openDrawer(page: Page, scheme: 'light' | 'dark', taskName: string): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(HARNESS + '?scenario=relations');
  await page.waitForSelector('.kb-card');
  await page.getByRole('button', { name: 'Open task ' + taskName, exact: true }).click();
  await page.waitForSelector('.kb-drawer');
  await waitForDrawerSettled(page);
  await page.locator('.kb-drawer').getByRole('tab', { name: 'Relations' }).click();
}

test('the Relations section sits before History and lists both directions', async ({ page }) => {
  await openDrawer(page, 'light', 'Long column task 0');
  const tabs = page.getByRole('tablist', { name: 'Task sections' }).getByRole('tab');
  await expect(tabs).toHaveCount(6);
  await expect(page.locator('.kb-drawer').getByRole('tab', { name: 'Relations' })).toHaveAttribute('aria-selected', 'true');
  // The tabs are icon-only, so their order is read from the accessible identity.
  expect(await tabs.evaluateAll(nodes => nodes.map(node => node.id.replace(/^.*-tab-/, ''))))
    .toEqual(['Conversations', 'Info', 'Git', 'Notes', 'Relations', 'History']);

  const rows = page.locator('.kb-relations-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.kb-relations-label')).toHaveText('Epic of Long column task 1');
  await expect(rows.nth(0).locator('.kb-relations-stage')).toHaveText('Explore');
  await expect(rows.nth(1).locator('.kb-relations-label')).toHaveText('Related to Short task');
  await expect(rows.nth(1).locator('.kb-relations-stage')).toHaveText('Propose');
  // Both cards live on this board, so the row does not repeat the board name.
  await expect(page.locator('.kb-relations-board')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'relations-light.png') });
});

test('the Relations section is read-only and keeps host contrast in both appearances', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await openDrawer(page, scheme, 'Long column task 0');
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(scheme === 'dark' ? '' : null);
    await expect(page.locator('.kb-relations')).toBeVisible();
    // The section offers no way to write a relation.
    await expect(page.locator('.kb-relations').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /add relation|remove relation|link card/i })).toHaveCount(0);
    await expectLegible(page, '.kb-relations-label');
    await expectLegible(page, '.kb-relations-stage');
    await page.screenshot({ path: path.join(OUT, 'relations-' + scheme + '.png') });
    await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('table', { name: 'Task history' })).toBeVisible();
    await page.locator('.kb-drawer').getByRole('tab', { name: 'Relations' }).click();
    await expect(page.locator('.kb-relations')).toBeVisible();
  }
});

test('the Relations section reports a card with no relation', async ({ page }) => {
  await openDrawer(page, 'light', 'Other task');
  await expect(page.locator('.kb-drawer').getByRole('status')).toHaveText('No relations for this task yet.');
  await expect(page.locator('.kb-relations-row')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'relations-empty-light.png') });
});
