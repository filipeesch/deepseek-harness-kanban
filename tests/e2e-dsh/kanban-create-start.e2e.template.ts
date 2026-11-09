// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const REPLAY_OVERRIDE = process.env.KANBAN_CREATESTART_OVERRIDE!;
const INSTRUCTION = 'Start the created task.';
const WORKFLOW = [
  'name: Creation start flow',
  'initial_column: explore',
  'columns:',
  '  - id: explore',
  '    label: Explore',
  '    on_enter_prompt: |',
  '      ' + INSTRUCTION,
  '',
].join('\n');

it('starts the first execution on creation, cancels a Git start, and preserves the capture path', { timeout: 180_000 }, async () => {
  if (REPLAY_OVERRIDE === undefined) throw new Error('KANBAN_CREATESTART_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-create-start-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride: REPLAY_OVERRIDE,
  });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const projectPath = scaffold.workspaceCwd;

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Creation');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(projectPath);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();

  // A real Git repository exercises the repository-sibling worktree default.
  const gitRoot = join(projectPath, 'repo');
  await mkdir(gitRoot, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', gitRoot]);
  execFileSync('git', ['-C', gitRoot, '-c', 'user.email=e2e@example.test', '-c', 'user.name=E2E', 'commit', '-q', '--allow-empty', '-m', 'Initial commit']);
  await page.getByRole('button', { name: 'New project' }).click();
  const gitDialog = page.getByRole('dialog', { name: 'New project' });
  await gitDialog.getByRole('textbox', { name: 'Project name' }).fill('Repo');
  await gitDialog.getByRole('textbox', { name: 'Project path' }).fill(gitRoot);
  await gitDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(gitDialog.getByText('Git repository')).toBeVisible();
  await gitDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(WORKFLOW);
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.clock.install({ time: new Date() });
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  expect(await dialog.getByRole('checkbox', { name: 'Start execution now' }).isChecked()).toBe(true);
  expect(await dialog.getByRole('checkbox', { name: 'Auto mode' }).isChecked()).toBe(false);
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Created with start');
  await dialog.getByRole('combobox').selectOption({ label: 'Creation' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task Created with start' })).toBeVisible();
  await expect(page.locator('.kb-card-countdown')).toContainText('5s');
  await expect(page.locator('.kb-drawer-autorun')).toContainText('Sending the Explore instruction');
  await expect(page.locator('.kb-conversation-window')).toBeVisible();
  await page.clock.runFor(5000);
  await page.clock.resume();
  const conversation = page.locator('.kb-conversation-window');
  const runMessage = conversation.locator('[class*="_plainRun_"]').filter({ hasText: INSTRUCTION });
  await expect(runMessage).toBeVisible({ timeout: 20_000 });
  await expect(conversation.getByText('Automatic instruction received.', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.kb-card-countdown')).toHaveCount(0);

  await page.getByRole('button', { name: 'Close task details' }).click();

  // A Git task prepares the repository-sibling worktree; canceling the countdown
  // leaves the worktree and conversation in place with the play action.
  await page.getByRole('button', { name: 'New task' }).first().click();
  const gitTaskDialog = page.getByRole('dialog', { name: 'New task' });
  await gitTaskDialog.getByRole('textbox', { name: 'Title' }).fill('Sibling worktree');
  await gitTaskDialog.getByRole('combobox').selectOption({ label: 'Repo' });
  await gitTaskDialog.getByRole('button', { name: 'Create task' }).click();
  const gitCard = page.locator('.kb-card').filter({ hasText: 'Sibling worktree' });
  await expect(gitCard.locator('.kb-card-countdown')).toBeVisible({ timeout: 20_000 });
  await expect(gitCard.locator('.kb-card-countdown')).toContainText('5s');
  await gitCard.locator('.kb-card-countdown').click();
  await expect(gitCard.getByRole('button', { name: 'Run Explore instruction' })).toBeVisible();
  await page.getByRole('button', { name: 'Open task Sibling worktree' }).click();
  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(page.getByText(/repo-sibling-worktree/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const captureDialog = page.getByRole('dialog', { name: 'New task' });
  await captureDialog.getByRole('textbox', { name: 'Title' }).fill('Captured only');
  await captureDialog.getByRole('combobox').selectOption({ label: 'Creation' });
  await captureDialog.getByRole('checkbox', { name: 'Start execution now' }).uncheck();
  await captureDialog.getByRole('checkbox', { name: 'Auto mode' }).check();
  await captureDialog.getByRole('button', { name: 'Create task' }).click();
  const captured = page.locator('.kb-card').filter({ hasText: 'Captured only' });
  await expect(captured).toBeVisible();
  await expect(page.locator('.kb-card-countdown')).toHaveCount(0);
  await expect(captured.getByRole('button', { name: 'Run Explore instruction' })).toBeVisible();
  await expect(captured.locator('.kb-auto-chip')).toHaveAttribute('aria-pressed', 'true');
});
