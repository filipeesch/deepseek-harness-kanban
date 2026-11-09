// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const groupedYaml = ['name: Grouped Flow', 'initial_column: explore', 'columns:', '  - id: explore', '    label: Explore', '  - id: propose', '    label: Propose', '  - id: apply', '    label: Apply', 'groups:', '  - id: planning', '    label: Planning', '    columns: [explore, propose]', ''].join(String.fromCharCode(10));

it('edits a grouped workflow, grows columns, and animates the drawer', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(groupedYaml);
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: 'New task' }).first().click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Real task ' + index);
    await page.getByRole('dialog', { name: 'New task' }).getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('button', { name: 'Open task Real task ' + index })).toBeVisible();
  }
  // Creating a task opens its drawer; close it so the final open is an entry transition.
  const createdDrawer = page.locator('.kb-drawer');
  if (await createdDrawer.isVisible()) {
    await page.getByRole('button', { name: 'Close task details' }).click();
    await expect(createdDrawer).toBeHidden({ timeout: 2_000 });
  }
  const geometry = await page.evaluate(() => {
    const columns = [...document.querySelectorAll<HTMLElement>('.kb-column')].map(column => {
      const cards = [...column.querySelectorAll<HTMLElement>('.kb-card')];
      const rect = column.getBoundingClientRect();
      const last = cards.at(-1)?.getBoundingClientRect();
      return { label: column.querySelector('h2')?.textContent, height: rect.height, cards: cards.length, overflow: last ? last.bottom - rect.bottom : 0 };
    });
    const body = document.querySelector('.kb-page-body')!;
    return { columns, scroll: body.scrollHeight > body.clientHeight };
  });
  const explore = geometry.columns.find(column => column.label === 'Explore')!;
  const propose = geometry.columns.find(column => column.label === 'Propose')!;
  expect(explore.cards).toBe(10);
  expect(explore.height).toBeGreaterThan(propose.height);
  expect(explore.overflow).toBeLessThanOrEqual(0);
  expect(geometry.scroll).toBe(true);

  // The workflow diagram is the other presentation of the same board.
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Explore stage' })).toBeVisible();
  await expect(page.locator('.kb-flow-edge')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Organize' })).toBeVisible();
  // Creating from the diagram is the board's one creation action, offered by the
  // initial stage alone.
  const diagram = page.getByRole('region', { name: 'Workflow diagram' });
  await expect(diagram.locator('.kb-flow-stage-create')).toHaveCount(1);
  await expect(diagram.locator('.kb-flow-stage[data-column-id="explore"] .kb-flow-stage-create')).toBeVisible();
  await expect(diagram.locator('.kb-flow-stage[data-column-id="propose"] .kb-flow-stage-create')).toHaveCount(0);
  await page.locator('.kb-flow-stage-create').click();
  const diagramDialog = page.getByRole('dialog', { name: 'New task' });
  await expect(diagramDialog).toBeVisible();
  await diagramDialog.getByRole('textbox', { name: 'Title' }).fill('Diagram task');
  await diagramDialog.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await diagramDialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task Diagram task' })).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();
  // Wait for the close to finish, so the drawer opened later is a fresh entry.
  await expect(page.locator('.kb-drawer')).toBeHidden({ timeout: 2_000 });
  // Creating is not a layout edit: the diagram is untouched and holds no history entry.
  await expect(diagram).toBeVisible();
  await expect(page.locator('.kb-flow-edge')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Undo layout change' })).toBeDisabled();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Explore column' })).toBeVisible();

  await page.getByRole('button', { name: 'Open task Real task 0' }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toHaveAttribute('data-entering', 'true');
  expect(await drawer.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(drawer).toHaveAttribute('data-closing', 'true');
  await expect(drawer).toBeHidden({ timeout: 2_000 });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Open task Real task 0' }).click();
  await expect(drawer).not.toHaveAttribute('data-entering', 'true');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(drawer).toBeHidden({ timeout: 1_000 });
});
