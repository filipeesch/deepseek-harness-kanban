// Plugin-owned real-composition scenario for the manual DSH e2e lane.
// The runner copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it
// after the pinned web lane runs. It never calls a model.
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const workflowYaml = [
  'name: Restricted Flow',
  'initial_column: explore',
  'columns:',
  '  - id: explore',
  '    label: Explore',
  '    allowed_transitions: [propose]',
  '  - id: propose',
  '    label: Propose',
  '  - id: apply',
  '    label: Apply',
  '',
].join(String.fromCharCode(10));

it('cancels and confirms a restricted drawer move without a model call', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await page.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await page.getByRole('textbox', { name: 'Git root' }).fill(scaffold.workspaceCwd);
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Workflow' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(workflowYaml);
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByRole('textbox', { name: 'Title' }).fill('Restricted task');
  await create.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await create.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task Restricted task' })).toBeVisible();
  await page.getByRole('button', { name: 'Open task Restricted task' }).click();

  const select = page.getByRole('combobox', { name: 'Move task to' });
  await expect(select).toHaveValue('explore');
  await select.selectOption('apply');
  const dialog = page.getByRole('dialog', { name: 'Move to Apply?' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(select).toHaveValue('explore');
  await expect(page.getByRole('region', { name: 'Explore column' }).getByRole('button', { name: 'Open task Restricted task' })).toBeVisible();

  await select.selectOption('apply');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Move anyway' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Restricted task' })).toBeVisible();
});
