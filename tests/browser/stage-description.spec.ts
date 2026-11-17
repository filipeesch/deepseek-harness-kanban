import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

type HarnessWindow = { __harness: { commands(): Array<{ type: string; patch?: Record<string, unknown> }> } };
async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HARNESS + '?scenario=stage-idle&theme=host');
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Edit stage' });
const commands = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());

test('edits, reopens, and clears an optional description without changing instructions', async ({ page }) => {
  await open(page);
  const editor = dialog(page);
  const field = editor.getByRole('textbox', { name: 'Stage description' });
  await expect(field).toHaveValue('');
  await expect(field).toHaveAccessibleDescription('Describe this stage for people and task agents. This is not an entry instruction.');
  await field.focus();
  await page.keyboard.insertText('Describe the initial investigation.');
  await editor.getByRole('button', { name: 'Save stage' }).click();
  await expect(editor).toBeHidden();
  expect((await commands(page))[0]).toMatchObject({ type: 'board.stage.update', patch: { description: 'Describe the initial investigation.' } });
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  await expect(field).toHaveValue('Describe the initial investigation.');
  await field.fill('  ');
  await editor.getByRole('button', { name: 'Save stage' }).click();
  await expect(editor).toBeHidden();
  expect((await commands(page))[1]).toMatchObject({ type: 'board.stage.update', patch: { description: null } });
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  await expect(field).toHaveValue('');
});

test('retains a long draft when changing tabs and cancels without saving', async ({ page }) => {
  await open(page);
  const editor = dialog(page);
  const field = editor.getByRole('textbox', { name: 'Stage description' });
  const long = 'A'.repeat(200);
  await field.fill(long);
  await editor.getByRole('tab', { name: /^Execution/ }).click();
  await editor.getByRole('tab', { name: /^Stage/ }).click();
  await expect(field).toHaveValue(long);
  await editor.getByRole('button', { name: 'Cancel' }).click();
  expect(await commands(page)).toEqual([]);
});

test('authors a workflow description in the workflow YAML editor', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow');
  await page.getByRole('button', { name: /^Edit board / }).click();
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Workflow' }).click();
  const editor = page.getByRole('textbox', { name: 'Workflow YAML' });
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('name: Example\ndescription: Context for the workflow\ninitial_column: one\ncolumns:\n  - id: one\n    label: One');
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; yaml?: string }> } }).__harness.commands());
  expect(sent.find(command => command.type === 'board.workflow.save')?.yaml).toContain('description: Context for the workflow');
});

test('description field uses legible host colors in both appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    const field = dialog(page).getByRole('textbox', { name: 'Stage description' });
    await field.fill('Context for the stage.');
    const colors = await field.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--dsw-alias-label-primary)';
      element.parentElement!.appendChild(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).color, token };
    });
    expect(colors.actual).toBe(colors.token);
    await expectLegible(page, 'textarea[aria-label="Stage description"]');
    await dialog(page).screenshot({ path: path.join(OUT, 'stage-description-' + scheme + '.png') });
  }
});
