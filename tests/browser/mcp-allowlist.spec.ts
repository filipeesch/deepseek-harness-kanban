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

test('presents the board MCP allowlist in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-mcp');
  await page.getByRole('button', { name: /^Edit board / }).click();
  await boardTabs(page).waitFor();
  await boardTabs(page).getByRole('tab', { name: 'MCP' }).click();
  const form = page.getByRole('form', { name: 'Board defaults' });
  const fieldset = form.getByRole('group', { name: 'Board MCP tool allowlist' });
  await expect(fieldset).toBeVisible();
  await expect(fieldset.getByRole('radio', { name: 'Every server' })).toBeChecked();
  await expect(fieldset.getByText(/Every MCP server this host configures/)).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'board-mcp-every-server-light.png') });

  await fieldset.getByRole('radio', { name: 'Selected servers' }).check();
  await fieldset.getByRole('checkbox', { name: /atlassian/ }).check();
  await fieldset.getByLabel('Add MCP server or tool').fill('trino/query');
  await fieldset.getByRole('button', { name: 'Add entry' }).click();
  await expect(fieldset.getByRole('button', { name: 'Remove trino/query' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save defaults' })).toBeEnabled();
  await expectLegible(page, '.kb-mcp-entries code');
  await page.screenshot({ path: path.join(OUT, 'board-mcp-selected-light.png') });

  await toDark(page);
  await expect(fieldset).toBeVisible();
  await expectLegible(page, '.kb-mcp-entries code');
  await page.screenshot({ path: path.join(OUT, 'board-mcp-selected-dark.png') });
});

test('keeps an explicit empty selection distinct from every server', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board-mcp');
  await page.getByRole('button', { name: /^Edit board / }).click();
  await boardTabs(page).waitFor();
  await boardTabs(page).getByRole('tab', { name: 'MCP' }).click();
  const form = page.getByRole('form', { name: 'Board defaults' });
  const fieldset = form.getByRole('group', { name: 'Board MCP tool allowlist' });
  await fieldset.getByRole('radio', { name: 'Selected servers' }).check();
  await expect(fieldset.getByText(/No server is allowed/)).toBeVisible();
  await form.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
});
