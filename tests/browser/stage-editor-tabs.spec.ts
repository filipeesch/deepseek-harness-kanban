import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

interface HarnessCommand { type: string; stageId?: string; patch?: Record<string, unknown> }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] } };

async function open(page: Page, scenario = 'board'): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(HARNESS + '?scenario=' + scenario + '&theme=host');
  await page.waitForSelector('.kb-column');
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Edit stage' });

async function openEditor(page: Page, scenario = 'board'): Promise<void> {
  await open(page, scenario);
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
}

function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

test('presents only the tabs the stage has content for', async ({ page }) => {
  await openEditor(page);
  const dialog = dialogOf(page);
  await expect(dialog.getByRole('tab')).toHaveCount(3);
  await expect(dialog.getByRole('tab', { name: /^Stage/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Routing/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Inputs/ })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: /^Approval/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await openEditor(page, 'scripted');
  await expect(dialog.getByRole('tab')).toHaveCount(5);
  await expect(dialog.getByRole('tab', { name: /^Inputs/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Approval/ })).toBeVisible();
});

test('holds one box across tabs and keeps the actions in view', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  const box = await dialog.boundingBox();
  await dialog.getByRole('tab', { name: /^Routing/ }).click();
  expect(await dialog.boundingBox()).toEqual(box);
  await dialog.getByRole('tab', { name: /^Approval/ }).click();
  expect(await dialog.boundingBox()).toEqual(box);
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  expect(await dialog.boundingBox()).toEqual(box);
  // The footer never scrolls away: only the active panel scrolls.
  await expect(dialog.getByRole('button', { name: 'Save stage' })).toBeInViewport();
  const measured = await dialog.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  expect(measured.scrollHeight).toBeLessThanOrEqual(measured.clientHeight + 1);
});

test('opens on Stage from a stage header', async ({ page }) => {
  await openEditor(page);
  await expect(dialogOf(page).getByRole('tab', { name: /^Stage/ })).toHaveAttribute('aria-selected', 'true');
});

test('opens on Execution from a card script panel', async ({ page }) => {
  await open(page, 'scripted');
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Edit the stage that scripts this card' }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toHaveAttribute('aria-selected', 'true');
});

test('opens on Routing from a diagram connection', async ({ page }) => {
  await open(page, 'scripted');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
  await page.locator('.kb-flow-edge-group[data-connection-id^="explore->propose"]').dispatchEvent('dblclick');
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /^Routing/ })).toHaveAttribute('aria-selected', 'true');
});

test('keeps the draft and the same code surface across tabs', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  const content = dialog.locator('.kb-script-surface .cm-content');
  await content.click();
  await page.keyboard.type(' // kept');
  await expect(content).toContainText('// kept');
  // A tab change must not remount the surface: the same DOM node returns.
  await content.evaluate(node => node.setAttribute('data-probe', 'kept'));
  await dialog.getByRole('tab', { name: /^Routing/ }).click();
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  const again = dialog.locator('.kb-script-surface .cm-content');
  await expect(again).toHaveAttribute('data-probe', 'kept');
  // The draft itself survives too, including an edit made on another tab.
  await dialog.getByRole('tab', { name: /^Stage/ }).click();
  await dialog.getByLabel('Stage name').fill('Renamed in the draft');
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  await expect(again).toContainText('// kept');
  await dialog.getByRole('tab', { name: /^Stage/ }).click();
  await expect(dialog.getByLabel('Stage name')).toHaveValue('Renamed in the draft');
  expect(await commands(page)).toEqual([]);
});

test('moves between tabs from the keyboard', async ({ page }) => {
  await openEditor(page);
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Stage/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /^Execution/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('tab', { name: /^Routing/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(dialog.getByRole('tab', { name: /^Stage/ })).toHaveAttribute('aria-selected', 'true');
});

test('marks a tab that holds a problem and moves to it when save is refused', async ({ page }) => {
  await openEditor(page);
  const dialog = dialogOf(page);
  await dialog.getByLabel('Stage name').fill('');
  await dialog.getByRole('tab', { name: /^Routing/ }).click();
  await expect(dialog.getByRole('tab', { name: /^Stage.*has a problem/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog.getByRole('tab', { name: /^Stage.*has a problem/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('Fix the highlighted fields before saving.')).toBeVisible();
  await expect(dialog.getByLabel('Stage name')).toHaveValue('');
  expect(await commands(page)).toEqual([]);
});

test('reaches a problem that sits on another tab and clears its mark', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Inputs/ }).click();
  await dialog.getByRole('button', { name: 'Add parameter' }).click();
  await expect(dialog.getByRole('tab', { name: /^Inputs.*has a problem/ })).toBeVisible();
  await dialog.getByRole('tab', { name: /^Routing/ }).click();
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog.getByRole('tab', { name: /^Inputs.*has a problem/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('A parameter name is required.')).toBeVisible();
  expect(await commands(page)).toEqual([]);
  // The fixture stage already declares one parameter, so the added row is the second.
  await dialog.getByLabel('Parameter name 2').fill('app');
  await expect(dialog.getByRole('tab', { name: /^Inputs/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /^Inputs.*has a problem/ })).toHaveCount(0);
});

test('keeps the code surface undo history across tabs', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  const content = dialog.locator('.kb-script-surface .cm-content');
  await content.click();
  await page.keyboard.type('undo-me');
  await expect(content).toContainText('undo-me');
  await dialog.getByRole('tab', { name: /^Stage/ }).click();
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  await content.click();
  await page.keyboard.press(MOD + '+z');
  await expect(content).not.toContainText('undo-me');
});

test('edits the program in a code surface and saves from the keyboard', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  const content = dialog.locator('.kb-script-surface .cm-content');
  await content.click();
  await page.keyboard.type(' // keyboard');
  await page.keyboard.press(MOD + '+s');
  await expect(dialog).toBeHidden();
  const sent = await commands(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.type).toBe('board.stage.update');
  expect(String((sent[0]?.patch as { scripted?: { code?: string } } | undefined)?.scripted?.code)).toContain('// keyboard');
});

test('expresses an external file source as a path and no code surface', async ({ page }) => {
  await openEditor(page, 'scripted');
  const dialog = dialogOf(page);
  await dialog.getByRole('tab', { name: /^Execution/ }).click();
  await expect(dialog.locator('.kb-script-surface')).toHaveCount(1);
  await dialog.getByLabel('Program source').selectOption('file');
  await expect(dialog.getByLabel('Script file')).toBeVisible();
  await expect(dialog.locator('.kb-script-surface')).toHaveCount(0);
});

test('captures every tab for review', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openEditor(page, 'scripted');
    const dialog = dialogOf(page);
    for (const tab of ['Stage', 'Execution', 'Routing', 'Inputs', 'Approval'] as const) {
      await dialog.getByRole('tab', { name: new RegExp('^' + tab) }).click();
      await shoot(page, 'stage-editor-tab-' + tab.toLowerCase() + '-' + scheme + '.png');
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});
