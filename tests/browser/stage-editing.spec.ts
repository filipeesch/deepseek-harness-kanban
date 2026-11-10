import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface HarnessCommand { type: string; stageId?: string; patch?: Record<string, unknown> }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] } };

async function openBoard(page: Page, scenario = 'board'): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HARNESS + '?scenario=' + scenario + '&theme=host');
  await page.waitForSelector(scenario === 'flow' ? '.kb-flow-stage' : '.kb-column');
  if (scenario === 'flow') {
    await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
    await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);
  }
}

function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

test('presents the stage edit action on every stage of both presentations', async ({ page }) => {
  await openBoard(page);
  const boardStages = await page.locator('.kb-column').count();
  await expect(page.locator('.kb-flow-stage-edit')).toHaveCount(boardStages);
  for (const label of await page.locator('.kb-column-header h2').allInnerTexts()) {
    await expect(page.getByRole('button', { name: 'Edit stage ' + label })).toBeVisible();
  }

  await openBoard(page, 'flow');
  const diagramStages = await page.locator('.kb-flow-stage').count();
  await expect(page.locator('.kb-flow-stage-edit')).toHaveCount(diagramStages);
  // The layout lock is on by default and does not gate the edit action.
  await expect(page.getByRole('button', { name: 'Lock layout editing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeEnabled();

  // Card selection does not gate it either; opening the editor keeps the selection.
  await openBoard(page);
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Edit stage' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeEnabled();
});

test('opens the editor without storing and saves one stage name', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog).toBeVisible();
  expect(await commands(page)).toEqual([]);

  await dialog.getByLabel('Stage name').fill('Discovery');
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit stage Discovery' })).toBeVisible();
  const sent = await commands(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'board.stage.update', stageId: 'explore', patch: { name: 'Discovery' } });
});

test('cancels without storing anything', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByLabel('Stage name').fill('Discarded');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await commands(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeVisible();
});

test('renames the identifier of an idle stage and keeps its cards', async ({ page }) => {
  await openBoard(page, 'stage-idle');
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog.getByRole('textbox', { name: 'Stage id', exact: true })).toBeEditable();
  await dialog.getByRole('textbox', { name: 'Stage id', exact: true }).fill('discovery');
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  const sent = await commands(page);
  expect(sent[0]).toMatchObject({ type: 'board.stage.update', stageId: 'explore', patch: { id: 'discovery' } });
  await expect(page.locator('[data-column-id="discovery"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeVisible();
});

test('keeps the identifier read-only while the board has work in flight', async ({ page }) => {
  await openBoard(page, 'auto');
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog.getByLabel('Stage id')).toHaveAttribute('readonly', '');
  await expect(dialog.getByText(/cannot change while the board has work in flight/)).toBeVisible();
  await shoot(page, 'stage-editor-readonly-id.png');
});

