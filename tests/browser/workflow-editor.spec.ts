import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('real CodeMirror validates YAML, saves, and expands', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow');
  const editor = page.locator('.cm-content');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toHaveAttribute('aria-label', 'Workflow YAML');
  const save = page.getByRole('button', { name: 'Save workflow' });
  await expect(save).toBeEnabled();

  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type('columns: []');
  await expect(save).toBeDisabled();
  await expect(page.getByText(/INVALID_WORKFLOW/)).toBeVisible();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('name: Real save\ninitial_column: one\ncolumns:\n  - id: one\n    label: One');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  const commands = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string }> } }).__harness.commands());
  expect(commands.some(command => command.type === 'workflow.save')).toBe(true);

  const surface = page.locator('.kb-workflow-surface');
  const before = (await surface.boundingBox())!.height;
  const maximize = page.getByRole('button', { name: 'Maximize workflow editor' });
  await expect(maximize).toHaveAttribute('aria-pressed', 'false');
  await maximize.click();
  await expect(page.getByRole('button', { name: 'Restore workflow editor' })).toHaveAttribute('aria-pressed', 'true');
  const after = (await surface.boundingBox())!.height;
  expect(after).toBeGreaterThan(before);
});
