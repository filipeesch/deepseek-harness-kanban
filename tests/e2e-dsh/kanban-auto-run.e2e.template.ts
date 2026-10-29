// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
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

  await page.getByRole('tab', { name: 'Workflow' }).click();
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
    await page.getByRole('textbox', { name: 'Title' }).fill(title);
    await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Auto run' });
    await page.getByRole('button', { name: 'Create task' }).click();
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
    await expect(page.locator('.kb-drawer-autorun')).toBeVisible();
  };
  const conversation = page.locator('.kb-native-conversation');

  await createTask('Auto run send');
  await createTask('Auto run cancel');
  await createTask('Auto run reload');
  await createTask('Auto run draft');
  await page.clock.install({ time: new Date() });

  // Happy path: the card and drawer show the window; the host receives only the instruction.
  await openTask('Auto run send');
  await moveToPlan();
  await expect(page.locator('.kb-card-countdown')).toContainText('5s');
  await expect(page.locator('.kb-drawer-autorun')).toContainText('Sending the Plan instruction to Agent 1 in 5s.');
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(conversation.getByText(INSTRUCTION, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('note', { name: 'Task context' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Task context' })).toContainText('Task: Auto run send');
  const contextBox = await page.getByRole('note', { name: 'Task context' }).boundingBox();
  const instructionBox = await conversation.getByText(INSTRUCTION, { exact: false }).boundingBox();
  expect(contextBox!.y).toBeLessThan(instructionBox!.y);
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toHaveCount(0);
  await closeDrawer();

  // Cancel: the instruction stays unsent and the play action returns.
  await openTask('Auto run cancel');
  await moveToPlan();
  await page.locator('.kb-drawer-autorun').getByRole('button', { name: 'Cancel automatic Plan instruction' }).click();
  await expect(page.locator('.kb-drawer-autorun')).toHaveCount(0);
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(conversation).not.toContainText(INSTRUCTION);
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await closeDrawer();

  // Draft: the timed send does not consume or clear unsent composer text.
  await openTask('Auto run draft');
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
  await expect(composer).toBeVisible();
  await composer.fill('Unsent draft stays here.');
  await moveToPlan();
  await page.clock.runFor(5000);
  await page.clock.resume();
  await expect(conversation.getByText(INSTRUCTION, { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(await composer.textContent()).toBe('Unsent draft stays here.');
  await closeDrawer();

  // Reload: the client-local window is gone, so the entry stays unresolved and nothing is sent.
  await openTask('Auto run reload');
  await moveToPlan();
  await page.clock.resume();
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open task Auto run reload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(page.getByRole('button', { name: 'Run Plan instruction' })).toBeVisible();
  await openTask('Auto run reload');
  await expect(conversation).not.toContainText(INSTRUCTION);
  await closeDrawer();
});
