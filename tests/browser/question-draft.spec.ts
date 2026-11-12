import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('restores a durable draft on its recorded slide in both host appearances', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=question&case=draft');
    await expect(page.getByRole('radio', { name: 'Local' })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Notes for this answer' })).toHaveValue('Restored from the host.');
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByRole('button', { name: /Submit/ })).toHaveCount(0);
    if (scheme === 'light') expect(await page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull();
    else await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await page.screenshot({ path: path.join(OUT, `question-draft-${scheme}.png`) });
  }
});
