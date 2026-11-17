import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(HARNESS + '?scenario=decision-editor&theme=host');
}

test('presents a decision stage with only the Stage and Decision tabs', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog.getByRole('tab', { name: /^Stage/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Decision/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: /^Routing/ })).toHaveCount(0);
  await dialog.getByRole('tab', { name: /^Decision/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Decision question' })).toHaveValue('How should this proceed?');
  await expect(dialog.getByRole('textbox', { name: 'Option 1 title' })).toHaveValue('Ship it');
  await expect(dialog.getByRole('combobox', { name: 'Option 1 destination' })).toHaveValue('done');
  await expect(dialog.getByRole('textbox', { name: 'Option 2 title' })).toHaveValue('Fix it');
});

test('adds and removes options in the Decision tab', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByRole('tab', { name: /^Decision/ }).click();
  await dialog.getByRole('button', { name: 'Add option' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Option 3 title' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Option 3 title' }).fill('Ask first');
  await dialog.getByRole('combobox', { name: 'Option 3 destination' }).selectOption('review');
  await dialog.getByRole('button', { name: 'Move option 3 up' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Option 2 title' })).toHaveValue('Ask first');
  await dialog.getByRole('button', { name: 'Remove option 2' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Option 3 title' })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Option 2 title' })).toHaveValue('Fix it');
});

test('switches the stage mode and hides the Decision tab', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByRole('combobox', { name: 'Execution mode' }).selectOption('agent');
  await expect(dialog.getByRole('tab', { name: /^Decision/ })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Routing/ })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Execution mode' }).selectOption('decision');
  await expect(dialog.getByRole('tab', { name: /^Decision/ })).toBeVisible();
});

test('captures the Decision tab in both appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    await page.getByRole('dialog', { name: 'Edit stage' }).getByRole('tab', { name: /^Decision/ }).click();
    await page.getByRole('dialog', { name: 'Edit stage' }).screenshot({ path: path.join(OUT, 'decision-stage-editor-' + scheme + '.png') });
  }
});
