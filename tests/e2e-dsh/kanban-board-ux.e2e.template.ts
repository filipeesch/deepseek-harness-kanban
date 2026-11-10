// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  // Editing a stage from its header stores that stage alone, and it survives a reload.
  await page.getByRole('button', { name: 'Edit stage Apply' }).click();
  const stageDialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(stageDialog).toBeVisible();
  await stageDialog.getByRole('textbox', { name: 'Stage name', exact: true }).fill('Ship');
  await stageDialog.getByRole('textbox', { name: 'Stage entry instruction', exact: true }).fill('Ship the change.');
  await stageDialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(stageDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit stage Ship' })).toBeVisible();
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit stage Ship' })).toBeVisible();
});

it('restricts which projects create tasks on a board and closes it to creation', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  // Two registered projects give the board a scope to choose from.
  for (const name of ['Harness', 'Second']) {
    await page.getByRole('button', { name: 'Configuration' }).click();
    await page.getByRole('tab', { name: 'Projects' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    const projectDialog = page.getByRole('dialog', { name: 'New project' });
    await projectDialog.getByRole('textbox', { name: 'Project name' }).fill(name);
    await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
    await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
    await projectDialog.getByRole('button', { name: 'Save project' }).click();
    await expect(page.getByText('Project saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  }

  // Restrict the board to one project.
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Board' }).click();
  const scope = page.getByRole('group', { name: 'Board project scope' });
  await scope.getByRole('radio', { name: 'Selected projects' }).check();
  await scope.getByRole('checkbox', { name: 'Harness', exact: true }).check();
  await scope.getByRole('button', { name: 'Save project scope' }).click();
  await expect(page.getByText('Project scope saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  const newTask = async (): Promise<void> => { await page.getByRole('button', { name: 'New task' }).first().click(); };
  await newTask();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const offered = dialog.getByRole('combobox', { name: 'Project' }).locator('option:not([disabled])');
  await expect(offered).toHaveCount(1);
  await expect(offered.first()).toHaveText('Harness');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // A card gives the project filter an option; with it active, creation still offers
  // the allowed projects and starts unselected.
  await newTask();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByRole('textbox', { name: 'Title' }).fill('Scoped task');
  await create.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await create.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task Scoped task' })).toBeVisible();
  if (await page.getByRole('button', { name: 'Close task details' }).isVisible()) await page.getByRole('button', { name: 'Close task details' }).click();
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
  await page.getByRole('combobox', { name: 'Project filter' }).selectOption({ label: 'Harness' });
  await page.getByRole('button', { name: 'Close filters' }).click();
  await newTask();
  const filtered = page.getByRole('dialog', { name: 'New task' });
  const filteredOptions = filtered.getByRole('combobox', { name: 'Project' }).locator('option:not([disabled])');
  await expect(filteredOptions).toHaveCount(1);
  await expect(filteredOptions.first()).toHaveText('Harness');
  await expect(filtered.getByRole('combobox', { name: 'Project' })).toHaveValue('');
  await filtered.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // Selecting no project closes the board to creation.
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Board' }).click();
  const reopened = page.getByRole('group', { name: 'Board project scope' });
  await reopened.getByRole('checkbox', { name: 'Harness', exact: true }).uncheck();
  await expect(reopened.getByRole('status')).toContainText('accepts no new task');
  await reopened.getByRole('button', { name: 'Save project scope' }).click();
  await expect(page.getByText('Project scope saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await newTask();
  const closed = page.getByRole('dialog', { name: 'New task' });
  await expect(closed.getByText(/accepts no new task/)).toBeVisible();
  await expect(closed.getByRole('button', { name: 'Create task' })).toBeDisabled();
});

it('refuses a team configuration written by a newer plugin version', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  const team = path.join(scaffold.workspaceCwd, 'team-share');
  await mkdir(team, { recursive: true });
  const documentPath = path.join(team, 'kanban-hub.yaml');
  await writeFile(documentPath, ['version: 2', 'boards: []', ''].join('\n'), 'utf8');

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Team Settings' }).click();
  await page.getByRole('radio', { name: 'Local folder' }).click();
  await page.getByRole('textbox', { name: 'Team folder path' }).fill(team);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  // A first connection to an empty team document offers to publish this Hub.
  await page.getByRole('button', { name: 'Publish this Hub instead' }).click();
  await page.getByRole('button', { name: 'Replace the team configuration' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();

  // A teammate on a newer plugin publishes a document this version cannot read.
  await writeFile(documentPath, ['version: 3', 'boards: []', 'newFormatField: true', ''].join('\n'), 'utf8');
  await page.getByRole('button', { name: 'Sync now' }).click();
  // The panel states the remedy; the failed command also reports the raw message.
  await expect(page.getByText('Update the plugin', { exact: true })).toBeVisible();
  await expect(page.getByText('Reading and publishing stay blocked until the plugin is updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await expect(page.getByRole('img', { name: 'Team updates unavailable' })).toBeVisible();
});
