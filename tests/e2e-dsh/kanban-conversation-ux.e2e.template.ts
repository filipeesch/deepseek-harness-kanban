// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold, seedSession } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const exec = promisify(execFile);
const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const QUESTION_FIXTURE = process.env.KANBAN_QUESTION_FIXTURE!;

it('quick-creates a real worktree and dismisses a seeded question round durably', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;
  const basePath = join(repository, '..', 'kanban-worktrees');
  await mkdir(basePath, { recursive: true });
  await writeFile(join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('textbox', { name: 'Worktree base path' }).fill(basePath);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('Git repository')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Worktree task');
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task Worktree task' }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('worktree-task');
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await expect(notice).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('tab', { name: 'Conversations' })).toHaveAttribute('aria-selected', 'true');
  const worktrees = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repository });
  expect(worktrees.stdout).toContain('branch refs/heads/worktree-task');
  expect((await stat(join(basePath, 'worktree-task'))).isDirectory()).toBe(true);

  const questionText = await readFile(QUESTION_FIXTURE, 'utf8');
  const sessionId = await seedSession(scaffold, questionText, 'kanban-question-e2e');
  await scaffold.ctx.sessionController.rename({ sessionId, title: 'Question fixture' });
  const workspace = await scaffold.ctx.workspaceRegistry.create(repository);
  await workspace.attachSession(sessionId);
  await page.reload({ waitUntil: 'load' });
  await page.getByText('Question fixture', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Questions from the agent' });
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Dismiss' }).click();
  await expect(form).toBeHidden();
  await page.reload({ waitUntil: 'load' });
  await page.getByText('Question fixture', { exact: true }).click();
  await expect(page.getByText('decision_request').first()).toBeVisible();
  await expect(page.getByRole('form', { name: 'Questions from the agent' })).toHaveCount(0);
});
