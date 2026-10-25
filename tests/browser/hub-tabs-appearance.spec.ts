import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

function contrast(page: Page) {
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
    const ratio = (left: string, right: string): number => {
      const a = luminance(left); const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const background = (element: Element | null): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const active = document.querySelector<HTMLElement>('.kb-hub-tab.is-active')!;
    const inactive = [...document.querySelectorAll<HTMLElement>('.kb-hub-tab')].find(tab => !tab.classList.contains('is-active'))!;
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      activeContrast: ratio(getComputedStyle(active).color, background(active)),
      inactiveContrast: ratio(getComputedStyle(inactive).color, background(inactive)),
      activeBackground: background(active),
      inactiveBackground: background(inactive),
      activityDot: Boolean(active.querySelector('.kb-dot.kb-activity')),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('Hub tabs keep readable contrast in both host appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=hubs');
  await page.waitForSelector('.kb-hub-tab');
  const light = await contrast(page);
  expect(light.theme).toBe('light');
  expect(light.activeContrast).toBeGreaterThanOrEqual(4.5);
  expect(light.inactiveContrast).toBeGreaterThanOrEqual(4.5);
  expect(light.activityDot).toBe(true);
  await page.screenshot({ path: path.join(OUT, 'hub-tabs-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await contrast(page);
  expect(dark.theme).toBe('dark');
  expect(dark.activeContrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.inactiveContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'hub-tabs-dark.png') });
});
