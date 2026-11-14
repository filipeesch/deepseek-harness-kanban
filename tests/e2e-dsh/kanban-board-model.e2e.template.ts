// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
// It proves the board's own model choice against the host's real catalog: a
// route the host offers skips the preparation model step, a route it dropped
// keeps that step and is announced on the conversation it could not honour.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import type { Locator } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const exec = promisify(execFile);
const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const INSTRUCTION = 'Plan the modelled execution.';
// The scaffold publishes this directory without any credential, so both the
// offered route and the invented one are decided by the host's own catalog.
const OFFERED = { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', effort: undefined };
const MISSING = { provider: 'deepseek-official', model: 'deepseek-v4-ghost', effort: undefined };

function workflowYaml(model: { provider: string; model: string; effort: string | undefined }): string {
  return [
    'name: Board model flow',
    'initial_column: explore',
    'model:',
    '  provider: ' + model.provider,
    '  model: ' + model.model,
    ...(model.effort === undefined ? [] : ['  reasoning_effort: ' + model.effort]),
    'columns:',
    '  - id: explore',
    '    label: Explore',
    '  - id: plan',
    '    label: Plan',
    '    on_enter_prompt: |',
    '      ' + INSTRUCTION,
    '',
  ].join('\n');
}

function visible(locator: Locator, timeout = 30_000): Promise<void> {
  return locator.waitFor({ state: 'visible', timeout });
}

function hidden(locator: Locator, timeout = 30_000): Promise<void> {
  return locator.waitFor({ state: 'hidden', timeout });
}

it('starts a board conversation on the model the board names', { timeout: 300_000 }, async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;
  await writeFile(join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Modelled');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(projectDialog.getByText('Git repository'));
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));

  const openWorkflowEditor = async () => {
    // The project step above leaves the panel open; a second save reuses it.
    if (await page.getByRole('button', { name: 'Close Kanban configuration' }).count() === 0) {
      await page.getByRole('button', { name: 'Configuration', exact: true }).click();
    }
    await page.getByRole('tab', { name: 'Board' }).click();
    await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Workflow' }).click();
    return page.locator('.cm-content');
  };
  const saveWorkflowWith = async (model: { provider: string; model: string; effort: string | undefined }) => {
    const editor = await openWorkflowEditor();
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.insertText(workflowYaml(model));
    const save = page.getByRole('button', { name: 'Save workflow' });
    await expect.poll(() => save.isEnabled(), { timeout: 10_000 }).toBe(true);
    await save.click();
    await visible(page.getByText('Workflow saved.'));
    await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  };

  const createTask = async (title: string) => {
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await visible(dialog);
    await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
    await dialog.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Modelled' });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await visible(page.getByRole('button', { name: 'Open task ' + title }));
  };
  const openTask = async (title: string) => {
    await page.getByRole('button', { name: 'Open task ' + title }).click();
    await visible(page.locator('.kb-drawer'));
  };
  const beginPreparation = async () => {
    await page.getByRole('combobox', { name: 'Move task to' }).selectOption('plan');
    await visible(page.getByRole('dialog', { name: 'Prepare the first execution' }));
    await page.getByRole('dialog', { name: 'Prepare the first execution' }).getByRole('button', { name: 'Continue in base project' }).click();
  };
  const cancelCountdown = async () => {
    const notice = page.locator('.kb-drawer-autorun');
    await visible(notice);
    await notice.getByRole('button', { name: 'Cancel automatic Plan instruction' }).click();
    await hidden(notice);
  };

  // The board names a route the host offers: the conversation is created on it
  // and the preparation never asks for a model.
  await saveWorkflowWith(OFFERED);
  await createTask('On the board model');
  await openTask('On the board model');
  await beginPreparation();
  const modelDialog = page.getByRole('dialog', { name: 'Choose the conversation model' });
  const fallbackNotice = page.locator('.kb-model-notice');
  await expect.poll(() => page.locator('.kb-agent-tabs .kb-tab').count(), { timeout: 30_000 }).toBe(1);
  // The conversation is running, so a model step or a fallback would be on screen by now.
  // The preparation dialog element stays mounted while closed, so the assertion is
  // about what the person can see, not about how many nodes exist.
  expect(await modelDialog.first().isVisible()).toBe(false);
  expect(await fallbackNotice.count()).toBe(0);
  // The two cases in this file are the same flow with a different board route, so the
  // missing notice here and the present notice below are what carry the difference:
  // the notice is announced from the host's own receipt for the created conversation.
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification', 'e2e-board-model-offered.png') });
  await cancelCountdown();
  await page.getByRole('button', { name: 'Close task details' }).click();
  await hidden(page.locator('.kb-drawer'));

  // The board names a route the host no longer offers: the model step returns,
  // the native selector is composed in it, and the conversation says which
  // model it actually started on. Nothing here reaches a real model.
  await saveWorkflowWith(MISSING);
  await createTask('Off the board model');
  await openTask('Off the board model');
  await beginPreparation();
  await visible(modelDialog);
  expect(await modelDialog.locator('[data-native-model-seat] button').count()).toBeGreaterThan(0);
  await visible(fallbackNotice);
  expect(await fallbackNotice.textContent()).toContain(MISSING.model);
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification', 'e2e-board-model-unoffered.png') });
  await modelDialog.getByRole('button', { name: 'Start execution' }).click();
  await hidden(modelDialog);
  await expect.poll(() => page.locator('.kb-agent-tabs .kb-tab').count(), { timeout: 30_000 }).toBe(1);
  await cancelCountdown();

  // The Defaults panel uses the host's own model selector, and the board's
  // default preset reaches a conversation created afterwards.
  await page.getByRole('button', { name: 'Close task details' }).click();
  await hidden(page.locator('.kb-drawer'));
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('tab', { name: 'Board' }).click();
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Defaults' }).click();
  const defaults = page.getByRole('form', { name: 'Board defaults' });
  await visible(defaults);
  const modelTrigger = defaults.locator('[data-native-model-field] button').first();
  await visible(modelTrigger);
  await modelTrigger.click();
  // A stored route the catalog does not offer opens the selector straight on the
  // model pane; a route it offers opens the root pane first, whose Model cell drills in.
  await expect.poll(async () => (await page.locator('[role="menuitem"]').count()) + (await page.locator('[role="menuitemradio"]').count()), { timeout: 10_000 }).toBeGreaterThan(0);
  if (await page.locator('[role="menuitem"]').count() > 0) await page.locator('[role="menuitem"]').first().click();
  const firstModel = page.locator('[role="menuitemradio"]').first();
  await visible(firstModel);
  await firstModel.click();
  // A preset that differs from the host default proves the board choice reached the
  // conversation; selecting the host default would be a no-op the host does not log.
  const boardPreset = defaults.locator('input[type="radio"][data-host-default="false"]').first();
  await visible(boardPreset);
  const boardPresetId = await boardPreset.getAttribute('data-preset-id');
  expect(boardPresetId).not.toBeNull();
  await boardPreset.click();
  await expect.poll(() => page.getByRole('button', { name: 'Save defaults' }).isEnabled(), { timeout: 10_000 }).toBe(true);
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await visible(page.getByText('Defaults saved.'));
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification', 'e2e-board-defaults.png') });
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await createTask('Preset task');
  if (await page.getByRole('button', { name: 'Close task details' }).isVisible()) await page.getByRole('button', { name: 'Close task details' }).click();
  await hidden(page.locator('.kb-drawer'));
  await openTask('Preset task');
  // The explicit card start waits for the worktree choice; the base project is
  // enough for this conversation and keeps the flow deterministic.
  const continueInBase = page.getByRole('button', { name: 'Continue in base project' });
  if (await continueInBase.isVisible()) {
    await continueInBase.click();
    await hidden(page.locator('[aria-label="Worktree not created"]'));
  }
  const cards = page.getByRole('group', { name: 'Start a conversation' });
  await visible(cards);
  const defaultCard = cards.locator('[data-default="true"]');
  await expect.poll(() => defaultCard.isEnabled(), { timeout: 10_000 }).toBe(true);
  await visible(defaultCard);
  expect(await defaultCard.getAttribute('data-preset-id')).toBe(boardPresetId);
  await expect.poll(() => defaultCard.evaluate(element => element.ownerDocument.activeElement === element), { timeout: 5_000 }).toBe(true);
  await defaultCard.click();
  await expect.poll(() => page.locator('.kb-agent-tabs .kb-tab').count(), { timeout: 30_000 }).toBe(1);
  // The composed execution proves the board default reached the conversation,
  // whether or not the host also logged an explicit selection event.
  const sessionId = (await page.locator('.kb-agent-tabs .kb-tab[aria-selected="true"]').getAttribute('id'))?.split('-tab-')[1];
  expect(sessionId).toBeTruthy();
  const host = scaffold.ctx as unknown as {
    agents: { get(id: string): { ctx: unknown } | undefined };
    agentPresets: { composedPreset(ctx: unknown): string | undefined };
  };
  const agent = host.agents.get(sessionId!);
  expect(agent).toBeDefined();
  expect(host.agentPresets.composedPreset(agent!.ctx)).toBe(boardPresetId);
});
