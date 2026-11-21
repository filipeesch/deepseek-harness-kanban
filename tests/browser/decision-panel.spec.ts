import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
type HarnessWindow = { __decisionCommands?: unknown[] };

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(HARNESS + '?scenario=decision&theme=host');
}

test('presents the gate and applies nothing until the window closes', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'How should this proceed?' })).toBeVisible();
  await expect(page.getByText('The review left findings.')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm choice' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('radio', { name: 'Ship it' }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('button', { name: /Moving to Done in \d+ seconds/ })).toBeVisible();
  await expect(page.getByText(/Moving to Done in \d+ seconds\. The task stays here/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__decisionCommands ?? [])).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__decisionCommands ?? [])).toEqual([]);
});

test('submits the choice and the observation when the window closes', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'Fix it' }).check();
  await page.getByRole('textbox', { name: 'Observation' }).fill('  Please fix the copy.  ');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__decisionCommands ?? []), { timeout: 8_000 }).toEqual([
    { type: 'task.decide', taskId: 'decision-task', entryId: 'entry-gate', optionId: 'fix', destinationIdentity: 'review-identity', note: 'Please fix the copy.' },
  ]);
});

test('keeps the gate usable by keyboard and at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(HARNESS + '?scenario=decision&theme=host');
  await page.getByRole('radio', { name: 'Ship it' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Fix it' })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Moving to Review in \d+ seconds/ })).toBeVisible();
  await mkdir(OUT, { recursive: true });
  await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-panel-narrow.png') });
});

test('presents a host refusal beside the action, inside a short window', async ({ page }) => {
  // A long gate in a short window scrolls its body: the refusal must still be visible.
  await page.setViewportSize({ width: 900, height: 460 });
  await page.goto(HARNESS + '?scenario=decision&theme=host&windowMs=600&fail=1&long=1');
  await page.getByRole('radio', { name: 'Option 3' }).check();
  await page.getByRole('textbox', { name: 'Observation' }).fill('Please fix the copy.');
  await page.getByRole('button', { name: 'Confirm choice' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The destination stage changed');
  const alertBox = await alert.boundingBox();
  const stripBox = await page.locator('.kb-decision .kq-strip').boundingBox();
  expect(alertBox).not.toBeNull();
  expect(stripBox).not.toBeNull();
  // Inside the strip and inside the viewport: a body at the end of the scroller would fail here.
  expect(alertBox!.y).toBeGreaterThanOrEqual(stripBox!.y);
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(stripBox!.y + stripBox!.height + 1);
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(460 + 1);
  // The choice and the observation survive the refusal.
  await expect(page.getByRole('radio', { name: 'Option 3' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Observation' })).toHaveValue('Please fix the copy.');
  await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-panel-refused.png') });
});

test('captures the collapsed and refused dock gate in both appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    const header = page.getByRole('button', { name: /Decision needed/ });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-dock-collapsed-' + scheme + '.png') });
    await page.goto(HARNESS + '?scenario=decision&theme=host&windowMs=600&fail=1');
    await page.getByRole('radio', { name: 'Fix it' }).check();
    await page.getByRole('button', { name: 'Confirm choice' }).click();
    await expect(page.getByRole('alert')).toContainText('The destination stage changed');
    await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-dock-refused-' + scheme + '.png') });
  }
});

test('uses legible host colors in both appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(scheme === 'dark');
    await expectLegible(page, '.kb-decision .kq-question');
    await expectLegible(page, '.kb-decision .kq-option-title');
    await page.getByRole('radio', { name: 'Ship it' }).check();
    await expectLegible(page, '.kb-decision .kq-option[data-focused=true]');
    await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-panel-' + scheme + '.png') });
    await page.locator('.kb-card').screenshot({ path: path.join(OUT, 'decision-card-' + scheme + '.png') });
    await page.getByRole('button', { name: 'Confirm choice' }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await page.locator('.kb-decision').screenshot({ path: path.join(OUT, 'decision-panel-countdown-' + scheme + '.png') });
    await page.locator('.kb-card').screenshot({ path: path.join(OUT, 'decision-card-countdown-' + scheme + '.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});