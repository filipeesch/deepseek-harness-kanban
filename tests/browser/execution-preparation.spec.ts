import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

function primaryMetrics(page: Page) {
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
    const primary = document.querySelector<HTMLElement>('.kb-preparation .kb-primary');
    const dialog = document.querySelector<HTMLElement>('.kb-dialog');
    return {
      primary: primary === null ? null : {
        background: getComputedStyle(primary).backgroundColor,
        color: getComputedStyle(primary).color,
        contrast: contrast(getComputedStyle(primary).color, getComputedStyle(primary).backgroundColor),
      },
      dialogBackground: dialog === null ? null : getComputedStyle(dialog).backgroundColor,
      dialogContrast: dialog === null ? null : contrast(getComputedStyle(dialog).color, getComputedStyle(dialog).backgroundColor),
    };
  });
}

function commands(page: Page) {
  return page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; columnId?: string; overrideTransition?: boolean }> } }).__harness.commands());
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('asks for the worktree before the first execution in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=prepare');
  await page.getByRole('button', { name: 'Open task First execution task' }).click();
  const select = page.getByRole('combobox', { name: 'Move task to' });
  await select.selectOption('propose');
  const dialog = page.getByRole('dialog', { name: 'Prepare the first execution' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Create a worktree for this task\?/)).toBeVisible();
  await expect(dialog.getByText('First execution task')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(await commands(page)).toEqual([]);
  const light = await primaryMetrics(page);
  expect(light.primary).not.toBeNull();
  expect(light.primary!.contrast).toBeGreaterThanOrEqual(4.5);
  expect(light.dialogContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'execution-preparation-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await primaryMetrics(page);
  expect(dark.primary).not.toBeNull();
  expect(dark.primary!.contrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.dialogContrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.primary!.background).not.toBe(light.primary!.background);
  await page.screenshot({ path: path.join(OUT, 'execution-preparation-dark.png') });

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await select.inputValue()).toBe('explore');
  expect(await commands(page)).toEqual([]);
});

test('continues in the base project, creates the first conversation, and arms the countdown', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=prepare');
  await page.getByRole('button', { name: 'Open task First execution task' }).click();
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('propose');
  const dialog = page.getByRole('dialog', { name: 'Prepare the first execution' });
  await expect(dialog).toBeVisible();
  await page.clock.install({ time: new Date() });
  await dialog.getByRole('button', { name: 'Continue in base project' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Cancel automatic Propose instruction' }).first()).toBeVisible();
  const sent = await commands(page);
  expect(sent.map(command => command.type)).toEqual(['worktree.dismiss', 'conversation.create', 'task.move']);
  expect(sent.find(command => command.type === 'task.move')).toMatchObject({ type: 'task.move', columnId: 'propose' });
});

test('blocks the first execution while the worktree binding is not ready', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=prepare');
  await page.getByRole('button', { name: 'Open task Broken binding task' }).click();
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('propose');
  const dialog = page.getByRole('dialog', { name: 'Resolve the worktree binding first' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Resolve it in the Git section/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create worktree' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Continue in base project' })).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'execution-preparation-blocked.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await commands(page)).toEqual([]);
});


test('prepares the first execution on an actual board drop', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=prepare');
  const card = page.getByRole('button', { name: 'Open task First execution task', exact: true });
  await card.scrollIntoViewIfNeeded();
  const apply = page.getByRole('region', { name: 'Apply column' });
  const cardBox = (await card.boundingBox())!;
  const applyBox = (await apply.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(applyBox.x + applyBox.width / 2, applyBox.y + 80, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Prepare the first execution' });
  await expect(dialog).toBeVisible();
  expect(await commands(page)).toEqual([]);
  await page.screenshot({ path: path.join(OUT, 'execution-preparation-drop.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Explore column' }).getByRole('button', { name: 'Open task First execution task' })).toBeVisible();
  expect(await commands(page)).toEqual([]);
});
