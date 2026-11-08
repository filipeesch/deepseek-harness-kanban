// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { execFile } from 'node:child_process';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { SessionId } from '@deepseek-ai/dsh-session';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const exec = promisify(execFile);
const KANBAN_ROOT = process.env.KANBAN_ROOT!;

it('separates project management, detects a repository, and converts a Git project to a folder', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const repository = path.join(scaffold.workspaceCwd, 'repo-a');
  const plain = path.join(scaffold.workspaceCwd, 'plain');
  await mkdir(repository, { recursive: true });
  await mkdir(plain, { recursive: true });
  await writeFile(path.join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await expect(page.getByRole('form', { name: 'New project' })).toHaveCount(0);

  // A Git-backed project: detection fills the root and suggests the default branch.
  await page.getByRole('button', { name: 'New project' }).click();
  const gitDialog = page.getByRole('dialog', { name: 'New project' });
  await gitDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness repo');
  await gitDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await gitDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(gitDialog.getByText('Git repository')).toBeVisible();
  await expect(gitDialog.getByRole('textbox', { name: 'Git root' })).toHaveValue(repository);
  await expect(gitDialog.getByRole('textbox', { name: 'Default branch (optional)' })).toHaveValue('main');
  await gitDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit project Harness repo' })).toBeVisible();

  // A folder project: no repository is reported and the Git root stays empty.
  await page.getByRole('button', { name: 'New project' }).click();
  const folderDialog = page.getByRole('dialog', { name: 'New project' });
  await folderDialog.getByRole('textbox', { name: 'Project name' }).fill('Notes');
  await folderDialog.getByRole('textbox', { name: 'Project path' }).fill(plain);
  await folderDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(folderDialog.getByText('No Git repository found')).toBeVisible();
  await expect(folderDialog.getByRole('textbox', { name: 'Git root' })).toHaveValue('');
  await folderDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('button', { name: 'Edit project Notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  // A task of a folder project has no Git section and no worktree notice.
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Folder task');
  await page.getByRole('dialog', { name: 'New task' }).getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Notes' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task Folder task' }).click();
  await expect(page.getByRole('tab', { name: 'Git' })).toHaveCount(0);
  await expect(page.getByRole('note', { name: 'Worktree not created' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close task details' }).click();

  // Conversion: clearing the Git root makes the project a folder project.
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit project Harness repo' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit project' });
  await editDialog.getByRole('textbox', { name: 'Git root' }).fill('');
  await editDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  // Durable: both projects keep their folder nature after a reload.
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await expect(page.getByRole('button', { name: 'Edit project Harness repo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit project Notes' })).toBeVisible();
  await expect(page.getByText('Folder', { exact: true })).toHaveCount(2);
  const evidence = path.join(KANBAN_ROOT, '.verification');
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'project-management.png'), fullPage: true });
});

it('relocates a project whose directory moved and keeps its task conversation', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const repository = path.join(scaffold.workspaceCwd, 'repo-original');
  const moved = path.join(scaffold.workspaceCwd, 'repo-relocated');
  const title = 'Relocated project task';
  await mkdir(repository, { recursive: true });
  await writeFile(path.join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await projectDialog.getByText('Git repository').waitFor({ state: 'visible' });
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('dialog', { name: 'New task' }).getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await notice.waitFor({ state: 'visible' });
  await notice.getByRole('button', { name: 'Continue in base project' }).click();
  await notice.waitFor({ state: 'hidden' });
  await page.locator('.kb-preset-cards').getByRole('button', { name: /^Standard mode/ }).click();
  await page.locator('.kb-agent-tabs [role="tab"]').first().waitFor({ state: 'visible' });
  await page.locator('[data-kanban-conversation-window]').waitFor({ state: 'visible' });
  const tabId = await page.locator('.kb-agent-tabs [role="tab"]').first().getAttribute('id');
  const conversationId = SessionId(tabId?.split('-tab-').at(-1)!);
  await page.getByRole('button', { name: 'Close task details' }).click();

  // The physical directory moves before the user repairs the registered path.
  await rename(repository, moved);
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit project Harness' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit project' });
  await editor.getByRole('textbox', { name: 'Project path' }).fill(moved);
  await editor.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(editor.getByText('Git repository')).toBeVisible();
  await editor.getByRole('button', { name: 'Save project' }).click();
  const confirm = page.getByRole('dialog', { name: 'Relocate project?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(moved);
  await confirm.getByRole('button', { name: 'Relocate project', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText(moved, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Cancel relocation of Harness' })).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await expect(page.getByRole('button', { name: 'Open task ' + title })).toBeVisible();
  await expect.poll(async () => {
    const projection = await scaffold.ctx.sessionController.projections({ sessionId: conversationId }, new AbortController().signal);
    const directory = projection?.kind === 'sequenced' && typeof projection.values.workingDirectory === 'string' ? projection.values.workingDirectory : '';
    if (directory === '') return '';
    try { return await realpath(directory); } catch { return ''; }
  }, { timeout: 30_000 }).toBe(await realpath(moved));
  expect(await scaffold.ctx.workspaceRegistry.resolveByPath(moved)).not.toBeUndefined();
}, 120_000);
