// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
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
  await page.getByRole('tab', { name: 'Workflow' }).click();
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
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('button', { name: 'Open task Real task ' + index })).toBeVisible();
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
