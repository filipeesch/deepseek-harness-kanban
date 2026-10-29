import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface Appearance {
  theme: 'light' | 'dark';
  token: string;
  working: string;
  background: string;
  contrast: number;
  shadow: string;
  chip: string;
  chipContrast: number;
  drawerContrast: number;
  pendingContrast: number;
  dangerContrast: number;
}

/** Resolve the colors the plugin actually renders against the host theme fixture. */
function appearance(page: Page): Promise<Appearance> {
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
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const effectiveBackground = (element: Element | null): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const probe = (property: string): string => {
      const span = document.createElement('span');
      span.style.color = `var(${property})`;
      document.body.appendChild(span);
      const value = getComputedStyle(span).color;
      span.remove();
      return value;
    };
    const composite = (foreground: string, backdrop: string, alpha: number): string => {
      const [red, green, blue] = channels(foreground);
      const [backRed, backGreen, backBlue] = channels(backdrop);
      return `rgb(${Math.round(red * alpha + backRed * (1 - alpha))}, ${Math.round(green * alpha + backGreen * (1 - alpha))}, ${Math.round(blue * alpha + backBlue * (1 - alpha))})`;
    };
    const statusContrast = (selector: string): number => {
      const line = document.querySelector<HTMLElement>(selector);
      if (line === null) return 0;
      const card = line.closest('.kb-card');
      const statusBackground = effectiveBackground(card);
      return contrast(getComputedStyle(line).color, statusBackground);
    };
    const working = document.querySelector<HTMLElement>('.kb-working');
    const card = document.querySelector<HTMLElement>('.kb-card[data-working=true]');
    const chip = document.querySelector<HTMLElement>('.kb-background');
    const drawer = document.querySelector<HTMLElement>('.kb-drawer');
    const drawerDetail = drawer?.querySelector<HTMLElement>('.kb-task-background') ?? null;
    const workingColor = working === null ? '' : getComputedStyle(working).color;
    const chipColor = chip === null ? '' : getComputedStyle(chip).color;
    const chipOpacity = chip === null ? 1 : Number(getComputedStyle(chip).opacity);
    const background = effectiveBackground(card);
    const drawerBackground = effectiveBackground(drawer?.querySelector('.kb-drawer-header') ?? drawer);
    const drawerColor = drawerDetail === null ? '' : getComputedStyle(drawerDetail).color;
    const drawerOpacity = drawerDetail === null ? 1 : Number(getComputedStyle(drawerDetail).opacity);
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      token: probe('--dsw-alias-label-deep-diving'),
      working: workingColor,
      background,
      contrast: workingColor === '' ? 0 : contrast(workingColor, background),
      shadow: card === null ? '' : getComputedStyle(card).boxShadow,
      chip: chipColor,
      chipContrast: chipColor === '' ? 0 : contrast(composite(chipColor, background, chipOpacity), background),
      drawerContrast: drawerColor === '' ? 0 : contrast(composite(drawerColor, drawerBackground, drawerOpacity), drawerBackground),
      pendingContrast: statusContrast('.kb-card-status-line.is-pending'),
      dangerContrast: statusContrast('.kb-card-status-line.is-danger'),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('working indicator uses the host token and stays legible in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=appearance');
  const working = page.locator('[data-task-id="long-0"]');
  await expect(working.locator('.kb-working')).toBeVisible();
  const light = await appearance(page);
  expect(light.theme).toBe('light');
  expect(light.token).toBe(light.working);
  expect(light.contrast).toBeGreaterThanOrEqual(4.5);
  expect(light.pendingContrast, 'the pending status tone is legible in light').toBeGreaterThanOrEqual(4.5);
  expect(light.dangerContrast, 'the failure status tone is legible in light').toBeGreaterThanOrEqual(4.5);
  expect(light.shadow).toContain('inset');
  await page.screenshot({ path: path.join(OUT, 'appearance-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await appearance(page);
  expect(dark.theme).toBe('dark');
  expect(dark.token).toBe(dark.working);
  expect(dark.contrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.pendingContrast, 'the pending status tone is legible in dark').toBeGreaterThanOrEqual(4.5);
  expect(dark.dangerContrast, 'the failure status tone is legible in dark').toBeGreaterThanOrEqual(4.5);
  expect(dark.token).not.toBe(light.token);
  await page.screenshot({ path: path.join(OUT, 'appearance-dark.png') });
});

test('drawer header and background detail keep the host appearance across sections', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=appearance');
  await page.getByRole('button', { name: 'Open task Long column task 2', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer.locator('.kb-drawer-header .kb-working')).toBeVisible();
  await expect(drawer.locator('.kb-drawer-header')).toContainText('Background: Research');
  const light = await appearance(page);
  expect(light.drawerContrast, 'the drawer detail is legible in light').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'appearance-drawer-light.png') });
  await drawer.getByRole('tab', { name: 'Info' }).click();
  await expect(drawer.locator('.kb-drawer-header .kb-working')).toBeVisible();
  await expect(drawer.locator('.kb-drawer-header')).toContainText('Background: Research');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await appearance(page);
  expect(dark.chip).not.toBe('');
  expect(dark.chipContrast, 'the background chip is legible').toBeGreaterThanOrEqual(4.5);
  expect(dark.drawerContrast, 'the drawer detail is legible in dark').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'appearance-drawer-dark.png') });
  await expect(page.locator('[data-task-id="long-1"]')).toContainText('1 job');
});
