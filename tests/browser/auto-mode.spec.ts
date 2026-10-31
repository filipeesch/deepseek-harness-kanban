import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface HarnessCommand { type: string; taskId?: string; enabled?: boolean }

async function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as { __harness: { commands(): HarnessCommand[] } }).__harness.commands());
}

/** Resolve the colors the plugin actually renders, including host color() values. */
async function appearance(page: Page) {
  return page.evaluate(() => {
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
      const a = luminance(left); const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const background = (element: Element): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const chip = document.querySelector<HTMLElement>('[data-task-id="long-0"] .kb-auto-chip')!;
    const toggle = document.querySelector<HTMLElement>('.kb-drawer-auto')!;
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      chip: contrast(getComputedStyle(chip).color, background(chip)),
      toggle: contrast(getComputedStyle(toggle).color, background(toggle)),
    };
  });
}

async function openBoard(page: Page) {
  await page.goto(HARNESS + '?scenario=auto');
  await page.waitForSelector('.kb-column');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the armed, paused, and advancing states on cards', async ({ page }) => {
  await openBoard(page);
  const armed = page.locator('[data-task-id="long-0"] .kb-auto-chip');
  await expect(armed).toHaveAttribute('aria-pressed', 'true');
  await expect(armed).toHaveAttribute('aria-label', 'Turn off auto mode');
  await expect(page.locator('[data-task-id="long-0"] .kb-card-status-line')).toHaveCount(0);

  await expect(page.locator('[data-task-id="long-1"] .kb-card-status-line')).toContainText('Auto mode paused: the turn failed');
  await expect(page.locator('[data-task-id="long-1"] .kb-auto-chip')).toHaveAttribute('data-auto-state', 'paused');

  await expect(page.locator('[data-task-id="short"] .kb-card-status-line')).toContainText('Advancing to Apply…');
  await expect(page.locator('[data-task-id="short"] .kb-card-status-line')).not.toContainText('Confirmed action');

  await expect(page.locator('[data-task-id="long-2"] .kb-card-status-line')).toContainText('Automatic advance failed');
  await expect(page.locator('[data-task-id="long-2"] .kb-auto-chip')).toHaveAttribute('data-auto-state', 'failed');
});

test('toggles auto mode from the card and updates the indicator', async ({ page }) => {
  await openBoard(page);
  const chip = page.locator('[data-task-id="long-1"] .kb-auto-chip');
  await chip.click();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.autoMode').length).toBe(1);
  expect((await commands(page)).find(command => command.type === 'task.autoMode')).toMatchObject({ type: 'task.autoMode', taskId: 'long-1', enabled: false });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-task-id="long-1"] .kb-card-status-line')).toHaveCount(0);
  await expect(page.locator('.kb-drawer')).toHaveCount(0);
});

test('mirrors the toggle in the drawer without changing sections', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  const drawer = page.locator('.kb-drawer');
  const toggle = drawer.getByRole('button', { name: 'Auto mode: on' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toContainText('Auto mode: on');
  await expect(drawer.locator('.kb-drawer-automode')).toContainText('Auto mode is on: the next completed turn moves to Propose.');
  await toggle.click();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.autoMode').length).toBe(1);
  expect((await commands(page)).find(command => command.type === 'task.autoMode')).toMatchObject({ type: 'task.autoMode', taskId: 'long-0', enabled: false });
  await expect(drawer.getByRole('button', { name: 'Auto mode: off' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
});

test('presents an admitted advance without the user-confirmation copy', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=auto');
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer.locator('.kb-operation')).toContainText('The automatic advance is waiting to be dispatched.');
  await expect(drawer.locator('.kb-operation')).not.toContainText('confirmed');
  await expect(drawer.locator('.kb-drawer-automode')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Retry automatic advance' })).toHaveCount(0);
});

test('presents a failed automatic advance with retry and dismiss recovery', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=auto');
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Long column task 2', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer.locator('.kb-operation')).toContainText('The automatic advance needs attention.');
  await expect(drawer.locator('.kb-drawer-automode')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Retry automatic advance' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Dismiss failed advance' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cancel action and return to base' })).toHaveCount(0);
});

test('keeps the auto-mode controls legible in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoard(page);
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  const light = await appearance(page);
  expect(light.theme).toBe('light');
  expect(light.chip).toBeGreaterThanOrEqual(4.5);
  expect(light.toggle).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'auto-mode-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await appearance(page);
  expect(dark.theme).toBe('dark');
  expect(dark.chip).toBeGreaterThanOrEqual(4.5);
  expect(dark.toggle).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'auto-mode-dark.png') });
});
