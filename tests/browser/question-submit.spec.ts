import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

function contrastOf(page: Page, selector: string): Promise<{ theme: 'light' | 'dark'; color: string; background: string; contrast: number }> {
  return page.evaluate(selected => {
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
    const target = document.querySelector<HTMLElement>(selected);
    if (target === null) throw new Error('Missing element: ' + selected);
    const color = getComputedStyle(target).color;
    const background = effectiveBackground(target);
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      color,
      background,
      contrast: contrast(color, background),
    };
  }, selector);
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('explains the turn-completion gate in both host appearances', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=question&case=waiting');
    await page.getByRole('radio', { name: 'Local' }).check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const waiting = page.getByText('Waiting for the agent to finish this turn before Submit is available.');
    await expect(waiting).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
    if (scheme === 'light') expect(await page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull();
    else await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    const colors = await contrastOf(page, '.kq-waiting');
    expect(colors.theme).toBe(scheme);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(OUT, `question-waiting-${scheme}.png`) });
  }
});

test('announces a page that arrives while the user is on Additional Notes', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=question&case=new-page');
    await page.getByRole('radio', { name: 'Local' }).check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('textbox', { name: 'Additional Notes' }).fill('Keep this context.');
    await page.getByRole('button', { name: 'Add page' }).click();
    const notice = page.getByText('New question received.');
    await expect(notice).toBeVisible();
    const colors = await contrastOf(page, '.kq-new-page');
    expect(colors.theme).toBe(scheme);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(OUT, `question-new-page-${scheme}.png`) });
    await page.getByRole('button', { name: 'Answer new question' }).click();
    await expect(page.getByRole('heading', { name: /Which theme should we use/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Local' })).toBeChecked();
  }
});

test('a submitted strip leaves the dock while its form stays mounted', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=question&case=hidden');
  await expect(page.locator('form.kq-strip')).toBeHidden();
});
