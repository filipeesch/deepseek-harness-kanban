import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

function dialogContrast(page: Page) {
  return page.evaluate(() => {
    const channels = (value: string): [number, number, number] => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(value);
      if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return [0, 0, 0];
      const parts = match[1]!.split(',').map(part => Number(part.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const luminance = (value: string) => {
      const [red, green, blue] = channels(value).map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (left: string, right: string) => { const a = luminance(left); const b = luminance(right); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const dialog = document.querySelector('.kb-dialog') as HTMLElement;
    const style = getComputedStyle(dialog);
    return { dark: document.body.hasAttribute('data-ds-dark-theme'), background: style.backgroundColor, color: style.color, contrast: contrast(style.color, style.backgroundColor) };
  });
}

test('failed destructive work is visible in the board notice and opens the force consent', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=appearance');
  const notice = page.getByRole('region', { name: 'Destructive operations' });
  await expect(notice).toBeVisible();
  await expect(notice.getByText('Task deletion needs attention: Failed delete')).toBeVisible();
  await notice.getByRole('button', { name: 'Force remove checkout… — Failed delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Force remove shared checkout?' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Force remove checkout' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(confirm).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`force consent keeps host contrast in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=appearance');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await page.getByRole('region', { name: 'Destructive operations' }).getByRole('button', { name: 'Force remove checkout… — Failed delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Force remove shared checkout?' });
    await expect(dialog).toBeVisible();
    const appearance = await dialogContrast(page);
    expect(appearance.dark).toBe(scheme === 'dark');
    expect(appearance.background).not.toBe('');
    expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `.verification/destructive-force-${scheme}.png`, fullPage: false });
  });
}
