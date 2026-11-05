// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import type { Locator } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const exec = promisify(execFile);
const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const INSTRUCTION = 'Plan the prepared execution.';
const WORKFLOW = [
  'name: Prepare flow',
  'initial_column: explore',
  'columns:',
  '  - id: explore',
  '    label: Explore',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: |',
  '      ' + INSTRUCTION,
  '',
].join('\n');

function visible(locator: Locator, timeout = 30_000): Promise<void> {
  return locator.waitFor({ state: 'visible', timeout });
}

function hidden(locator: Locator, timeout = 30_000): Promise<void> {
  return locator.waitFor({ state: 'hidden', timeout });
}

it('prepares the worktree and the first conversation before the first execution', { timeout: 180_000 }, async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;
  const basePath = join(repository, '..', 'prepare-worktrees');
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
  await visible(page.getByText('Settings saved.'));
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Prepare');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(projectDialog.getByText('Git repository'));
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));
  // The workflow editor lives under Workflow on the pinned SDK and under Board on newer hosts.
  const workflowTab = page.getByRole('tab', { name: 'Workflow' });
  if (await workflowTab.count() > 0) await workflowTab.click();
  else await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(WORKFLOW);
  const saveWorkflow = page.getByRole('button', { name: 'Save workflow' });
  await expect.poll(() => saveWorkflow.isEnabled(), { timeout: 10_000 }).toBe(true);
  await saveWorkflow.click();
  await visible(page.getByText('Workflow saved.'));
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  const createTask = async (title: string) => {
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await visible(dialog);
    await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
    await dialog.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Prepare' });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await visible(page.getByRole('button', { name: 'Open task ' + title }));
  };
  const openTask = async (title: string) => {
    await page.getByRole('button', { name: 'Open task ' + title }).click();
    await visible(page.locator('.kb-drawer'));
  };
  const startMove = async (): Promise<Locator> => {
    await page.getByRole('combobox', { name: 'Move task to' }).selectOption('plan');
    const dialog = page.getByRole('dialog', { name: 'Prepare the first execution' });
    await visible(dialog);
    return dialog;
  };
  const finishPreparation = async () => {
    const preparation = page.getByRole('dialog', { name: 'Prepare the first execution' });
    const modelDialog = page.getByRole('dialog', { name: 'Choose the conversation model' });
    await expect.poll(async () => (await modelDialog.count()) + (await page.locator('.kb-drawer-autorun').count()), { timeout: 30_000 }).toBeGreaterThan(0);
    if (await modelDialog.count() > 0) {
      await visible(modelDialog);
      // The dialog only appears while the native selector is composed; its trigger is a native button.
      expect(await modelDialog.locator('[data-native-model-seat] button').count()).toBeGreaterThan(0);
      await modelDialog.getByRole('button', { name: 'Start execution' }).click();
      await hidden(modelDialog);
    }
    await hidden(preparation);
  };
  const cancelCountdown = async () => {
    const notice = page.locator('.kb-drawer-autorun');
    await visible(notice);
    await notice.getByRole('button', { name: 'Cancel automatic Plan instruction' }).click();
    await hidden(notice);
  };

  // Base-project choice: the first conversation is created before the move and nothing is sent.
  await createTask('Prepared base');
  await openTask('Prepared base');
  const baseDialog = await startMove();
  const baseCreate = baseDialog.getByRole('button', { name: 'Create worktree' });
  await expect.poll(() => baseCreate.isEnabled(), { timeout: 15_000 }).toBe(true);
  await baseDialog.getByRole('button', { name: 'Continue in base project' }).click();
  await finishPreparation();
  await expect.poll(() => page.locator('.kb-agent-tabs .kb-tab').count(), { timeout: 30_000 }).toBe(1);
  const baseTranscript = page.locator('.kb-native-conversation');
  if (await baseTranscript.count() > 0) expect(await baseTranscript.first().textContent()).not.toContain(INSTRUCTION);
  await cancelCountdown();
  await visible(page.getByRole('button', { name: 'Run Plan instruction' }));
  await page.getByRole('button', { name: 'Close task details' }).click();
  await hidden(page.locator('.kb-drawer'));

  // Worktree choice: the checkout is created before the conversation and the move follows.
  await createTask('Prepared worktree');
  await openTask('Prepared worktree');
  const worktreeDialog = await startMove();
  const worktreeCreate = worktreeDialog.getByRole('button', { name: 'Create worktree' });
  await expect.poll(() => worktreeCreate.isEnabled(), { timeout: 15_000 }).toBe(true);
  await worktreeCreate.click();
  await finishPreparation();
  await expect.poll(() => page.locator('.kb-agent-tabs .kb-tab').count(), { timeout: 30_000 }).toBe(1);
  await cancelCountdown();
  await expect.poll(async () => { try { return (await stat(join(basePath, 'prepared-worktree'))).isDirectory(); } catch { return false; } }, { timeout: 30_000 }).toBe(true);
  const worktrees = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repository });
  expect(worktrees.stdout).toContain('branch refs/heads/prepared-worktree');
  const worktreeTranscript = page.locator('.kb-native-conversation');
  if (await worktreeTranscript.count() > 0) expect(await worktreeTranscript.first().textContent()).not.toContain(INSTRUCTION);
});
