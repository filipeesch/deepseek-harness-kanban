import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
type Harness = { mutate(change: (state: { hubs: Array<{ boards: Array<{ defaultPresetMode?: string; workflow: { agentPreset?: string } }> }> }) => void): void; commands(): Array<{ type: string; yaml?: string; presetChoice?: string; expectedRevision?: number }> };

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
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Defaults' }).click();
}
const form = (page: Page) => page.getByRole('form', { name: 'Board defaults' });
const commands = (page: Page) => page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.commands());

test('identifies implicit operator and explicitly selects host or named preset', async ({ page }) => {
  await open(page, 'operator');
  const defaults = form(page);
  await expect(defaults.getByText('Current origin: new-board operator default.')).toBeVisible();
  const missing = defaults.getByRole('radio', { name: /kanban-workflow-operator/ });
  await expect(missing).toBeChecked();
  await expect(defaults.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
  await defaults.getByRole('radio', { name: /Host default preset/ }).check();
  await defaults.getByRole('button', { name: 'Save defaults' }).click();
  await expect(defaults.getByText('Defaults saved.')).toBeVisible();
  const sent = (await commands(page)).find(command => command.type === 'board.workflow.save');
  expect(sent).toMatchObject({ presetChoice: 'host', expectedRevision: expect.any(Number) });
  expect(sent?.yaml).not.toContain('agent_preset:');
});

test('identifies explicit and legacy host origins and writes a named selection', async ({ page }) => {
  await open(page, 'host');
  await expect(form(page).getByText('Current origin: explicit host default.')).toBeVisible();
  await expect(form(page).getByRole('radio', { name: /Host default preset/ })).toBeChecked();
  await form(page).getByRole('radio', { name: /Standard/ }).check();
  await form(page).getByRole('button', { name: 'Save defaults' }).click();
  await expect(form(page).getByText('Defaults saved.')).toBeVisible();
  const sent = (await commands(page)).find(command => command.type === 'board.workflow.save');
  expect(sent).toMatchObject({ presetChoice: 'named', expectedRevision: expect.any(Number) });
  expect(sent?.yaml).toContain('agent_preset: standard');
  await expect(form(page).getByText('Current origin: authored workflow.')).toBeVisible();
  await open(page);
  await expect(form(page).getByText('Current origin: legacy host default.')).toBeVisible();
});

test('presents preset origin and options in both host appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, 'operator');
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    const panel = form(page).getByRole('group', { name: 'Board default agent preset' });
    await expect(panel.getByText('Current origin: new-board operator default.')).toBeVisible();
    await expect(panel.getByRole('radio', { name: /kanban-workflow-operator/ })).toBeChecked();
    await expectLegible(page, 'fieldset[aria-label="Board default agent preset"] strong');
    const token = await panel.locator('strong').first().evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--dsw-alias-label-primary)';
      element.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { expected, actual: getComputedStyle(element).color };
    });
    expect(token.actual).toBe(token.expected);
    await panel.screenshot({ path: path.join(OUT, 'board-preset-origin-' + scheme + '.png') });
  }
});
