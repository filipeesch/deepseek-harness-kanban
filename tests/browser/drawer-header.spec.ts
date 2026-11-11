import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

interface HarnessCommand { type: string; taskId?: string; columnId?: string }

async function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as { __harness: { commands(): HarnessCommand[] } }).__harness.commands());
}

async function openDrawer(page: Page, width: number, taskName = 'Long column task 2', scenario = 'activity') {
  await page.addInitScript(value => { try { localStorage.setItem('dsh-kanban.drawer.width', String(value)); } catch { /* storage is optional */ } }, width);
  await page.goto(HARNESS + '?scenario=' + scenario);
  await page.waitForSelector('.kb-card');
  await page.getByRole('button', { name: 'Open task ' + taskName, exact: true }).click();
  await page.waitForSelector('.kb-drawer');
}

async function expectHeaderControls(page: Page) {
  for (const tab of ['Conversations', 'Info', 'Git', 'Notes', 'History']) {
    await expect(page.locator('.kb-drawer').getByRole('tab', { name: new RegExp('^' + tab) })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: 'Move task to' })).toBeVisible();
  await expect(page.locator('.kb-drawer').getByRole('button', { name: 'Move to Propose' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close task details' })).toBeVisible();
  await expect(page.locator('.kb-drawer-header .kb-auto-chip')).toBeVisible();
}

test('the compact header keeps one row at wide and default drawer widths', async ({ page }) => {
  for (const width of [1000, 620]) {
    await openDrawer(page, width);
    const header = page.locator('.kb-drawer-header');
    expect(await header.evaluate(element => getComputedStyle(element).gridTemplateAreas)).toBe('"nav title stage actions"');
    await expectHeaderControls(page);
    await expect(page.locator('.kb-drawer-toolbar')).toHaveCount(0);
    const height = await header.evaluate(element => Math.round(element.getBoundingClientRect().height));
    expect(height).toBeLessThan(70);
    await page.locator('.kb-drawer button[aria-label="Close task details"]').click();
    await expect(page.locator('.kb-drawer')).toHaveCount(0);
  }
});

test('the narrow drawer wraps the header into two rows without hiding controls', async ({ page }) => {
  for (const width of [420, 360]) {
    await openDrawer(page, width);
    const header = page.locator('.kb-drawer-header');
    expect(await header.evaluate(element => getComputedStyle(element).gridTemplateAreas)).toBe('"title actions" "nav stage"');
    await expectHeaderControls(page);
    const height = await header.evaluate(element => Math.round(element.getBoundingClientRect().height));
    expect(height).toBeGreaterThan(70);
    expect(height).toBeLessThan(110);
    const drawerScroll = await page.locator('.kb-drawer').evaluate(element => element.scrollWidth);
    expect(drawerScroll).toBeLessThanOrEqual(width + 2);
    await page.locator('.kb-drawer button[aria-label="Close task details"]').click();
    await expect(page.locator('.kb-drawer')).toHaveCount(0);
  }
});

test('the selected section is visibly marked and keyboard focus keeps its ring', async ({ page }) => {
  await openDrawer(page, 620);
  const selected = page.locator('.kb-icon-tab[aria-selected=true]');
  await expect(selected).toHaveCount(1);
  const styles = await selected.evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    underline: getComputedStyle(element, '::after').backgroundColor,
  }));
  expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.underline).not.toBe('rgba(0, 0, 0, 0)');
  const info = page.locator('.kb-icon-tab').nth(1);
  await info.focus();
  await page.keyboard.press('ArrowRight');
  const focused = page.locator('.kb-icon-tab:focus');
  await expect(focused).toHaveCount(1);
  const outline = await focused.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
  expect(outline.style).not.toBe('none');
  expect(Number.parseFloat(outline.width)).toBeGreaterThan(0);
});

test('a long title truncates on one line with the full text in its tooltip', async ({ page }) => {
  const title = 'A very long task title that should wrap across multiple lines in the narrow card';
  await openDrawer(page, 620, title);
  const heading = page.locator('.kb-drawer-title h2');
  const metrics = await heading.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    overflow: getComputedStyle(element).textOverflow,
    whiteSpace: getComputedStyle(element).whiteSpace,
  }));
  expect(metrics.overflow).toBe('ellipsis');
  expect(metrics.whiteSpace).toBe('nowrap');
  expect(metrics.scroll).toBeGreaterThan(metrics.client);
  await expect(heading).toHaveAttribute('title', title);
});

test('captures the header in both appearances at three widths', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1000, 620, 420]) {
      await openDrawer(page, width, 'Long column task 2', 'appearance');
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(scheme === 'dark' ? '' : null);
      await expect(page.locator('.kb-drawer').getByRole('tab', { name: /^Conversations/ })).toHaveAttribute('aria-selected', 'true');
      await page.locator('.kb-drawer').getByRole('tab', { name: 'Info' }).click();
      await expect(page.locator('.kb-drawer').getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: path.join(OUT, 'drawer-header-' + scheme + '-' + width + '.png') });
      await page.locator('.kb-drawer').getByRole('tab', { name: /^Conversations/ }).click();
      await page.locator('.kb-drawer button[aria-label="Close task details"]').click();
      await expect(page.locator('.kb-drawer')).toHaveCount(0);
    }
  }
});

test('the next-stage action prepares the first execution before moving', async ({ page }) => {
  await openDrawer(page, 620, 'First execution task', 'prepare');
  await page.locator('.kb-drawer').getByRole('button', { name: 'Move to Propose' }).click();
  const dialog = page.getByRole('dialog', { name: 'Prepare the first execution' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('First execution task')).toBeVisible();
  expect(await commands(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await commands(page)).toEqual([]);
});

test('the next-stage action confirms a restricted destination before moving', async ({ page }) => {
  await openDrawer(page, 620, 'Long column task 0', 'restricted-next');
  await page.locator('.kb-drawer').getByRole('button', { name: 'Move to Propose, requires confirmation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to Propose?' });
  await expect(dialog).toBeVisible();
  expect(await commands(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Move anyway' }).click();
  await expect.poll(async () => (await commands(page)).find(command => command.type === 'task.move')).toMatchObject({ type: 'task.move', taskId: 'long-0', columnId: 'propose', overrideTransition: true });
});

test('the next-stage action moves to the next workflow column and arms its instruction', async ({ page }) => {
  await openDrawer(page, 620, 'Long column task 0');
  await page.locator('.kb-drawer').getByRole('button', { name: 'Move to Propose' }).click();
  await expect.poll(async () => (await commands(page)).find(command => command.type === 'task.move')).toMatchObject({ type: 'task.move', taskId: 'long-0', columnId: 'propose' });
  await expect(page.locator('.kb-drawer-autorun')).toContainText('Propose');
  await expect(page.getByRole('tab', { name: /^Conversations/ })).toHaveAttribute('aria-selected', 'true');
});
