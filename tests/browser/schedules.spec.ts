import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

/** Resolve the colors the schedule surface renders against the host theme fixture. */
function scheduleContrast(page: Page): Promise<{ title: number; button: number; background: string }> {
  return page.evaluate(() => {
    const channels = (value: string): [number, number, number] => {
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
    const background = (element: Element): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const row = document.querySelector<HTMLElement>('.kb-schedule-list > li');
    if (row === null) return { title: 0, button: 0, background: '' };
    const surface = background(row);
    const title = row.querySelector<HTMLElement>('strong');
    const button = row.querySelector<HTMLElement>('.kb-button');
    return {
      title: title === null ? 0 : contrast(getComputedStyle(title).color, surface),
      button: button === null ? 0 : contrast(getComputedStyle(button).color, surface),
      background: surface,
    };
  });
}

test('lists Hub schedules and validates the editor before saving', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=schedules&theme=host');
  await expect(page.getByRole('heading', { name: 'Schedules', level: 3 })).toBeVisible();
  await expect(page.getByText('Morning review')).toBeVisible();
  await expect(page.getByText('Every day at 09:00')).toBeVisible();
  await expect(page.getByText('Every Monday at 00:00')).toBeVisible();
  await expect(page.getByText(/Next: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/).first()).toBeVisible();
  await expect(page.getByText('Last run sent 2026-10-21 10:00')).toBeVisible();
  const light = await scheduleContrast(page);
  expect(light.background).not.toBe('');
  expect(light.title).toBeGreaterThanOrEqual(4.5);
  expect(light.button).toBeGreaterThanOrEqual(4.5);

  await page.getByRole('button', { name: 'Pause schedule Morning review' }).click();
  await expect(page.getByRole('button', { name: 'Enable schedule Morning review' })).toBeVisible();

  await page.getByRole('button', { name: 'New schedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'New schedule' });
  await expect(dialog.getByText('Every day at 09:00')).toBeVisible();
  await dialog.getByLabel('Schedule title').fill('Nightly digest');
  await dialog.getByLabel('Prompt').fill('Summarize the day.');
  await dialog.getByLabel('Project').selectOption('p');
  await dialog.getByLabel('Cron expression').fill('61 * * * *');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog.getByText(/Expected minute between 0 and 59/)).toBeVisible();
  await dialog.getByLabel('Cron expression').fill('30 22 * * *');
  await expect(dialog.getByText('Every day at 22:30')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('dialog', { name: 'New schedule' })).toBeHidden();
  await expect(page.getByText('Nightly digest')).toBeVisible();

  const commands = await page.evaluate(() => (window as unknown as { __harnessCommands: () => Array<{ type: string }> }).__harnessCommands());
  expect(commands.some(command => command.type === 'schedule.setEnabled')).toBe(true);
  expect(commands.some(command => command.type === 'schedule.save')).toBe(true);
  await page.screenshot({ path: path.join(OUT, 'schedules-light.png') });
});

test('runs a schedule now and reveals its conversation', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=schedules&theme=host');
  await page.getByRole('button', { name: 'Run schedule Morning review now' }).click();
  await expect(page.getByText('Last run sent 2026-10-21 01:00')).toBeVisible();
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.locator('[data-opened="s-schedule"]')).toBeVisible();
  const commands = await page.evaluate(() => (window as unknown as { __harnessCommands: () => Array<{ type: string }> }).__harnessCommands());
  expect(commands.some(command => command.type === 'schedule.runNow')).toBe(true);
});

test('keeps scheduled conversations discoverable under the dark appearance', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(HARNESS + '?scenario=schedules&theme=host');
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
  await expect(page.getByRole('heading', { name: 'Schedules', level: 3 })).toBeVisible();
  await expect(page.getByText('Morning review')).toBeVisible();
  await expect(page.getByText('Never ran.').first()).toBeVisible();
  const dark = await scheduleContrast(page);
  expect(dark.background).not.toBe('');
  expect(dark.title).toBeGreaterThanOrEqual(4.5);
  expect(dark.button).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'schedules-dark.png') });
});