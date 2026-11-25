import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the stage agent selection in the stage editor', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=agent-stage-editor');
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  const select = dialog.getByLabel('Stage agent');
  await expect(select).toHaveValue('designer');
  // The main conversation is the empty option; the board's one declared agent follows it.
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option').nth(1)).toHaveText('UX Design (designer)');
  await dialog.screenshot({ path: path.join(OUT, 'agent-stage-editor-light.png') });
  await toDark(page);
  await dialog.screenshot({ path: path.join(OUT, 'agent-stage-editor-dark.png') });
});

test('presents the held entry and the model fallback on the card', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=agent-status-cards');
  await expect(page.getByText('Waiting for the designer agent preset "ux-design"')).toBeVisible();
  await expect(page.getByText(/Using deepseek · chat instead of deepseek · reason: the designer agent could not use it/)).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'agent-status-cards-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'agent-status-cards-dark.png') });
});

test('presents the Agents tab with every row closed', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-agents');
  await page.getByRole('tab', { name: 'Agents' }).click();
  const agents = page.getByRole('group', { name: 'Board agents' });
  await expect(agents).toBeVisible();
  // The closed header already names the model and the preset of each agent.
  await expect(agents.getByRole('button', { name: /^Main / })).toContainText('Host default model');
  await expect(agents.getByRole('button', { name: /UX Design/ })).toContainText('Standard');
  await expect(agents.getByLabel('Main agent name')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'agents-tab-collapsed-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'agents-tab-collapsed-dark.png') });
});

test('opens one agent row to edit it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-agents');
  await page.getByRole('tab', { name: 'Agents' }).click();
  const agents = page.getByRole('group', { name: 'Board agents' });
  await agents.getByRole('button', { name: /UX Design/ }).click();
  await expect(agents.getByLabel('Agent 1 name')).toHaveValue('UX Design');
  await expect(agents.getByLabel('Agent 1 id')).toHaveValue('designer');
  await expect(agents.getByLabel('Agent 1 id')).toHaveAttribute('readonly', '');
  // The model is the host's native selector, not a plain select.
  await expect(agents.getByLabel('Agent 1 preset')).toBeVisible();
  await agents.getByRole('radio', { name: 'Specific model' }).check();
  await expect(agents.getByRole('button', { name: 'Choose conversation model' })).toBeVisible();
  await expect(agents.getByText('Used by Design. Clear the stage before removing this agent.')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'agents-tab-expanded-light.png') });
  await toDark(page);
  await page.screenshot({ path: path.join(OUT, 'agents-tab-expanded-dark.png') });
});

test('keeps MCP as the tools surface', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-agents');
  await page.getByRole('tab', { name: 'MCP' }).click();
  await expect(page.getByRole('group', { name: 'Board MCP tool allowlist' })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'mcp-tab-light.png') });
});
