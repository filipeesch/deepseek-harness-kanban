import { expect, type Page } from '@playwright/test';

/** Resolve the colors the plugin actually renders, including host color() values. */
async function channels(page: Page, value: string): Promise<[number, number, number]> {
  return page.evaluate((input: string) => {
    const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(input);
    if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255] as [number, number, number];
    const match = /rgba?\(([^)]+)\)/.exec(input);
    if (match === null) return [0, 0, 0] as [number, number, number];
    const parts = match[1]!.split(',').map(part => Number(part.trim()));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0] as [number, number, number];
  }, value);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [red, green, blue] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function ratio(left: [number, number, number], right: [number, number, number]): number {
  const a = relativeLuminance(left); const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The contrast a rendered element's foreground has against the nearest painted
 * background, measured in the page so the host theme's color() values resolve.
 */
export async function contrastOf(page: Page, selector: string): Promise<number> {
  const values = await page.evaluate((target: string) => {
    const element = document.querySelector<HTMLElement>(target);
    if (element === null) throw new Error('Missing element for contrast: ' + target);
    const background = (start: HTMLElement): string => {
      let current: HTMLElement | null = start;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return { color: getComputedStyle(element).color, background: background(element) };
  }, selector);
  return ratio(await channels(page, values.color), await channels(page, values.background));
}

/** Assert one rendered surface stays legible in the current appearance. */
export async function expectLegible(page: Page, selector: string, minimum = 4.5): Promise<void> {
  expect(await contrastOf(page, selector)).toBeGreaterThanOrEqual(minimum);
}
