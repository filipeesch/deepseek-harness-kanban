import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

function colorMetrics(page: Page) {
  return page.evaluate(() => {
    const channels = (value: string): [number, number, number] => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return [0, 0, 0];
      const parts = match[1]!.split(',').map(part => Number(part.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const luminance = (value: string): number => {
      const [red, green, blue] = channels(value).map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (left: string, right: string): number => {
      const a = luminance(left); const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const effectiveBackground = (element: Element | null): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const select = document.querySelector<HTMLSelectElement>('.kb-stage-select')!;
    const restricted = [...select.options].find(option => option.value === 'apply')!;
    const allowed = [...select.options].find(option => option.value === 'propose')!;
    const primary = document.querySelector<HTMLElement>('.kb-transition-dialog .kb-primary');
    const selectBackground = effectiveBackground(select);
    return {
      restricted: getComputedStyle(restricted).color,
      allowed: getComputedStyle(allowed).color,
      restrictedContrast: contrast(getComputedStyle(restricted).color, selectBackground),
      primary: primary === null ? null : {
        background: getComputedStyle(primary).backgroundColor,
        color: getComputedStyle(primary).color,
        contrast: contrast(getComputedStyle(primary).color, getComputedStyle(primary).backgroundColor),
      },
      options: [...select.options].map(option => ({ value: option.value, className: option.className, disabled: option.disabled, label: option.getAttribute('aria-label') })),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('drawer lists the full workflow, mutes restricted stages, and confirms in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=move');
  await page.getByRole('button', { name: 'Open task Long column task 0' }).click();
  const select = page.getByRole('combobox', { name: 'Move task to' });
  await expect(select).toBeVisible();
  const light = await colorMetrics(page);
  expect(light.options.map(option => option.value)).toEqual(['explore', 'propose', 'apply']);
  expect(light.options.find(option => option.value === 'apply')).toMatchObject({ disabled: false, label: 'Apply, requires confirmation' });
  expect(light.options.find(option => option.value === 'apply')!.className).toContain('kb-stage-option-restricted');
  expect(light.options.find(option => option.value === 'propose')!.className).not.toContain('kb-stage-option-restricted');
  expect(light.restricted).not.toBe(light.allowed);
  expect(light.restrictedContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'move-override-select-light.png') });

  await select.selectOption('apply');
  const dialog = page.getByRole('dialog', { name: 'Move to Apply?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Long column task 0')).toBeVisible();
  await expect(dialog.getByText(/does not allow moving this card from Explore to Apply/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const primary = dialog.getByRole('button', { name: 'Move anyway' });
  await expect(primary).toHaveClass(/kb-primary/);
  expect(await primary.evaluate(element => element.classList.contains('kb-danger'))).toBe(false);
  const lightDialog = await colorMetrics(page);
  expect(lightDialog.primary).not.toBeNull();
  expect(lightDialog.primary!.contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'move-override-dialog-light.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string }> } }).__harness.commands().some(command => command.type === 'task.move'))).toBe(false);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await colorMetrics(page);
  expect(dark.restricted).not.toBe(light.restricted);
  expect(dark.restrictedContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'move-override-select-dark.png') });
  await select.selectOption('apply');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const darkDialog = await colorMetrics(page);
  expect(darkDialog.primary!.contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'move-override-dialog-dark.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('a restricted drag warns before the drop and confirms the override', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=move');
  const card = page.getByRole('button', { name: 'Open task Long column task 0', exact: true });
  const apply = page.getByRole('region', { name: 'Apply column' });
  const cardBox = (await card.boundingBox())!;
  const applyBox = (await apply.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(applyBox.x + applyBox.width / 2, applyBox.y + 80, { steps: 12 });
  await expect(apply).toHaveClass(/kb-drop-restricted/);
  const indicator = apply.locator('.kb-drop-indicator-restricted');
  await expect(indicator).toBeVisible();
  expect(await apply.evaluate(element => getComputedStyle(element).borderStyle)).toBe('dashed');
  expect(await indicator.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('repeating-linear-gradient');
  await page.screenshot({ path: path.join(OUT, 'move-override-drag-warning.png') });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Move to Apply?' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string }> } }).__harness.commands().some(command => command.type === 'task.move'))).toBe(false);

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(applyBox.x + applyBox.width / 2, applyBox.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Move anyway' }).click();
  await expect(dialog).toBeHidden();
  await expect(apply.getByRole('button', { name: 'Open task Long column task 0' })).toBeVisible();
  const moved = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; overrideTransition?: boolean }> } }).__harness.commands().find(command => command.type === 'task.move'));
  expect(moved).toMatchObject({ type: 'task.move', columnId: 'apply', overrideTransition: true });
});
