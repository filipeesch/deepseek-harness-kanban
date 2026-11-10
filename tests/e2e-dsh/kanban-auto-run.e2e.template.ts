// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const REPLAY_OVERRIDE = process.env.KANBAN_AUTORUN_OVERRIDE!;
const INSTRUCTION = 'Plan the automatic run.';
const WORKFLOW = [
  'name: Auto run flow',
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

it('runs an instructed move after five seconds, cancels, survives reload, and preserves a draft', { timeout: 180_000 }, async () => {
  if (REPLAY_OVERRIDE === undefined) throw new Error('KANBAN_AUTORUN_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-auto-run-'));
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
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Auto run');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(projectPath);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
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

  const createTask = async (title: string) => {
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
    await dialog.getByRole('combobox').selectOption({ label: 'Auto run' });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('button', { name: 'Open task ' + title })).toBeVisible();
  };
  const openTask = async (title: string) => {
    await page.getByRole('button', { name: 'Open task ' + title }).click();
    await expect(page.locator('.kb-drawer')).toBeVisible();
  };
  const closeDrawer = async () => {
    await page.getByRole('button', { name: 'Close task details' }).click();
    await expect(page.locator('.kb-drawer')).toHaveCount(0);
  };
  const moveToPlan = async () => {
    await page.getByRole('combobox', { name: 'Move task to' }).selectOption('plan');
    // A newer host composes the native model selector: the first-execution
    // preparation provisions the conversation and then may ask for the model
    // before the move is applied. Wait for either that stage or the countdown.
    const preparation = page.locator('.kb-dialog');
    const startExecution = preparation.getByRole('button', { name: 'Start execution' });
    const notice = page.locator('.kb-drawer-autorun');
    await expect.poll(async () => {
      if (await notice.isVisible().catch(() => false)) return 'armed';
      if (await startExecution.isVisible().catch(() => false)) return 'model';
      return 'waiting';
    }, { timeout: 20_000 }).not.toBe('waiting');
    if (await startExecution.isVisible().catch(() => false)) {
      await startExecution.click();
      await expect(preparation).toHaveCount(0);
    }
    await expect(notice).toBeVisible();
  };
  const conversation = page.locator('.kb-conversation-window');
  // The instruction is delivered as a plugin-sourced context row, not as a user message.
  const stageRow = () => conversation.locator('[data-disclosure-row]').filter({ hasText: 'stage-instruction' });
  const userMessage = () => conversation.locator('[class*="_plainRun_"]').filter({ hasText: INSTRUCTION });

  await createTask('Auto run send');
  await createTask('Auto run cancel');
  await createTask('Auto run reload');
  await page.clock.install({ time: new Date() });

  // Happy path: the card and drawer show the window; the host receives only the instruction.
  await openTask('Auto run send');
  await moveToPlan();
  await expect(page.locator('.kb-card-countdown')).toContainText('5s');
  await expect(page.locator('.kb-drawer-autorun')).toContainText('Sending the Plan instruction to Agent 1 in 5s.');
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(stageRow()).toHaveCount(1);
  await expect(stageRow().first()).toBeVisible({ timeout: 20_000 });
  await expect(conversation.getByText('Automatic instruction received.', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(stageRow().first()).toContainText('Stage: Plan');
  await expect(userMessage()).toHaveCount(0);
  // The collapsed row keeps the instruction text behind its disclosure.
  await stageRow().first().click();
  await expect(conversation.locator('[data-context-injection-body]')).toContainText(INSTRUCTION);
  // Ordering check: when the host composes the plugin's task-context Definition,
  // its row precedes the stage-instruction row. Model-facing content is asserted by
  // the host and isolated smoke lanes instead.
  const contextRow = page.getByRole('note', { name: 'Task context' });
  if (await contextRow.count() > 0) {
    await expect(contextRow).toBeVisible();
    await expect(contextRow).toContainText('Task: Auto run send');
    const contextBox = await contextRow.boundingBox();
    const instructionBox = await stageRow().first().boundingBox();
    expect(contextBox!.y).toBeLessThan(instructionBox!.y);
  }
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toHaveCount(0);

  // Cancel: the instruction stays unsent and the play action returns.
  await openTask('Auto run cancel');
  await moveToPlan();
  await page.locator('.kb-drawer-autorun').getByRole('button', { name: 'Cancel automatic Plan instruction' }).click();
  await expect(page.locator('.kb-drawer-autorun')).toHaveCount(0);
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(stageRow()).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await closeDrawer();

  // Draft: the timed send does not consume or clear unsent composer text. This
  // phase runs in the same conversation as the first instruction, because the
  // replay script covers one session.
  await openTask('Auto run send');
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('explore');
  await expect(page.locator('.kb-drawer-autorun')).toHaveCount(0);
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
  const hasComposer = await composer.count() > 0;
  if (hasComposer) { await expect(composer).toBeVisible(); await composer.fill('Unsent draft stays here.'); }
  await moveToPlan();
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(stageRow()).toHaveCount(2);
  await expect(stageRow().last()).toBeVisible({ timeout: 20_000 });
  await expect(conversation.getByText('Draft preserved while the instruction ran.', { exact: false })).toBeVisible({ timeout: 20_000 });
  if (hasComposer) expect(await composer.textContent()).toBe('Unsent draft stays here.');
  await closeDrawer();

  // Reload: the client-local window is gone, so the entry stays unresolved and nothing is sent.
  await openTask('Auto run reload');
  await moveToPlan();
  await page.clock.resume();
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open task Auto run reload' })).toBeVisible();
  const reloadCard = page.locator('.kb-card').filter({ hasText: 'Auto run reload' });
  await expect(reloadCard.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(reloadCard.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await openTask('Auto run reload');
  await expect(stageRow()).toHaveCount(0);
  await closeDrawer();
});