test('edits a transition list and expands one condition into its own editor', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  const anyStage = dialog.getByLabel('Allow any stage');
  if (await anyStage.isChecked()) await anyStage.uncheck();
  await dialog.getByLabel('Allow transition to Propose').check();
  await dialog.getByRole('textbox', { name: 'Condition for Propose', exact: true }).fill('when the brief is unclear');
  await test.step('expand the condition', async () => {
    await dialog.getByRole('button', { name: 'Expand the condition for Propose' }).click();
    await expect(page.getByRole('dialog', { name: 'Condition for Propose' })).toBeVisible();
  });
  const nested = page.getByRole('dialog', { name: 'Condition for Propose' });
  await test.step('focus the expanded editor', async () => {
    await expect(nested.getByRole('textbox', { name: 'Transition condition' })).toBeFocused({ timeout: 3000 });
  });
  await nested.getByRole('textbox', { name: 'Transition condition' }).fill('when the brief is unclear');
  await shoot(page, 'stage-editor-condition.png');
  await nested.getByRole('button', { name: 'Use this condition' }).click();
  await expect(nested).toBeHidden();
  await expect(dialog).toBeVisible();
  expect(await commands(page)).toEqual([]);
  await expect(dialog.getByRole('textbox', { name: 'Condition for Propose', exact: true })).toHaveValue('when the brief is unclear');

  // Escape closes only the nested editor and hands focus back to the row that opened it.
  await dialog.getByRole('button', { name: 'Expand the condition for Propose' }).click();
  await expect(page.getByRole('dialog', { name: 'Condition for Propose' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Condition for Propose' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Expand the condition for Propose' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  const sent = await commands(page);
  expect(sent[0]?.patch).toMatchObject({ allowedTransitions: [{ to: 'propose', when: 'when the brief is unclear' }] });
});

test('warns about a duplicate name without blocking the save', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByLabel('Stage name').fill('Propose');
  await expect(dialog.getByText(/already uses this name/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save stage' })).toBeEnabled();
});

test('moves the creation action when another stage is made initial', async ({ page }) => {
  await openBoard(page);
  const before = await page.evaluate(() => document.querySelector('.kb-column-create')?.closest<HTMLElement>('[data-column-id]')?.dataset.columnId);
  await page.getByRole('button', { name: 'Edit stage Propose' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByRole('button', { name: 'Make this stage the initial stage' }).click();
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  const after = await page.evaluate(() => document.querySelector('.kb-column-create')?.closest<HTMLElement>('[data-column-id]')?.dataset.columnId);
  expect(before).toBe('explore');
  expect(after).toBe('propose');
  const sent = await commands(page);
  expect(sent[0]?.patch).toMatchObject({ initial: true });
});

test('opens the editor from the locked diagram', async ({ page }) => {
  await openBoard(page, 'flow');
  // Wheel zoom anchors on the pointer, so the header stays in view while it grows.
  const header = page.locator('.kb-flow-stage[data-column-id="explore"] .kb-flow-stage-header');
  const box = await header.boundingBox();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 5; step += 1) {
      await page.mouse.wheel(0, -140);
      await page.waitForTimeout(80);
    }
    await header.screenshot({ path: path.join(OUT, 'stage-diagram-header.png') });
    await page.getByRole('button', { name: 'Fit to view' }).click({ force: true });
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  // Editing a stage is not a layout edit: nothing moved and no history entry exists.
  await expect(page.getByRole('button', { name: 'Undo layout change' })).toBeDisabled();
  expect((await commands(page)).filter(command => command.type === 'board.workflow.save')).toEqual([]);
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog).toBeVisible();
  await shoot(page, 'stage-editor-diagram.png');
  await dialog.getByLabel('Stage name').fill('Discovery');
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit stage Discovery' })).toBeVisible();
  const sent = await commands(page);
  expect(sent[0]).toMatchObject({ type: 'board.stage.update', patch: { name: 'Discovery' } });
});

test('presents the editor in both host themes without losing its controls', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openBoard(page, 'stage-idle');
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    await page.getByRole('button', { name: 'Edit stage Explore' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit stage' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Stage name', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save stage' })).toBeVisible();
    await shoot(page, 'stage-editor-' + scheme + '.png');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('refuses an invalid draft and explains why', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByRole('textbox', { name: 'Stage name', exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: 'Save stage' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog.getByText('Fix the highlighted fields before saving.')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await commands(page)).toEqual([]);
});

test('opens from the keyboard and returns focus to the pencil on every dismissal', async ({ page }) => {
  await openBoard(page);
  const pencil = page.getByRole('button', { name: 'Edit stage Explore' });
  await pencil.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pencil).toBeFocused();

  await pencil.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close Edit stage' }).click();
  await expect(dialog).toBeHidden();
  await expect(pencil).toBeFocused();
});

test('keeps the action available when the filter hides every card', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
  const popover = page.getByRole('dialog', { name: 'Filter tasks' });
  await popover.getByLabel('Search tasks').fill('zzz-no-task-matches');
  await popover.getByRole('button', { name: 'Close filters' }).click();
  await expect(page.locator('.kb-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit stage Explore' })).toBeEnabled();
});

test('keeps a selected card selected while the editor opens and closes', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  const card = page.getByRole('button', { name: 'Select task Long column task 0' });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the draft and reports a conflict inside the editor', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await dialog.getByRole('textbox', { name: 'Stage name', exact: true }).fill('Discovery');
  // Another tab saves first, so this draft's frozen revision is stale.
  await page.evaluate(() => (window as unknown as { __harness: { mutate: (change: (state: { hubs: Array<{ revision: number }> }) => void) => void } }).__harness.mutate(state => { state.hubs[0]!.revision += 1; }));
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('REVISION_CONFLICT')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Stage name', exact: true })).toHaveValue('Discovery');
  await expect(page.getByRole('button', { name: 'Edit stage Discovery' })).toHaveCount(0);
});
