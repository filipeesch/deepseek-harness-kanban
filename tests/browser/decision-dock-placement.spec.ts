import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const QUESTION = '.kq-strip[aria-label="Questions from the agent"]';

interface Box { x: number; y: number; width: number; height: number }

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox();
  if (found === null) throw new Error('No bounding box for ' + selector);
  return found;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(HARNESS + '?scenario=decision&theme=host' + query);
  // The seat measures the strip before its first paint; wait for that measurement so a
  // geometry assertion never reads the pre-measurement fallback.
  const measured = () => page.locator('[data-kb-dock-strip]').first().evaluate(element =>
    getComputedStyle(element).getPropertyValue('--kb-dock-budget').trim() !== '' || element.hasAttribute('data-kb-dock-cramped'));
  await expect.poll(measured, { timeout: 5_000 }).toBe(true);
}

function right(value: Box): number { return value.x + value.width; }
function bottom(value: Box): number { return value.y + value.height; }
function center(value: Box): number { return value.x + value.width / 2; }

test('the gate is the only strip, docked above the question round and the composer', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await open(page, '&question=1');
  await expect(page.getByRole('heading', { name: 'How should this proceed?' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Questions from the agent' })).toBeVisible();
  // Exactly one gate, and it lives inside the composer seat rather than the drawer or the page.
  await expect(page.locator('.kb-decision')).toHaveCount(1);
  const inSeat = await page.locator('.kb-decision').evaluate(element => element.closest('[data-composer-seat]') !== null);
  expect(inSeat).toBe(true);
  const gate = await box(page, '.kb-decision');
  const question = await box(page, QUESTION);
  const composer = await box(page, '[data-composer-stand-in]');
  expect(bottom(gate)).toBeLessThanOrEqual(question.y + 1);
  expect(bottom(question)).toBeLessThanOrEqual(composer.y + 1);
  expect(bottom(composer)).toBeLessThanOrEqual(900 + 1);
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'decision-dock-placement.png') });
});

test('the strips follow the composer width and centering', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, '&question=1');
  const gate = await box(page, '.kb-decision .kq-strip');
  const question = await box(page, QUESTION);
  const composer = await box(page, '[data-composer-stand-in]');
  const inset = 4 * 8;
  expect(Math.abs(gate.width - (composer.width - inset))).toBeLessThanOrEqual(2);
  expect(Math.abs(question.width - gate.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(center(gate) - center(composer))).toBeLessThanOrEqual(2);
  expect(Math.abs(center(question) - center(composer))).toBeLessThanOrEqual(2);
  expect(right(gate) - right(composer)).toBeLessThanOrEqual(inset / 2 + 2);
});

test('a short window keeps every control and the composer reachable, and both strips answerable', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await open(page, '&long=1&question=1&files=20&composer=150&windowMs=300');
  const viewport = page.viewportSize()!;
  const composer = await box(page, '[data-composer-stand-in]');
  const gateHeader = await box(page, '.kb-decision .kq-header-row');
  const gateFooter = await box(page, '.kb-decision .kq-footer');
  const questionHeader = await box(page, QUESTION + ' .kq-header');
  const questionFooter = await box(page, QUESTION + ' .kq-footer');
  expect(gateHeader.y).toBeGreaterThanOrEqual(0);
  expect(bottom(gateFooter)).toBeLessThanOrEqual(viewport.height + 1);
  expect(questionHeader.y).toBeGreaterThanOrEqual(0);
  expect(bottom(questionFooter)).toBeLessThanOrEqual(viewport.height + 1);
  expect(composer.y).toBeGreaterThanOrEqual(0);
  expect(bottom(composer)).toBeLessThanOrEqual(viewport.height + 1);
  // Both bodies scroll, and the file list scrolls on its own row.
  expect(await page.locator('.kb-decision .kq-scroll').evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBe(true);
  expect(await page.locator(QUESTION + ' .kq-scroll').evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBe(true);
  const chips = page.locator('.ka-chips').first();
  expect(await chips.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(true);
  // A file token keeps a readable name inside the scrolling row.
  const chipName = await page.locator('.ka-chip-name').first().evaluate(element => element.getBoundingClientRect().width);
  expect(chipName).toBeGreaterThan(28);
  // The crowded state is what the reviewer's evidence must show, before either answer lands.
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'decision-dock-short-window.png') });

  // Both strips are answered here, not merely visible.
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await expect(gate.getByRole('button', { name: 'Confirm choice' })).toBeEnabled();
  const gateConfirm = await gate.getByRole('button', { name: 'Confirm choice' }).boundingBox();
  expect(gateConfirm!.y + gateConfirm!.height).toBeLessThanOrEqual(viewport.height + 1);

  // A file is identified and removable from the scrolling row before the round is answered.
  await page.locator('.ka-chip-remove').first().click();
  await expect(page.locator('.ka-chip')).toHaveCount(19);

  const question = page.locator(QUESTION);
  await question.getByRole('radio', { name: 'Local' }).check();
  await question.getByRole('button', { name: 'Next' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('question-reply')).toContainText('Local');

  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0), { timeout: 5_000 }).toBe(1);
});

