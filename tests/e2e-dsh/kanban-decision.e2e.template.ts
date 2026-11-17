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
const REPLAY_OVERRIDE = process.env.KANBAN_DECISION_OVERRIDE!;
const REVIEW = 'Review the shipped work.';
const OBSERVATION = 'Please ship the copy.';
const WORKFLOW = [
  'name: Decision flow',
  'initial_column: gate',
  'columns:',
  '  - id: intake',
  '    label: Intake',
  '  - id: gate',
  '    label: Gate',
  '    decision:',
  '      question: How should this review proceed?',
  '      context: Address any findings before shipping.',
  '      options:',
  '        - id: fix',
  '          title: Fix in place',
  '          to: intake',
  '        - id: ship',
  '          title: Ship it',
  '          description: Send it to review.',
  '          to: review',
  '  - id: review',
  '    label: Review',
  '    on_enter_prompt: |',
  '      ' + REVIEW,
  '    allowed_transitions: []',
  '  - id: done',
  '    label: Done',
  '',
].join(String.fromCharCode(10));

const visible = async (target: Locator) => expect.poll(() => target.first().isVisible(), { timeout: 20_000 }).toBe(true);
const count = async (target: Locator, value: number) => expect.poll(() => target.count(), { timeout: 20_000 }).toBe(value);
const attribute = async (target: Locator, name: string, value: string | null) => expect.poll(() => target.first().getAttribute(name), { timeout: 20_000 }).toBe(value);
const contains = async (target: Locator, text: string) => expect.poll(async () => (await target.first().textContent()) ?? '', { timeout: 20_000 }).toContain(text);

it('holds a decision gate, cancels its window, and routes the chosen option with its reason', { timeout: 240_000 }, async () => {
  if (REPLAY_OVERRIDE === undefined) throw new Error('KANBAN_DECISION_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-decision-'));
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
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Decision');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(projectPath);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(projectDialog.getByText('No Git repository found'));
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));

  await page.getByRole('tab', { name: 'Boards' }).click();
  await page.getByRole('button', { name: /^Edit board / }).click();
  await page.getByRole('tab', { name: 'Workflow' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(WORKFLOW);
  await expect.poll(async () => (await editor.innerText()).includes('Decision flow'), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(500);
  const save = page.getByRole('button', { name: 'Save workflow' });
  await expect.poll(() => save.isEnabled()).toBe(true);
  await save.click();
  await count(page.locator('[data-column-id="gate"]'), 1);
  await page.getByRole('button', { name: /^Close Board configuration · / }).click();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const newTask = page.getByRole('dialog', { name: 'New task' });
  await newTask.getByRole('textbox', { name: 'Title' }).fill('Gated delivery');
  await newTask.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'Decision' });
  const startNow = newTask.getByRole('checkbox', { name: 'Start execution now' });
  if (await startNow.count()) await startNow.uncheck();
  await newTask.getByRole('button', { name: 'Create task' }).click();
  const openTask = page.getByRole('button', { name: 'Open task Gated delivery' });
  await visible(openTask);
  const card = page.locator('[data-column-id="gate"] [data-task-id]').filter({ has: openTask });
  await count(card, 1);
  await attribute(card, 'data-presence', 'decision');
  await visible(card.locator('.kb-dot[aria-label="Decision needed"]'));
  await contains(card, 'Decision needed');

  // Auto mode on: the gate still holds, because the stage owns its routing.
  await card.locator('.kb-auto-chip').click();
  await attribute(card.locator('.kb-auto-chip'), 'aria-pressed', 'true');

  await openTask.click();
  const drawer = page.locator('.kb-drawer');
  // A completed turn must not cross the gate either: open a conversation, send a
  // message, let the replayed turn finish, and assert the card never leaves.
  await drawer.getByRole('button', { name: 'New conversation' }).click();
  await visible(drawer.locator('.kb-preset-cards'));
  await drawer.getByRole('button', { name: /^Standard mode/ }).first().click();
  const composer = drawer.locator('[data-composer-input][contenteditable="true"]').last();
  await visible(composer);
  await composer.fill('Review this while the gate waits.');
  await composer.press('Enter');
  await visible(drawer.getByText('Gate turn received.'));
  await count(page.locator('[data-column-id="gate"] [data-task-id]').filter({ has: openTask }), 1);
  await attribute(card.locator('.kb-auto-chip'), 'aria-pressed', 'true');
  const panel = drawer.locator('.kb-decision');
  await visible(panel);
  await contains(panel, 'How should this review proceed?');
  await contains(panel, 'Address any findings before shipping.');
  const confirm = panel.getByRole('button', { name: 'Confirm choice' });
  expect(await confirm.isDisabled()).toBe(true);

  // Choose, start the window, and cancel it: nothing may be applied.
  await panel.getByRole('radio', { name: 'Ship it' }).check();
  await expect.poll(() => confirm.isEnabled()).toBe(true);
  await confirm.click();
  await visible(panel.getByRole('button', { name: 'Cancel', exact: true }));
  await visible(card.getByRole('button', { name: /Moving to Review in \d+ seconds/ }));
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await count(panel.getByRole('button', { name: 'Cancel', exact: true }), 0);
  await count(card, 1);
  await page.waitForTimeout(5_500);
  await count(page.locator('[data-column-id="gate"] [data-task-id]').filter({ has: openTask }), 1);

  // Confirm again and let the window close; the host routes the card.
  await panel.getByRole('textbox', { name: 'Observation' }).fill(OBSERVATION);
  await confirm.click();
  const cardInReview = page.locator('[data-column-id="review"] [data-task-id]').filter({ has: openTask });
  await count(cardInReview, 1);
  await count(page.locator('.kb-card-countdown'), 0);

  const conversation = drawer.locator('.kb-conversation-window');
  const stageRows = () => conversation.locator('[data-disclosure-row]').filter({ hasText: 'stage-instruction' });
  await count(stageRows(), 1);
  await stageRows().first().click();
  const body = conversation.locator('[data-context-injection-body]').last();
  await contains(body, REVIEW);
  await contains(body, 'Transition reason (from Gate):');
  await contains(body, 'Decision: Ship it');
  await contains(body, 'Observation: ' + OBSERVATION);

  await drawer.getByRole('tab', { name: 'History' }).click();
  const history = drawer.locator('.kb-history');
  await contains(history, 'Moved by a decision');
  await contains(history, 'Decision: Ship it');
  await contains(history, OBSERVATION);
});