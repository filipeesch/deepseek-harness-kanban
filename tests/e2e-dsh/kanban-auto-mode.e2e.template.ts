// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
//
// This lane asserts with plain Vitest polling instead of Playwright matchers:
// the checkout's web vitest lane does not register those matchers, so a
// `toBeVisible`-style assertion fails before reaching any product behavior.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const REPLAY_OVERRIDE = process.env.KANBAN_AUTOMODE_OVERRIDE!;
const PLAN = 'Plan the automatic advance.';
const REVIEW = 'Review the automatic advance.';
const WORKFLOW = [
  'name: Auto mode flow',
  'initial_column: plan',
  'columns:',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: |',
  '      ' + PLAN,
  '  - id: review',
  '    label: Review',
  '    allowed_transitions: []',
  '    on_enter_prompt: |',
  '      ' + REVIEW,
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

const visible = async (target: Locator) => expect.poll(() => target.first().isVisible(), { timeout: 20_000 }).toBe(true);
const count = async (target: Locator, value: number) => expect.poll(() => target.count(), { timeout: 20_000 }).toBe(value);
const attribute = async (target: Locator, name: string, value: string | null) => expect.poll(() => target.first().getAttribute(name), { timeout: 20_000 }).toBe(value);
const contains = async (target: Locator, text: string) => expect.poll(async () => (await target.first().textContent()) ?? '', { timeout: 20_000 }).toContain(text);

it('advances the card and dispatches the next instruction after a completed turn', { timeout: 180_000 }, async () => {
  if (REPLAY_OVERRIDE === undefined) throw new Error('KANBAN_AUTOMODE_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-auto-mode-'));
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
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Auto mode');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(projectPath);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(projectDialog.getByText('No Git repository found'));
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));

  await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(WORKFLOW);
  await expect.poll(async () => (await editor.innerText()).includes('Auto mode flow'), { timeout: 20_000 }).toBe(true);
  // Let CodeMirror's change reach the editor state before saving; the button is
  // already enabled for the previous valid YAML.
  await page.waitForTimeout(500);
  const save = page.getByRole('button', { name: 'Save workflow' });
  await expect.poll(() => save.isEnabled()).toBe(true);
  await save.click();
  // The saved message is the editor's own state; the board behind the modal is the
  // authoritative proof that the host accepted the workflow.
  await count(page.locator('[data-column-id="review"]'), 1);
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const newTask = page.getByRole('dialog', { name: 'New task' });
  await newTask.getByRole('textbox', { name: 'Title' }).fill('Auto mode chain');
  await newTask.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'Auto mode' });
  await newTask.getByRole('button', { name: 'Create task' }).click();
  const openTask = page.getByRole('button', { name: 'Open task Auto mode chain' });
  await visible(openTask);
  const cardInPlan = page.locator('[data-column-id="plan"] [data-task-id]').filter({ has: openTask });
  await count(cardInPlan, 1);

  // Enabling auto mode arms the task without moving it or sending anything.
  const chip = cardInPlan.locator('.kb-auto-chip');
  await attribute(chip, 'aria-pressed', 'false');
  await chip.click();
  await attribute(chip, 'aria-pressed', 'true');
  await count(page.getByText(PLAN, { exact: false }), 0);

  // Running the current stage instruction starts the turn; the replay completes it,
  // and the host advances the card and dispatches the destination instruction itself.
  await cardInPlan.getByRole('button', { name: 'Run Plan instruction' }).click();
  const cardInReview = page.locator('[data-column-id="review"] [data-task-id]').filter({ has: openTask });
  await count(cardInReview, 1);
  await count(page.locator('.kb-card-countdown'), 0);

  await openTask.click();
  const drawer = page.locator('.kb-drawer');
  const conversation = drawer.locator('.kb-native-conversation');
  await contains(conversation.getByText(REVIEW, { exact: false }), REVIEW);
  await contains(conversation.getByText(PLAN, { exact: false }), PLAN);
  await count(drawer.getByRole('tablist', { name: 'Agent conversations' }).getByRole('tab'), 1);
  await attribute(cardInReview.locator('.kb-auto-chip'), 'aria-pressed', 'true');
  await attribute(drawer.locator('.kb-drawer-auto'), 'aria-pressed', 'true');
  await contains(drawer.locator('.kb-drawer-automode'), 'Auto mode is on');
});