test('a narrow file row can be scrolled to its last token and cleared, then the round submitted', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&question=1&files=20&composer=150');
  const chips = page.locator('.ka-chips').first();
  await expect(chips).toBeVisible();
  // Reach the last token, not only the first one.
  await chips.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const lastChip = page.locator('.ka-chip').last();
  const removable = lastChip.locator('.ka-chip-remove');
  await removable.click();
  await expect(page.locator('.ka-chip')).toHaveCount(19);
  const question = page.locator(QUESTION);
  await question.getByRole('radio', { name: 'Local' }).check();
  await question.getByRole('button', { name: 'Next' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('question-reply')).toContainText('Local');
});

test('a growing composer keeps the fixed controls reachable through the strip itself', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&question=1&composer=250');
  // The fixed controls cannot all fit, so both strips opt into scrolling as a whole.
  await expect(page.locator('[data-kb-dock-tight]')).toHaveCount(2);
  const firstStrip = page.locator('.kb-decision .kq-strip');
  const scrollToEnd = async (selector: string) => page.locator(selector).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await scrollToEnd('.kb-decision .kq-strip');
  const strip = await box(page, '.kb-decision .kq-strip');
  const confirm = await box(page, '.kb-decision .kq-primary');
  expect(confirm.y).toBeGreaterThanOrEqual(strip.y - 1);
  expect(confirm.y + confirm.height).toBeLessThanOrEqual(strip.y + strip.height + 1);
  await expect(firstStrip).toBeVisible();
  await scrollToEnd(QUESTION);
  const questionStrip = await box(page, QUESTION);
  const next = await box(page, QUESTION + ' .kq-primary');
  expect(next.y).toBeGreaterThanOrEqual(questionStrip.y - 1);
  expect(next.y + next.height).toBeLessThanOrEqual(questionStrip.y + questionStrip.height + 1);
});

test('a hidden question round leaves the whole height to the gate', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  const budgetOf = async (query: string) => {
    await open(page, query);
    const wrapper = page.locator('[data-kb-dock-strip]').first();
    await expect(wrapper).toBeVisible();
    const value = await wrapper.evaluate(element => getComputedStyle(element).getPropertyValue('--kb-dock-budget').trim());
    return Number.parseFloat(value);
  };
  const withHiddenQuestion = await budgetOf('&question=1&files=20&composer=96&submitted=1');
  const withoutQuestion = await budgetOf('&long=1&composer=96');
  expect(Number.isFinite(withHiddenQuestion)).toBe(true);
  expect(Math.abs(withHiddenQuestion - withoutQuestion)).toBeLessThanOrEqual(1);
});

