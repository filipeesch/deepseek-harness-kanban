import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface HarnessCommand { type: string; taskId?: string; columnId?: string; expectedEnteredAt?: number; expectedInstruction?: string }

async function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as { __harness: { commands(): HarnessCommand[] } }).__harness.commands());
}

async function openInstructedMove(page: Page, scenario = 'appearance') {
  await page.goto(HARNESS + '?scenario=' + scenario);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await page.clock.install({ time: new Date() });
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('propose');
  await expect(page.locator('.kb-card-countdown')).toBeVisible();
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
    const button = document.querySelector<HTMLElement>('.kb-card-countdown')!;
    const notice = document.querySelector<HTMLElement>('.kb-drawer-autorun')!;
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      button: contrast(getComputedStyle(button).color, background(button)),
      notice: contrast(getComputedStyle(notice).color, background(notice)),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('counts down on the card and in the drawer, then sends once on expiry', async ({ page }) => {
  await openInstructedMove(page, 'board');
  await expect(page.locator('.kb-card-countdown')).toContainText('5s');
  await expect(page.locator('.kb-drawer-autorun')).toContainText('Sending the Propose instruction to Agent 1 in 5s.');
  await page.clock.runFor(2000);
  await expect(page.locator('.kb-card-countdown')).toContainText('3s');
  await page.clock.runFor(3000);
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.runInstruction').length).toBe(1);
  const run = (await commands(page)).find(command => command.type === 'task.runInstruction')!;
  expect(run).toMatchObject({ type: 'task.runInstruction', taskId: 'long-0', columnId: 'propose', expectedInstruction: 'Plan this task.' });
  expect(run.expectedEnteredAt).toEqual(expect.any(Number));
  await expect(page.locator('.kb-card-countdown')).toHaveCount(0);
  await expect(page.locator('.kb-drawer-autorun')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run Propose instruction' })).toHaveCount(0);
  await page.clock.resume();
});

test('cancels from the card without sending', async ({ page }) => {
  await openInstructedMove(page, 'board');
  await page.locator('.kb-card-countdown').click();
  await expect(page.locator('.kb-card-countdown')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run Propose instruction' })).toBeVisible();
  await page.clock.runFor(5000);
  expect((await commands(page)).some(command => command.type === 'task.runInstruction')).toBe(false);
  await page.clock.resume();
});

test('keeps the card height stable when the countdown and the run action appear', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const card = page.locator('[data-task-id="long-0"]');
  const idle = await card.evaluate(element => Math.round(element.getBoundingClientRect().height));
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await page.clock.install({ time: new Date() });
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('propose');
  await expect(page.locator('.kb-card-countdown')).toBeVisible();
  const counting = await card.evaluate(element => Math.round(element.getBoundingClientRect().height));
  await page.locator('.kb-card-countdown').click();
  await expect(page.getByRole('button', { name: 'Run Propose instruction' })).toBeVisible();
  const play = await card.evaluate(element => Math.round(element.getBoundingClientRect().height));
  expect(counting, 'the countdown keeps the reserved activity line').toBe(idle);
  expect(play, 'the run action keeps the reserved activity line').toBe(idle);
  await page.clock.resume();
});

test('cancels from the drawer banner while staying in the current section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await page.getByRole('tab', { name: 'Info' }).click();
  await page.clock.install({ time: new Date() });
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('propose');
  await expect(page.locator('.kb-drawer-autorun')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.kb-drawer-autorun').getByRole('button', { name: 'Cancel automatic Propose instruction' }).click();
  await expect(page.locator('.kb-drawer-autorun')).toHaveCount(0);
  await page.clock.runFor(5000);
  expect((await commands(page)).some(command => command.type === 'task.runInstruction')).toBe(false);
  await page.clock.resume();
});

test('does not resume the countdown after reload and restores the play action', async ({ page }) => {
  await openInstructedMove(page, 'board');
  await page.clock.resume();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.kb-column');
  await expect(page.getByRole('button', { name: 'Open task Long column task 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Propose instruction' })).toBeVisible();
  await page.waitForTimeout(5500);
  expect((await commands(page)).some(command => command.type === 'task.runInstruction')).toBe(false);
});

test('keeps the countdown legible in both appearances and removes the progress bar for reduced motion', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openInstructedMove(page);
  const light = await appearance(page);
  expect(light.theme).toBe('light');
  expect(light.button).toBeGreaterThanOrEqual(4.5);
  expect(light.notice).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'auto-run-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await appearance(page);
  expect(dark.theme).toBe('dark');
  expect(dark.button).toBeGreaterThanOrEqual(4.5);
  expect(dark.notice).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'auto-run-dark.png') });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.kb-countdown-bar').evaluate(element => getComputedStyle(element).display)).toBe('none');
  await page.clock.resume();
});
