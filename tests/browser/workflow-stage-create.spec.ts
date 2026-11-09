import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface HarnessCommand { type: string; title?: string; [key: string]: unknown }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] } };

/** What the shipped stage header paints around the creation action. */
interface HeaderReading {
  theme: 'light' | 'dark';
  actions: number;
  stage: string;
  name: string;
  tooltip: string;
  iconContrast: number;
  insideStage: boolean;
  titleLeftOfAction: boolean;
  actionLeftOfCount: boolean;
  headerHeights: number[];
}

async function openFlow(page: Page, themed = true): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  // The host theme fixture carries the tokens the appearance assertions read.
  await page.goto(HARNESS + '?scenario=flow' + (themed ? '&theme=host' : ''));
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  // The first paint fits the diagram before it is revealed, so geometry is settled.
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
}

function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
}

/** Resolve the colors and the geometry the stage header actually renders. */
function header(page: Page): Promise<HeaderReading> {
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
    const contrast = (left: string, right: string): number => {
      const a = luminance(left);
      const b = luminance(right);
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
    const actions = [...document.querySelectorAll<HTMLElement>('.kb-flow-stage-create')];
    const action = actions[0]!;
    const stage = action.closest<HTMLElement>('.kb-flow-stage')!;
    const headerElement = action.closest<HTMLElement>('.kb-flow-stage-header')!;
    const title = headerElement.querySelector('h2')!;
    const count = headerElement.querySelector('span')!;
    const box = (element: Element): DOMRect => element.getBoundingClientRect();
    const stageBox = box(stage);
    const actionBox = box(action);
    const titleBox = box(title);
    const countBox = box(count);
    return {
      theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
      actions: actions.length,
      stage: stage.getAttribute('data-column-id') ?? '',
      name: action.getAttribute('aria-label') ?? '',
      tooltip: action.getAttribute('title') ?? '',
      iconContrast: contrast(getComputedStyle(action).color, effectiveBackground(action)),
      // The stage clips its overflow, so a control that reaches outside is invisible.
      insideStage: actionBox.left >= stageBox.left && actionBox.right <= stageBox.right
        && actionBox.top >= stageBox.top && actionBox.bottom <= stageBox.bottom,
      titleLeftOfAction: titleBox.right <= actionBox.left,
      actionLeftOfCount: actionBox.right <= countBox.left,
      // Every stage shares one header shape: the action joins the row instead of
      // making the initial stage taller than the stages that do not offer it. Layout
      // height, not the painted rect, because the viewport transform scales the latter.
      headerHeights: [...document.querySelectorAll<HTMLElement>('.kb-flow-stage-header')].map(element => element.offsetHeight),
    };
  });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

// The header action is a 24px control, so the evidence is captured at twice the
// density to keep the icon and its edge readable.
test.use({ deviceScaleFactor: 2 });

/** Bring the diagram close enough that the header action is legible in evidence. */
async function zoomIn(page: Page, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
}

/**
 * Close evidence of the shipped header row. The stage is far taller than the row, so
 * the capture clips to it, and the row must be inside the viewport for the capture to
 * be worth anything: a clipped region that lands outside the page is silently blank.
 */
async function shootInitialStageHeader(page: Page, name: string): Promise<void> {
  const header = page.locator('.kb-flow-stage[data-column-id="explore"] .kb-flow-stage-header');
  await expect(header).toBeVisible();
  const box = (await header.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: path.join(OUT, name), clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 } });
}

test('the initial stage carries a legible creation action that keeps the header arrangement', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openFlow(page);
  const light = await header(page);
  expect(light.theme).toBe('light');
  expect(light.actions).toBe(1);
  expect(light.stage).toBe('explore');
  expect(light.name).toBe('New task');
  expect(light.tooltip).toBe('New task');
  expect(light.iconContrast).toBeGreaterThanOrEqual(4.5);
  expect(light.insideStage).toBe(true);
  expect(light.titleLeftOfAction).toBe(true);
  expect(light.actionLeftOfCount).toBe(true);
  expect(light.headerHeights.length).toBe(3);
  expect(new Set(light.headerHeights).size).toBe(1);
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await shootInitialStageHeader(page, 'workflow-stage-create-initial-light.png');
  await page.screenshot({ path: path.join(OUT, 'workflow-stage-create-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await header(page);
  expect(dark.theme).toBe('dark');
  expect(dark.actions).toBe(1);
  expect(dark.iconContrast).toBeGreaterThanOrEqual(4.5);
  expect(dark.insideStage).toBe(true);
  await shootInitialStageHeader(page, 'workflow-stage-create-initial-dark.png');
  await page.screenshot({ path: path.join(OUT, 'workflow-stage-create-dark.png') });
  // Closer evidence last: zooming animates the viewport, and a capture taken mid-flight
  // clips the wrong region.
  await zoomIn(page, 4);
  await page.screenshot({ path: path.join(OUT, 'workflow-stage-create-zoom-dark.png') });
});

test('creates from the initial stage while the layout is locked without touching the layout', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openFlow(page);
  // Locked is the resting state of the diagram, which is where the action must work.
  await expect(page.getByRole('button', { name: 'Unlock layout editing' })).toBeVisible();
  await page.locator('.kb-flow-stage-create').first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'workflow-stage-create-dialog-light.png') });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Created from the diagram');
  await dialog.getByRole('combobox', { name: 'Project' }).selectOption('p');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.locator('.kb-flow-stage', { hasText: 'Explore' }).locator('.kb-card', { hasText: 'Created from the diagram' })).toBeVisible();
  const stored = await commands(page);
  expect(stored.filter(command => command.type === 'task.create').map(command => command.title)).toEqual(['Created from the diagram']);
  // Creating is not a layout edit: the diagram stored nothing.
  expect(stored.some(command => command.type === 'board.workflow.save')).toBe(false);
});

test('pressing the action with layout editing unlocked moves nothing and answers the keyboard', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openFlow(page);
  // The locked diagram already proves the action works; this covers the other half,
  // where the real canvas is listening for a drag and could steal the press.
  await page.getByRole('button', { name: 'Unlock layout editing' }).click();
  await expect(page.getByRole('button', { name: 'Lock layout editing' })).toBeVisible();
  const stage = page.locator('.kb-flow-stage[data-column-id="explore"]');
  const action = page.locator('.kb-flow-stage-create').first();
  const before = await stage.boundingBox();
  expect(before).not.toBeNull();

  const press = await action.boundingBox();
  expect(press).not.toBeNull();
  await page.mouse.move(press!.x + press!.width / 2, press!.y + press!.height / 2);
  await page.mouse.down();
  await page.mouse.move(press!.x + 180, press!.y + 140, { steps: 8 });
  await page.mouse.up();
  // A press that starts on the action is never a gesture: the stage stays put, nothing
  // is stored, and the drag that never began leaves no dialog behind either.
  expect(await stage.boundingBox()).toEqual(before);
  expect(await page.getByRole('dialog', { name: 'New task' }).count()).toBe(0);
  expect((await commands(page)).some(command => command.type === 'board.workflow.save')).toBe(false);

  // The same path on the title does move the stage, which proves the canvas was really
  // listening: the assertion above is about the action, not about a dead diagram.
  const handle = await stage.locator('.kb-flow-stage-header h2').boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 180, handle!.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const now = await stage.boundingBox();
    return now !== null && (Math.abs(now.x - before!.x) > 1 || Math.abs(now.y - before!.y) > 1);
  }).toBe(true);

  // Keyboard activation reaches the shared experience and leaves the keyboard where the
  // user left it, which only the real composition can show.
  await action.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(action).toBeFocused();
});