test('an embedded conversation bounds the strips by its own scrollport', async ({ page }) => {
  // A conversation smaller than the browser window: the strips must answer to it, not to the viewport.
  await page.setViewportSize({ width: 900, height: 900 });
  await open(page, '&long=1&question=1&files=20&composer=150&embed=530');
  const conversation = await box(page, '[data-scroll-body]');
  const composer = await box(page, '[data-composer-stand-in]');
  expect(bottom(conversation)).toBeLessThanOrEqual(531);
  expect(bottom(composer)).toBeLessThanOrEqual(bottom(conversation) + 1);
  const gateHeader = await box(page, '.kb-decision .kq-header-row');
  expect(gateHeader.y).toBeGreaterThanOrEqual(conversation.y);
  // Neither end of the transcript may move a control out of the conversation.
  for (const position of ['top', 'bottom'] as const) {
    await page.locator('[data-scroll-body]').evaluate((element, where) => { element.scrollTop = where === 'top' ? 0 : element.scrollHeight; }, position);
    const header = await box(page, '.kb-decision .kq-header-row');
    const confirm = await box(page, '.kb-decision .kq-footer');
    expect(header.y).toBeGreaterThanOrEqual(conversation.y - 1);
    expect(bottom(confirm)).toBeLessThanOrEqual(bottom(conversation) + 1);
    expect(bottom(await box(page, '[data-composer-stand-in]'))).toBeLessThanOrEqual(bottom(conversation) + 1);
  }
});

test('a narrow refused gate keeps the refusal and the confirm action inside the strip', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&fail=1&windowMs=600');
  await page.getByRole('radio', { name: 'Option 3' }).check();
  await page.getByRole('textbox', { name: 'Observation' }).fill('Please fix the copy.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The destination stage changed');
  const alertBox = await box(page, '.kb-decision .kq-error');
  const strip = await box(page, '.kb-decision .kq-strip');
  const confirm = await page.locator('.kb-decision .kq-primary').boundingBox();
  expect(alertBox.y).toBeGreaterThanOrEqual(strip.y - 1);
  expect(bottom(alertBox)).toBeLessThanOrEqual(bottom(strip) + 1);
  expect(confirm!.y).toBeGreaterThanOrEqual(strip.y - 1);
  expect(confirm!.y + confirm!.height).toBeLessThanOrEqual(bottom(strip) + 1);
  await expect(page.getByRole('radio', { name: 'Option 3' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Observation' })).toHaveValue('Please fix the copy.');
  await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-dock-refused-narrow.png') });
});

test('the countdown stays cancelable when its footer wraps in a short window', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&composer=190&windowMs=600');
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  const cancel = gate.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeVisible();
  // A pointer click without scrolling the strip: a wrapped footer must not clip this away.
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0)).toBe(0);
});

test('a composer that fills the conversation leaves both surfaces answerable above it', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  // The pinned host offsets the conversation and makes the sticky seat a containing block.
  await open(page, '&long=1&question=1&files=4&composer=400&windowMs=600&offset=40');
  await expect(page.locator('[data-kb-dock-cramped]')).toHaveCount(2);
  // The panels are stacked inside the conversation rather than squeezed to nothing.
  const conversation = await box(page, '[data-scroll-body]');
  const gatePanel = await box(page, '.kb-decision .kq-strip');
  const questionPanel = await box(page, QUESTION);
  expect(gatePanel.y).toBeGreaterThanOrEqual(conversation.y - 1);
  expect(bottom(questionPanel)).toBeLessThanOrEqual(bottom(conversation) + 1);
  expect(gatePanel.y).toBeLessThan(questionPanel.y);
  // Disjoint slots: the expanded panels never cover each other's controls.
  expect(bottom(gatePanel)).toBeLessThanOrEqual(questionPanel.y + 1);
  // The panels are placed inside the visible viewport, not merely inside the conversation.
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  for (const panel of [gatePanel, questionPanel]) {
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(bottom(panel)).toBeLessThanOrEqual(viewport.height + 1);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  expect(await page.evaluate(() => document.querySelector('[data-scroll-body]')?.scrollTop ?? -1)).toBe(0);
  // Both surfaces are answered here, not merely positioned.
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await gate.getByRole('button', { name: 'Cancel', exact: true }).click();
  const question = page.locator(QUESTION);
  await question.getByRole('radio', { name: 'Local' }).check();
  await question.getByRole('button', { name: 'Next' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('question-reply')).toContainText('Local');
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'decision-dock-cramped.png') });
});

