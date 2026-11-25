import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const boardTabs = (page: Page) => page.getByRole('tablist', { name: 'Board configuration sections' });
const agentsForm = (page: Page) => page.getByRole('form', { name: 'Board agents' });
const mainRow = (page: Page) => agentsForm(page).getByRole('button', { name: /^Main / });

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

/** Board configuration is reached from the Boards section: Edit opens it over the list. */
async function openBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Edit board / }).click();
  await page.getByRole('tablist', { name: 'Board configuration sections' }).waitFor();
}
async function openAgents(page: Page): Promise<void> {
  await openBoard(page);
  await boardTabs(page).getByRole('tab', { name: 'Agents' }).click();
  await agentsForm(page).waitFor();
  await mainRow(page).click();
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the main agent model with the native selector in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model');
  await openAgents(page);
  const form = agentsForm(page);
  await expect(form.getByRole('radio', { name: 'Specific model' })).toBeChecked();
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · reason · high');
  await expect(form.getByLabel('Main agent preset')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save agents' })).toBeDisabled();
  await expectLegible(page, '[data-stub-current]');
  await form.screenshot({ path: path.join(OUT, 'agents-model-light.png') });

  await page.getByRole('button', { name: 'Choose conversation model' }).click();
  await page.getByRole('menuitem', { name: 'Choose Chat' }).click();
  await expect(form.getByRole('button', { name: 'Save agents' })).toBeEnabled();
  await form.getByRole('button', { name: 'Save agents' }).click();
  await expect(page.getByText('Agents saved.')).toBeVisible();
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · chat');

  await toDark(page);
  await expectLegible(page, '[data-stub-current]');
  await form.screenshot({ path: path.join(OUT, 'agents-model-dark.png') });
});

test('removes the main agent model when the host default is chosen', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await openAgents(page);
  const form = agentsForm(page);
  await form.getByRole('radio', { name: 'Host default', exact: true }).check();
  // The host default hides the native selector instead of leaving a disabled control.
  await expect(page.locator('[data-stub-model-seat]')).toHaveCount(0);
  await form.getByRole('button', { name: 'Save agents' }).click();
  await expect(page.getByText('Agents saved.')).toBeVisible();
  const yaml = await page.evaluate(() => (window as unknown as { __harness: { snapshot(): { state: { hubs: Array<{ boards: Array<{ workflowYaml: string }> }> } } } }).__harness.snapshot().state.hubs[0]!.boards[0]!.workflowYaml);
  expect(yaml).not.toContain('model:');
});

test('keeps a stored route the host no longer offers', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model&route=stale');
  await openAgents(page);
  await expect(page.locator('[data-stub-current]')).toHaveText('deepseek · retired · high');
  await expect(page.getByRole('button', { name: 'Save agents' })).toBeDisabled();
});

test('presents the stored route read-only when the host composes no selector', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model-no-seat');
  await openAgents(page);
  await expect(page.getByText(/The native model selector is unavailable/)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Board agents' }).getByText(/This board keeps deepseek · reason/)).toBeVisible();
  await expect(page.locator('[data-stub-model-seat]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0);
});

test('keeps the overlay at one size while navigating', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-model');
  await openBoard(page);
  const dialog = page.getByRole('dialog', { name: /Board configuration · / });
  const height = async (): Promise<number> => Math.round((await dialog.boundingBox())!.height);
  const general = await height();
  await boardTabs(page).getByRole('tab', { name: 'Agents' }).click();
  await page.waitForTimeout(200);
  expect(await height()).toBe(general);
  await boardTabs(page).getByRole('tab', { name: 'MCP' }).click();
  await page.waitForTimeout(200);
  expect(await height()).toBe(general);
  await boardTabs(page).getByRole('tab', { name: 'Workflow' }).click();
  await page.waitForTimeout(200);
  expect(await height()).toBe(general);
});
