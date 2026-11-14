import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('marks and focuses the board default preset card', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-preset');
  await page.getByRole('button', { name: 'Open task Short task' }).click();
  const cards = page.getByRole('group', { name: 'Start a conversation' });
  const standard = cards.getByRole('button', { name: /Standard/ });
  await expect(standard).toBeVisible();
  await expect(standard).toHaveAttribute('data-default', 'true');
  await expect(standard.getByText('Board default')).toBeVisible();
  await expect(standard).toBeFocused();
  await expectLegible(page, '.kb-preset-card-badge');
  await page.screenshot({ path: path.join(OUT, 'preset-default-card-light.png') });
  await toDark(page);
  await expect(standard).toHaveAttribute('data-default', 'true');
  await expectLegible(page, '.kb-preset-card-badge');
  await page.screenshot({ path: path.join(OUT, 'preset-default-card-dark.png') });
});

test('presents the board preset fallback notice in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-preset-notice');
  await page.getByRole('button', { name: 'Open task Short task' }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  const cards = page.getByRole('group', { name: 'Start a conversation' });
  await cards.getByRole('button', { name: /Standard/ }).click();
  const notice = page.locator('.kb-preset-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByText('Board preset unavailable')).toBeVisible();
  await expect(notice).toContainText('does not offer standard');
  await expect(notice).toContainText('host default preset');
  await expectLegible(page, '.kb-preset-notice p');
  await page.screenshot({ path: path.join(OUT, 'preset-fallback-notice-light.png') });
  await toDark(page);
  await expect(notice).toBeVisible();
  await expectLegible(page, '.kb-preset-notice p');
  await page.screenshot({ path: path.join(OUT, 'preset-fallback-notice-dark.png') });
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});
