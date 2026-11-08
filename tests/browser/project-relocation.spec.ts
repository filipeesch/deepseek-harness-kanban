import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

async function sentCommands(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as unknown as { __harnessCommands: () => Array<{ type: string; project?: { projectPath?: string }; projectId?: string }> }).__harnessCommands());
}

test('confirms a path change with its migration impact before relocating', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=project-relocation');
  const dialog = page.getByRole('dialog', { name: 'Edit project' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Project path' }).fill('/moved/repo');
  await page.getByRole('textbox', { name: 'Project name' }).click();
  await expect(page.getByText('Git repository')).toBeVisible();

  await dialog.getByRole('button', { name: 'Save project' }).click();
  const confirm = page.getByRole('dialog', { name: 'Relocate project?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('/moved/repo');
  await expect(confirm).toContainText('tasks keep their stage and work');
  await expect(confirm).toContainText('conversations move to the new directory');
  await expect(confirm.getByText(/conversations are active/)).toBeVisible();
  await confirm.screenshot({ path: path.join(OUT, 'project-relocation-confirmation.png') });

  await confirm.getByRole('button', { name: 'Relocate project', exact: true }).click();
  await expect.poll(async () => (await sentCommands(page)).map(command => command.type)).toContain('project.relocate');
  const relocation = (await sentCommands(page)).find(command => command.type === 'project.relocate');
  expect(relocation?.project?.projectPath).toBe('/moved/repo');
});

test('keeps a create-mode save on the registration path', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=project-editor');
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Project path' }).fill('/repo/apps/web');
  await page.getByRole('textbox', { name: 'Project name' }).fill('New project');
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect.poll(async () => (await sentCommands(page)).map(command => command.type)).toContain('project.save');
  await expect(page.getByRole('dialog', { name: 'Relocate project?' })).toHaveCount(0);
});

test('shows relocation progress, retry, cancel, and blocks project deletion', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=relocation-list');
  const configuration = page.getByRole('dialog', { name: 'Kanban configuration' });
  await expect(configuration).toBeVisible();
  await expect(configuration.getByText('Waiting for current work to finish.').first()).toBeVisible();
  await expect(configuration.getByText('A conversation directory could not be changed.').first()).toBeVisible();
  const relocatingOnly = configuration.getByRole('button', { name: 'Delete project Relocation-only project' });
  await expect(relocatingOnly).toBeDisabled();
  await expect(relocatingOnly).toHaveAttribute('title', 'Resolve the project relocation first.');
  await configuration.screenshot({ path: path.join(OUT, 'project-relocation-projects.png') });

  await configuration.getByRole('button', { name: 'Retry relocation of A very long project name that must truncate inside the card' }).click();
  await expect.poll(async () => (await sentCommands(page)).map(command => command.type)).toContain('project.relocationRetry');

  await configuration.getByRole('button', { name: 'Cancel relocation of Project' }).click();
  await expect.poll(async () => (await sentCommands(page)).map(command => command.type)).toContain('project.relocationCancel');
});

test('summarizes a waiting or failed relocation on the board', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=relocation-board');
  const notice = page.getByRole('region', { name: 'Project relocation' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Project relocation: Project');
  await expect(notice).toContainText('Waiting for current work to finish.');
  await expect(notice).toContainText('Project relocation needs attention');
  await notice.screenshot({ path: path.join(OUT, 'project-relocation-board.png') });
  await notice.getByRole('button', { name: 'Retry relocation — A very long project name that must truncate inside the card' }).click();
  await expect.poll(async () => (await sentCommands(page)).map(command => command.type)).toContain('project.relocationRetry');
  await expect(notice).not.toContainText('Project relocation needs attention');
  await expect(notice).toContainText('Waiting for current work to finish.');
});

test('keeps the relocation state across a reload', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=relocation-board');
  const notice = page.getByRole('region', { name: 'Project relocation' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: /Retry relocation/ }).first().click();
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Project relocation' })).toBeVisible();
  await expect(page.getByText('Waiting for current work to finish.')).toBeVisible();
});

test('explains that a Git association change and a path change are two steps', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=project-relocation');
  const dialog = page.getByRole('dialog', { name: 'Edit project' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Project path' }).fill('/moved/repo');
  await page.getByRole('textbox', { name: 'Project name' }).click();
  await expect(page.getByText('Git repository')).toBeVisible();
  await page.getByRole('textbox', { name: 'Git root' }).fill('');
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog.getByText(/Change the Git association and save the project first/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Relocate project?' })).toHaveCount(0);
  expect(await sentCommands(page)).toEqual([]);
});
