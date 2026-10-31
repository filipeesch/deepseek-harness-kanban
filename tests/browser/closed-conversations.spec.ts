import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('keeps closed conversations behind a compact chip and dismisses its popover with Escape', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '360'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=appearance');
  await page.getByRole('button', { name: 'Open task Closed conversation task', exact: true }).click();

  const drawer = page.locator('.kb-drawer');
  const chip = drawer.getByRole('button', { name: '11 closed conversations' });
  await expect(drawer.locator('.kb-session-toolbar .kb-closed-chip')).toBeVisible();
  await expect(drawer.locator('.kb-closed')).toHaveCount(0);
  await expect(drawer).toHaveCSS('width', '360px');
  await expect(chip).toBeVisible();
  const panelBefore = await drawer.locator('.kb-conversation-panel').boundingBox();

  await chip.click();
  const popover = drawer.getByRole('dialog', { name: 'Closed conversations' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Reopen Agent 2' })).toBeFocused();
  await expect.poll(async () => popover.locator('.kb-closed-list').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const panelAfter = await drawer.locator('.kb-conversation-panel').boundingBox();
  expect(panelAfter?.height).toBe(panelBefore?.height);
  await page.screenshot({ path: path.join(OUT, 'closed-conversations-light.png') });

  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(drawer).toBeVisible();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await chip.click();
  await expect(popover).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'closed-conversations-dark.png') });
});