test('crossing the presentation threshold keeps both drafts', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&question=1&composer=150');
  const gate = page.locator('.kb-decision');
  const question = page.locator(QUESTION);
  // Answer both surfaces in the docked presentation.
  await gate.getByRole('radio', { name: 'Ship it' }).check();
  await gate.getByRole('textbox', { name: 'Observation' }).fill('Keep this observation.');
  await question.getByRole('radio', { name: 'Local' }).check();
  // Grow the composer until the strips must move above the conversation.
  await page.evaluate(() => (window as unknown as { __harnessSetComposer: (value: number) => void }).__harnessSetComposer(400));
  await expect(page.locator('[data-kb-dock-cramped]')).toHaveCount(2);
  await expect.poll(() => gate.getByRole('textbox', { name: 'Observation' }).inputValue()).toBe('Keep this observation.');
  await expect(gate.getByRole('radio', { name: 'Ship it' })).toBeChecked();
  await expect(question.getByRole('radio', { name: 'Local' })).toBeChecked();
  // Shrink it again: neither draft may be discarded on the way back.
  await page.evaluate(() => (window as unknown as { __harnessSetComposer: (value: number) => void }).__harnessSetComposer(150));
  await expect(page.locator('[data-kb-dock-cramped]')).toHaveCount(0);
  await expect.poll(() => gate.getByRole('textbox', { name: 'Observation' }).inputValue()).toBe('Keep this observation.');
  await expect(question.getByRole('radio', { name: 'Local' })).toBeChecked();
  // The retained answers still apply.
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await gate.getByRole('button', { name: 'Cancel', exact: true }).click();
  await question.getByRole('button', { name: 'Next' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('question-reply')).toContainText('Local');
});

test('an intermediate composer height still lets the question be answered', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  for (const composer of [270, 290, 310]) {
    await open(page, '&long=1&question=1&composer=' + composer);
    const question = page.locator(QUESTION);
    // The strip is tight here: select and submit without scrolling any outer surface.
    await expect(page.locator('[data-kb-dock-tight]')).toHaveCount(2);
    await question.getByRole('radio', { name: 'Local' }).check();
    await question.getByRole('button', { name: 'Next' }).click();
    await question.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('question-reply')).toContainText('Local');
  }
});

test('collapsing the cramped panels gives the composer back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&question=1&composer=400&offset=40');
  await expect(page.locator('[data-kb-dock-cramped]')).toHaveCount(2);
  // Collapse both strips to their headers.
  await page.locator('.kb-decision .kq-header').click();
  await page.locator(QUESTION + ' .kq-header').click();
  const gatePanel = await box(page, '.kb-decision .kq-strip');
  const questionPanel = await box(page, QUESTION);
  expect(gatePanel.height).toBeLessThan(60);
  expect(questionPanel.height).toBeLessThan(60);
  // The composer accepts a pointer click and typing through the launchers.
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.click();
  await composer.fill('Typed after collapsing both panels.');
  await expect(composer).toHaveValue('Typed after collapsing both panels.');
});

test('both waiting strips can cancel from their pinned header', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&question=1&composer=190&windowMs=900');
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  const cancel = page.locator('.kb-decision .kq-header-row').getByRole('button', { name: 'Cancel', exact: true });
  // The cancel action lives in the pinned header: clickable without scrolling the strip.
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0)).toBe(0);
});

