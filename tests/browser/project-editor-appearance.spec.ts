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
    const card = document.querySelector<HTMLElement>('.kb-detection')!;
    const title = card.querySelector('strong')!;
    const field = document.querySelector<HTMLElement>('input[aria-label="Project name"]')!;
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      titleContrast: ratio(getComputedStyle(title).color, background(card)),
      fieldContrast: ratio(getComputedStyle(field).color, background(field)),
      cardBackground: background(card),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

async function openDetectedDialog(page: Page) {
  await page.goto(HARNESS + '?scenario=project-editor');
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Project path' }).fill('/repo/apps/web');
  await page.getByRole('textbox', { name: 'Project name' }).click();
  await expect(page.getByText('Git repository')).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test('project editor keeps readable contrast in ' + scheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDetectedDialog(page);
    const values = await contrast(page);
    expect(values.theme).toBe(scheme);
    expect(values.titleContrast).toBeGreaterThanOrEqual(4.5);
    expect(values.fieldContrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(OUT, 'project-editor-' + scheme + '.png'), fullPage: true });
  });
}
