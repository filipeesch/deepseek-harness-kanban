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
const REPLAY_OVERRIDE = process.env.KANBAN_DECLARED_OVERRIDE!;
const PLAN = 'Plan the declared advance.';
const REVIEW = 'Review the declared advance.';
const REASON = 'The plan is ready for review.';
const WORKFLOW = [
  'name: Declared flow',
  'initial_column: plan',
  'columns:',
  '  - id: plan',
  '    label: Plan',
  '    on_enter_prompt: |',
  '      ' + PLAN,
  '    allowed_transitions: [review]',
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

it('advances on a declared transition with auto mode off and delivers its reason', { timeout: 180_000 }, async () => {
  if (REPLAY_OVERRIDE === undefined) throw new Error('KANBAN_DECLARED_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-declared-'));
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
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Declared');
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
  await expect.poll(async () => (await editor.innerText()).includes('Declared flow'), { timeout: 20_000 }).toBe(true);
  // Let CodeMirror's change reach the editor state before saving; the button is
  // already enabled for the previous valid YAML.
  await page.waitForTimeout(500);
  const save = page.getByRole('button', { name: 'Save workflow' });
  await expect.poll(() => save.isEnabled()).toBe(true);
  await save.click();
  // The rendered stage is the authoritative proof that the host accepted the workflow.
  await count(page.locator('[data-column-id="review"]'), 1);
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const newTask = page.getByRole('dialog', { name: 'New task' });
  await newTask.getByRole('textbox', { name: 'Title' }).fill('Declared advance');
  await newTask.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'Declared' });
  // Creating a task in an instructed stage starts its first execution, which would
  // resolve this entry before the lane could start the turn itself.
  await newTask.getByRole('checkbox', { name: 'Start execution now' }).uncheck();
  await newTask.getByRole('button', { name: 'Create task' }).click();
  const openTask = page.getByRole('button', { name: 'Open task Declared advance' });
  await visible(openTask);
  const cardInPlan = page.locator('[data-column-id="plan"] [data-task-id]').filter({ has: openTask });
  await count(cardInPlan, 1);
  // Auto mode is never enabled: the declared transition alone must move the card.
  await attribute(cardInPlan.locator('.kb-auto-chip'), 'aria-pressed', 'false');

  // The play action starts the task's first execution; the replayed turn calls
  // set_next_transition, ends, and the host follows the declaration on its own.
  await cardInPlan.getByRole('button', { name: 'Run Plan instruction' }).click();
  const preparation = page.getByRole('dialog');
  const startExecution = preparation.getByRole('button', { name: 'Start execution' });
  await visible(startExecution);
  await startExecution.click();

  const cardInReview = page.locator('[data-column-id="review"] [data-task-id]').filter({ has: openTask });
  await count(cardInReview, 1);
  // The declared advance is host-owned, so it never arms the five-second window.
  await count(page.locator('.kb-card-countdown'), 0);

  await openTask.click();
  const drawer = page.locator('.kb-drawer');
  const conversation = drawer.locator('.kb-conversation-window');
  const stageRows = () => conversation.locator('[data-disclosure-row]').filter({ hasText: 'stage-instruction' });
  await count(stageRows(), 2);
  await contains(stageRows().first(), 'Stage: Plan');
  await contains(stageRows().last(), 'Stage: Review');

  // The destination instruction carries the declared reason after itself.
  await stageRows().last().click();
  await contains(conversation.locator('[data-context-injection-body]').last(), REVIEW);
  await contains(conversation.locator('[data-context-injection-body]').last(), 'Transition reason (from Plan):');
  await contains(conversation.locator('[data-context-injection-body]').last(), REASON);
  // Exactly one delivery carries a reason block: the one that followed the
  // declaration. The first instruction was a plain entry, so it has none.
  await count(conversation.getByText('Transition reason (from Plan):', { exact: false }), 1);

  await contains(conversation.getByText('Automatic instruction received.', { exact: false }), 'Automatic instruction received.');
  await attribute(cardInReview.locator('.kb-auto-chip'), 'aria-pressed', 'false');
  await attribute(drawer.locator('.kb-drawer-header .kb-auto-chip'), 'aria-pressed', 'false');
});
