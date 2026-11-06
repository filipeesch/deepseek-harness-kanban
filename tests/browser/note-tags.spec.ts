import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

/** Contrast of the tag chips, the note preview, and the note overlay against their rendered surfaces. */
function renderedContrast(page: Page) {
  return page.evaluate(() => {
    const channels = (value: string): [number, number, number] => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(value);
      if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
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
    const ratio = (left: string, right: string): number => {
      const a = luminance(left); const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const background = (element: Element | null): string => {
      let current: Element | null = element;
      while (current !== null) {
        const value = getComputedStyle(current).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const chip = document.querySelector<HTMLElement>('.kb-note-card .kb-tag');
    const preview = document.querySelector<HTMLElement>('.kb-note-preview');
    const dialog = document.querySelector<HTMLElement>('.kb-dialog');
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      tagContrast: chip === null ? 0 : ratio(getComputedStyle(chip).color, background(chip)),
      previewContrast: preview === null ? 0 : ratio(getComputedStyle(preview).color, background(preview)),
      dialogContrast: dialog === null ? 0 : ratio(getComputedStyle(dialog).color, background(dialog)),
    };
  });
}

test('renders tags, filters notes, and keeps chip and overlay contrast in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=notes');
  await page.getByRole('button', { name: 'Open task Short task' }).click();
  await page.getByRole('tab', { name: 'Notes' }).click();

  await expect(page.getByRole('group', { name: 'Filter notes by tag' })).toBeVisible();
  await expect(page.locator('.kb-note-card')).toHaveCount(2);
  await expect(page.locator('.kb-note-card').first()).toContainText('Design note');
  const previewHeight = await page.locator('.kb-note-preview').first().evaluate(element => getComputedStyle(element).maxHeight);
  expect(previewHeight).toBe('250px');

  await page.getByRole('button', { name: 'design' }).click();
  await expect(page.locator('.kb-note-card')).toHaveCount(1);
  await expect(page.locator('.kb-note-card').first()).toContainText('Design note');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('.kb-note-card')).toHaveCount(2);

  const light = await renderedContrast(page);
  expect(light.theme).toBe('light');
  expect(light.tagContrast).toBeGreaterThanOrEqual(4.5);
  expect(light.previewContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'note-tags-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await renderedContrast(page);
  expect(dark.theme).toBe('dark');
  expect(dark.tagContrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.previewContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'note-tags-dark.png') });

  await page.getByRole('button', { name: 'Edit note n1' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByRole('dialog')).toContainText('bold');
  const overlay = await renderedContrast(page);
  expect(overlay.dialogContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'note-overlay-dark.png') });
});

test('creates and deletes a tagged note through the overlay', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=notes');
  await page.getByRole('button', { name: 'Open task Short task' }).click();
  await page.getByRole('tab', { name: 'Notes' }).click();

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Markdown' }).fill('Created in the overlay');
  await page.getByRole('combobox', { name: 'Tags' }).fill('Design');
  await page.getByRole('combobox', { name: 'Tags' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Remove tag design' })).toBeVisible();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.kb-note-card')).toHaveCount(3);
  const created = page.locator('.kb-note-card').filter({ hasText: 'Created in the overlay' });
  await expect(created).toContainText('design');

  const saved = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; tags?: string[] }> } }).__harness.commands());
  expect(saved).toContainEqual(expect.objectContaining({ type: 'note.save', tags: ['design'] }));

  await created.getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete note' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm deleting note' });
  await confirm.getByRole('button', { name: 'Delete note permanently' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.kb-note-card')).toHaveCount(2);
  const commands = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string }> } }).__harness.commands());
  expect(commands).toContainEqual(expect.objectContaining({ type: 'note.delete' }));

  await page.getByRole('button', { name: 'design' }).click();
  await expect(page.locator('.kb-note-card')).toHaveCount(1);
  await expect(page.locator('.kb-note-card').first()).toContainText('Design note');
});