test('the countdown stays cancelable after scrolling a tight gate', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&long=1&question=1&composer=270&windowMs=900');
  const gate = page.locator('.kb-decision');
  const strip = gate.locator('.kq-strip');
  // Scroll the gate as far as it goes, then pick an option and start the window.
  await strip.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await gate.getByRole('radio', { name: 'Option 6' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  const cancel = gate.getByRole('button', { name: 'Cancel', exact: true });
  // The pinned header row keeps the cancel action on screen without resetting the scroll.
  const viewport = await page.evaluate(() => window.innerHeight);
  const cancelBox = await box(page, '.kb-decision .kq-header-cancel');
  expect(cancelBox.y).toBeGreaterThanOrEqual(0);
  expect(bottom(cancelBox)).toBeLessThanOrEqual(viewport + 1);
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0)).toBe(0);
});

test('a shallow conversation shows compact launchers with one panel open', async ({ page }) => {
  // The visible conversation is 200px tall, too shallow for two usable panels.
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  await expect(page.locator('[data-kb-dock-launcher]')).toHaveCount(2);
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]')).toHaveCount(1);
  // The open panel sits below the launchers, never over them.
  const launchers = await page.locator('[data-kb-dock-launcher][data-kb-dock-active="false"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  const openPanel = await box(page, '[data-kb-dock-launcher][data-kb-dock-active="true"]');
  // The open panel starts below every launcher, so no launcher is covered.
  for (const launcher of launchers) expect(openPanel.y).toBeGreaterThanOrEqual(bottom(launcher) - 1);
  // The gate is open first: answer it.
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await gate.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Opening the question moves the open panel to it.
  const question = page.locator(QUESTION);
  await question.locator('.kq-header').click();
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]')).toHaveCount(1);
  await question.getByRole('radio', { name: 'Local' }).check();
  await question.getByRole('button', { name: 'Next' }).click();
  await question.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('question-reply')).toContainText('Local');
});

test('reopening a shallow conversation opens a launcher again', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  // Open the question launcher, then close and reopen the conversation.
  await page.locator(QUESTION + ' .kq-header').click();
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]')).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __harnessToggleDock: (open: boolean) => void }).__harnessToggleDock(false));
  await expect(page.locator('[data-kb-dock-launcher]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __harnessToggleDock: (open: boolean) => void }).__harnessToggleDock(true));
  // The stale open id is not reused: exactly one visible strip opens, and it is answerable.
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]')).toHaveCount(1);
  const active = page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]');
  await expect(active).toContainText('Decision needed');
  await expect(active.locator('.kq-panel')).not.toHaveAttribute('hidden');
});

test('a collapsed launcher reports its visible state and opens on activation', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  const questionHeader = page.locator(QUESTION + ' .kq-header');
  const questionLauncher = page.locator('[data-kb-dock-launcher][data-kb-dock-active="false"]').filter({ has: page.locator(QUESTION) });
  // Focus alone must not open the panel.
  await questionHeader.focus();
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(QUESTION + ' .kq-panel')).toHaveAttribute('hidden', '');
  await expect(page.locator(QUESTION + ' .kq-panel')).toBeHidden();
  // Enter on the launcher opens it without toggling it shut.
  await page.keyboard.press('Enter');
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(QUESTION + ' .kq-panel')).not.toHaveAttribute('hidden');
  await expect(page.locator(QUESTION + ' .kq-panel')).toBeVisible();
  // A second activation is the ordinary collapse, and the strip stays the open one.
  await page.keyboard.press('Enter');
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]').filter({ has: page.locator(QUESTION) })).toHaveCount(1);
});

test('a collapsed launcher opens again after switching and reactivating', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  const questionHeader = page.locator(QUESTION + ' .kq-header');
  const gateHeader = page.locator('.kb-decision .kq-header');
  // Open the question, then collapse it.
  await questionHeader.click();
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'false');
  // Switch to the gate, then reactivate the collapsed question.
  await gateHeader.click();
  await expect(gateHeader).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // Reactivating the question selects it and opens its body in one action.
  await questionHeader.focus();
  await page.keyboard.press('Enter');
  await expect(questionHeader).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(QUESTION + ' .kq-panel')).toBeVisible();
  await expect(page.locator(QUESTION + ' .kq-panel')).not.toHaveAttribute('hidden');
});

