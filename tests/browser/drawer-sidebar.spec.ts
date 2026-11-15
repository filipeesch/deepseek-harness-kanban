import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { contrastOf } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

/** The drawer paints a one-pixel border outside its inline width, and a close re-renders. */
async function expectDrawerWidth(drawer: Locator, expected: number): Promise<void> {
  await expect.poll(async () => {
    const box = await drawer.boundingBox();
    return box === null ? false : Math.abs(box.width - expected) <= 1;
  }).toBe(true);
}

async function expand(page: Page, sessionId = 's-closed'): Promise<void> {
  await page.evaluate(id => {
    (window as unknown as { __drawerSidebar: { setExpanded(id: string, value: boolean): void } }).__drawerSidebar.setExpanded(id, true);
  }, sessionId);
}

async function collapse(page: Page, sessionId = 's-closed'): Promise<void> {
  await page.evaluate(id => {
    (window as unknown as { __drawerSidebar: { setExpanded(id: string, value: boolean): void } }).__drawerSidebar.setExpanded(id, false);
  }, sessionId);
}

test('opens the rail, grows the drawer, resizes it and restores the base width', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-sidebar');

  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.kb-workspace-rail')).toHaveCount(0);
  await expectDrawerWidth(drawer, 620);

  await expand(page);
  const rail = drawer.getByRole('region', { name: 'Right Sidebar' });
  await expect(rail).toBeVisible();
  const divider = drawer.getByRole('separator', { name: 'Resize right Sidebar' });
  await expect(divider).toBeVisible();
  await expect(divider).toHaveAttribute('aria-valuenow', '320');
  await expect(drawer.locator('.kb-workspace')).toHaveAttribute('data-workspace-mode', 'split');

  await expect.poll(async () => drawer.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await expectDrawerWidth(drawer, 748);
  const conversation = await drawer.locator('.kb-workspace-conversation').boundingBox();
  // The divider and the rail border take a couple of pixels from the 420 target.
  expect(conversation!.width).toBeGreaterThanOrEqual(416);
  expect(await contrastOf(page, '[data-testid="fake-panel"]')).toBeGreaterThan(4.5);
  await page.screenshot({ path: path.join(OUT, 'drawer-sidebar-split-light.png') });

  // The divider is keyboard operable and remembers the chosen width.
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '352');
  expect(await page.evaluate(() => window.localStorage.getItem('dsh-kanban.rail.width'))).toBe('352');

  // Collapsing returns to the persisted base width.
  await collapse(page);
  await expect(drawer.locator('.kb-workspace-rail')).toHaveCount(0);
  await expectDrawerWidth(drawer, 620);

  // Reopening and reloading keep the rail width.
  await expand(page);
  await expect(divider).toHaveAttribute('aria-valuenow', '352');
  await page.reload();
  await expect(drawer).toBeVisible();
  await expand(page);
  await expect(drawer.getByRole('separator', { name: 'Resize right Sidebar' })).toHaveAttribute('aria-valuenow', '352');
  await expect(drawer.getByRole('region', { name: 'Right Sidebar' })).toBeVisible();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
  expect(await contrastOf(page, '[data-testid="fake-panel"]')).toBeGreaterThan(4.5);
  await page.screenshot({ path: path.join(OUT, 'drawer-sidebar-split-dark.png') });
});

test('covers the conversation when the viewport cannot fit both', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-sidebar');
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expand(page);
  const rail = drawer.getByRole('region', { name: 'Right Sidebar' });
  await expect(rail).toBeVisible();
  await expect(drawer.locator('.kb-workspace')).toHaveAttribute('data-workspace-mode', 'cover');
  await expect(drawer.getByRole('separator', { name: 'Resize right Sidebar' })).toHaveCount(0);
  const conversation = drawer.locator('.kb-workspace-conversation');
  await expect(conversation).toHaveAttribute('aria-hidden', 'true');
  const railBox = await rail.boundingBox();
  const panel = await drawer.locator('.kb-conversation-panel').boundingBox();
  expect(Math.round(railBox!.width)).toBe(Math.round(panel!.width));
  await page.screenshot({ path: path.join(OUT, 'drawer-sidebar-cover-light.png') });
});

test('keeps the drawer unchanged on a host without the panel capability', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-sidebar&port=none');
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[data-native="s-closed"]')).toBeVisible();
  await expect(drawer.locator('.kb-workspace')).toHaveCount(0);
  await expect(drawer.getByRole('region', { name: 'Right Sidebar' })).toHaveCount(0);
  await expect(drawer.getByRole('separator', { name: 'Resize right Sidebar' })).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expectDrawerWidth(drawer, 620);
});

test('binds the rail to the active conversation Session', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-sidebar');
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expand(page, 's-closed');
  await expect(drawer.getByRole('region', { name: 'Right Sidebar' })).toBeVisible();

  await page.getByRole('button', { name: 'Open task Other task' }).click();
  await expect(drawer.locator('[data-native="s-other"]')).toBeVisible();
  await expect(drawer.locator('.kb-workspace-rail')).toHaveCount(0);

  await expand(page, 's-other');
  await expect(drawer.getByRole('region', { name: 'Right Sidebar' })).toBeVisible();
});
test('resizes the rail with the pointer and remembers the width', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-sidebar');
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expand(page);
  const divider = drawer.getByRole('separator', { name: 'Resize right Sidebar' });
  await expect(divider).toBeVisible();
  const box = await divider.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 - 32, box!.y + box!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '352');
  expect(await page.evaluate(() => window.localStorage.getItem('dsh-kanban.rail.width'))).toBe('352');
  await expectDrawerWidth(drawer, 780);
});
