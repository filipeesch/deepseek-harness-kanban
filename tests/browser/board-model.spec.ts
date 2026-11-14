import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const boardTabs = (page: Page) => page.getByRole('tablist', { name: 'Board configuration sections' });

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the board defaults with the native selector in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model');
  await boardTabs(page).getByRole('tab', { name: 'Defaults' }).click();
  const form = page.getByRole('form', { name: 'Board defaults' });
  await expect(form.getByRole('heading', { name: 'Defaults' })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Specific model' })).toBeChecked();
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · reason · high');
  await expect(form.getByRole('radio', { name: /Standard/ })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Host default preset' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
  await expect(form.getByText('No changes to save.')).toBeVisible();
  await expectLegible(page, '[data-stub-current]');
  await page.screenshot({ path: path.join(OUT, 'board-defaults-light.png') });

  await page.getByRole('button', { name: 'Choose Chat' }).click();
  await expect(form.getByRole('button', { name: 'Save defaults' })).toBeEnabled();
  await form.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · chat');

  await toDark(page);
  await expectLegible(page, '[data-stub-current]');
  await page.screenshot({ path: path.join(OUT, 'board-defaults-dark.png') });
});

test('removes the board model when the host default is chosen', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await boardTabs(page).getByRole('tab', { name: 'Defaults' }).click();
  const form = page.getByRole('form', { name: 'Board defaults' });
  await form.getByRole('radio', { name: 'Host default model' }).check();
  await expect(page.locator('[data-stub-model-seat]')).toHaveCount(0);
  await form.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Host default model' })).toBeChecked();
  const yaml = await page.evaluate(() => (window as unknown as { __harness: { snapshot(): { state: { hubs: Array<{ boards: Array<{ workflowYaml: string }> }> } } } }).__harness.snapshot().state.hubs[0]!.boards[0]!.workflowYaml);
  expect(yaml).not.toContain('model:');
});

test('keeps a stored route the host no longer offers', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model&route=stale');
  await boardTabs(page).getByRole('tab', { name: 'Defaults' }).click();
  await expect(page.getByText(/is not offered by this host/)).toBeVisible();
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · retired · high');
  await expect(page.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
});

test('presents the stored route read-only when the host composes no selector', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model-no-seat');
  await boardTabs(page).getByRole('tab', { name: 'Defaults' }).click();
  await expect(page.getByText(/The native model selector is unavailable/)).toBeVisible();
  await expect(page.getByText(/deepseek · reason/)).toBeVisible();
  await expect(page.locator('[data-stub-model-seat]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0);
});
