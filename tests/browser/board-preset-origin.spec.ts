import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
type Harness = { mutate(change: (state: { hubs: Array<{ boards: Array<{ defaultPresetMode?: string }> }> }) => void): void; commands(): Array<{ type: string; yaml?: string; presetChoice?: string; expectedRevision?: number }> };
type AgentEntry = { id: string; name: string; preset?: string; model?: unknown };
type Document = { agents?: AgentEntry[] };

async function open(page: Page, mode?: 'operator' | 'host'): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HARNESS + '?scenario=board-model');
  if (mode !== undefined) await page.evaluate(value => {
    (window as unknown as { __harness: Harness }).__harness.mutate(state => {
      state.hubs[0]!.boards[0]!.defaultPresetMode = value;
    });
  }, mode);
  await page.getByRole('button', { name: /^Edit board / }).click();
  // The configuration fixture updates its React snapshot only after a command.
  if (mode !== undefined) await page.getByRole('button', { name: 'Save board name' }).click();
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Agents' }).click();
  await form(page).waitFor();
  await form(page).getByRole('button', { name: /^Main / }).click();
}
const form = (page: Page) => page.getByRole('form', { name: 'Board agents' });
const commands = (page: Page) => page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.commands());
const mainEntry = (sent: { yaml?: string } | undefined): AgentEntry | undefined => {
  const document = parse(sent?.yaml ?? '') as Document;
  return document.agents?.find(agent => agent.id === 'main');
};

test('materializes the implicit operator preset and can clear it for the host default', async ({ page }) => {
  await open(page, 'operator');
  const agents = form(page);
  // The effective metadata choice is presented as the main agent's draft, so the first
  // save of this surface is also the document's migration.
  await expect(agents.getByLabel('Main agent preset')).toHaveValue('kanban-workflow-operator');
  await expect(agents.getByRole('button', { name: 'Save agents' })).toBeDisabled();
  await agents.getByLabel('Main agent preset').selectOption('');
  await agents.getByRole('button', { name: 'Save agents' }).click();
  await expect(page.getByText('Agents saved.')).toBeVisible();
  const sent = (await commands(page)).find(command => command.type === 'board.workflow.save');
  expect(sent).toMatchObject({ expectedRevision: expect.any(Number) });
  // The authored main entry is the choice; no legacy hint and no legacy field remain.
  expect(sent?.presetChoice).toBeUndefined();
  expect(sent?.yaml).not.toContain('agent_preset:');
  expect(mainEntry(sent)).toMatchObject({ id: 'main', name: 'Main' });
  expect(mainEntry(sent)?.preset).toBeUndefined();
});

test('writes a named presets selection on the main agent', async ({ page }) => {
  await open(page, 'host');
  await expect(form(page).getByLabel('Main agent preset')).toHaveValue('');
  await form(page).getByLabel('Main agent preset').selectOption('standard');
  await form(page).getByRole('button', { name: 'Save agents' }).click();
  await expect(page.getByText('Agents saved.')).toBeVisible();
  const sent = (await commands(page)).find(command => command.type === 'board.workflow.save');
  expect(sent?.presetChoice).toBeUndefined();
  expect(sent?.yaml).not.toContain('agent_preset:');
  expect(mainEntry(sent)?.preset).toBe('standard');
});

test('presents the main agent choices in both host appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, 'operator');
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    const row = page.locator('.kb-agent-row[data-agent-key="main"]');
    await expect(row.getByLabel('Main agent preset')).toHaveValue('kanban-workflow-operator');
    await expectLegible(page, '.kb-agent-row[data-agent-key="main"] select');
    await row.screenshot({ path: path.join(OUT, 'board-preset-origin-' + scheme + '.png') });
  }
});