test('leaving the launcher presentation keeps the form disclosure state', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400');
  // The gate is the open launcher and its body is visible.
  await expect(page.locator('.kb-decision .kq-header')).toHaveAttribute('aria-expanded', 'true');
  // Return to an ordinary layout without touching the header.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(() => (window as unknown as { __harnessSetComposer: (value: number) => void }).__harnessSetComposer(150));
  await expect(page.locator('[data-kb-dock-launcher]')).toHaveCount(0);
  await expect(page.locator('.kb-decision .kq-header')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.kb-decision .kq-panel')).toHaveCount(1);
});

test('an inactive launcher still cancels its countdown by pointer and by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  const gate = page.locator('.kb-decision');
  // Start the window from the open gate, then open the question launcher so the gate is inactive.
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await page.locator(QUESTION + ' .kq-header').click();
  await expect(page.locator('[data-kb-dock-launcher][data-kb-dock-active="true"]').filter({ has: page.locator(QUESTION) })).toHaveCount(1);
  const cancel = gate.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0)).toBe(0);
});

test('an inactive launcher cancels its countdown with the keyboard too', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 200 });
  await open(page, '&long=1&question=1&composer=400&windowMs=900');
  const gate = page.locator('.kb-decision');
  await gate.getByRole('radio', { name: 'Option 3' }).check();
  await gate.getByRole('button', { name: 'Confirm choice' }).click();
  await page.locator(QUESTION + ' .kq-header').click();
  const cancel = gate.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => (window as unknown as { __decisionCommands?: unknown[] }).__decisionCommands?.length ?? 0)).toBe(0);
});

test('focus survives crossing the presentation threshold', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&question=1&composer=150');
  const observation = page.locator('.kb-decision').getByRole('textbox', { name: 'Observation' });
  await observation.click();
  await observation.fill('Keep this');
  const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null);
  expect(await focusedLabel()).toBe('Observation');
  await page.evaluate(() => (window as unknown as { __harnessSetComposer: (value: number) => void }).__harnessSetComposer(400));
  await expect(page.locator('[data-kb-dock-cramped]')).toHaveCount(2);
  expect(await focusedLabel()).toBe('Observation');
  await page.keyboard.type(' observation');
  await expect(observation).toHaveValue('Keep this observation');
  await page.evaluate(() => (window as unknown as { __harnessSetComposer: (value: number) => void }).__harnessSetComposer(150));
  expect(await focusedLabel()).toBe('Observation');
  await page.keyboard.type(' here');
  await expect(observation).toHaveValue('Keep this observation here');
});

test('closing a cramped conversation removes its portaled panels', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page, '&question=1&composer=400');
  await expect(page.locator('body > [data-kb-dock-panel]')).toHaveCount(2);
  await page.evaluate(() => (window as unknown as { __harnessToggleDock: (open: boolean) => void }).__harnessToggleDock(false));
  await expect(page.locator('body > [data-kb-dock-panel]')).toHaveCount(0);
});

test('the strips follow the conversation height instead of the browser height', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const full = await (async () => {
    await open(page, '&question=1&composer=150');
    return box(page, '.kb-decision .kq-strip');
  })();
  const embedded = await (async () => {
    await open(page, '&question=1&composer=150&embed=530');
    return box(page, '.kb-decision .kq-strip');
  })();
  expect(embedded.height).toBeLessThan(full.height);
});

test('the gate is self-sufficient outside the Kanban page scope', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await open(page, '&noscope=1');
  await expect(page.getByRole('heading', { name: 'How should this proceed?' })).toBeVisible();
  const style = await page.locator('.kb-decision .kq-strip').evaluate(element => {
    const computed = getComputedStyle(element);
    return { border: computed.borderTopWidth, background: computed.backgroundColor };
  });
  expect(style.border).not.toBe('0px');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
});