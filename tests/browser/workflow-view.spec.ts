import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

interface HarnessCommand { type: string; yaml?: string; columnId?: string; [key: string]: unknown }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] }; __travelSeen?: boolean };

async function openFlow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  // The first paint fits the diagram before it is revealed; wait for that to settle
  // so a gesture starts from the coordinates the page keeps.
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
}

async function unlock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Unlock layout editing' }).click();
}

function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
}

const GRID_STEP = 8;

/** The lattice point the diagram settles on. */
function snapToLattice(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function workflowSaves(page: Page): Promise<HarnessCommand[]> {
  return commands(page).then(commands => commands.filter(command => command.type === 'board.workflow.save'));
}

async function lastSavedWorkflow(page: Page): Promise<Array<{ id: string; position?: { x: number; y: number }; size?: { width: number; height: number } }>> {
  const saves = await workflowSaves(page);
  const yaml = saves[saves.length - 1]?.yaml;
  if (yaml === undefined) throw new Error('no workflow save to read');
  const doc = parseYaml(yaml) as { columns?: Array<{ id: string; position?: { x: number; y: number }; size?: { width: number; height: number } }> } | null;
  return doc?.columns ?? [];
}

/** The centre of a rendered route segment, in diagram coordinates. */
function segmentLine(page: Page, index: number, axis: 'x' | 'y'): Promise<number | null> {
  return page.locator('.react-flow__edge').nth(index).locator('.kb-flow-segment[data-axis="' + axis + '"]').first()
    .evaluate((element, axis) => {
      const rect = element as SVGRectElement;
      const start = Number(rect.getAttribute(axis));
      const size = Number(rect.getAttribute(axis === 'x' ? 'width' : 'height'));
      return Number.isFinite(start) && Number.isFinite(size) ? start + size / 2 : null;
    }, axis).catch(() => null);
}

function viewportStyle(page: Page): Promise<string | null> {
  return page.locator('.react-flow__viewport').getAttribute('style');
}

function scaleOf(style: string | null): number {
  const match = /scale\(([0-9.]+)\)/.exec(style ?? '');
  return match === null ? 1 : Number(match[1]);
}

function translateYOf(style: string | null): number {
  const match = /translate\((-?[0-9.]+)px, ?(-?[0-9.]+)px\)/.exec(style ?? '');
  return match === null ? 0 : Number(match[2]);
}

async function dropCard(page: Page, title: string, stageLabel: string): Promise<void> {
  // The title is the card's drag surface; the activity controls are not.
  const card = page.locator('.kb-card', { hasText: title }).first().locator('.kb-card-open');
  const target = page.locator('.kb-flow-stage', { hasText: stageLabel }).locator('.kb-card-list');
  const cardBox = (await card.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
  await page.mouse.up();
}

async function watchTravel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as HarnessWindow;
    scope.__travelSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.kb-flow-travel-card') !== null) scope.__travelSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function stageTranslate(page: Page, label: string): Promise<{ x: number; y: number }> {
  const style = await page.getByRole('region', { name: label + ' stage' }).locator('xpath=ancestor::div[@data-id][1]').getAttribute('style');
  const match = /translate\((-?[0-9.]+)px, ?(-?[0-9.]+)px\)/.exec(style ?? '');
  return match === null ? { x: 0, y: 0 } : { x: Number(match[1]), y: Number(match[2]) };
}

test('presents the configured stages, connections, and the shared cards', async ({ page }) => {
  await openFlow(page);
  await expect(page.locator('.kb-flow-stage')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Explore stage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Apply stage' })).toBeVisible();
  await expect(page.locator('.kb-flow-edge')).toHaveCount(2);
  await expect(page.locator('.kb-flow-edge.is-implicit')).toHaveCount(2);
  await expect(page.locator('.react-flow__attribution')).toBeVisible();
  // The stage renders the board card, with its context, activity, and status regions.
  await expect(page.locator('.kb-flow-stage .kb-card').first()).toBeVisible();
  await expect(page.locator('.kb-flow-stage .kb-card-context').first()).toBeVisible();
  await expect(page.locator('.kb-flow-stage .kb-card-activity').first()).toBeVisible();
  await expect(page.locator('.kb-flow-stage .kb-auto-chip').first()).toBeVisible();
  // The first paint settles once: the revealed layout does not jump afterwards.
  const settled = await stageTranslate(page, 'Explore');
  await page.waitForTimeout(250);
  expect(await stageTranslate(page, 'Explore')).toEqual(settled);
});

test('zooms with the wheel without a modifier', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  await page.mouse.move(1000, 800);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThan(scaleOf(before));
  expect(await commands(page)).toEqual([]);
});

test('starts locked and only rearranges after unlocking', async ({ page }) => {
  await openFlow(page);
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 70, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  expect((await commands(page)).filter(command => command.type === 'board.workflow.save')).toHaveLength(0);
  await expect(page.locator('.kb-flow-resize')).toHaveCount(0);

  await unlock(page);
  await expect(page.locator('.kb-flow-resize')).toHaveCount(3);
  await page.waitForTimeout(150);
  const afterUnlock = (await header.boundingBox())!;
  await page.mouse.move(afterUnlock.x + afterUnlock.width / 2, afterUnlock.y + afterUnlock.height / 2);
  await page.mouse.down();
  await page.mouse.move(afterUnlock.x + afterUnlock.width / 2 + 90, afterUnlock.y + afterUnlock.height / 2 + 70, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'board.workflow.save').length).toBe(1);
});

test('drags two stages one after another', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const first = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const before = await stageTranslate(page, 'Explore');
  const firstBox = (await first.boundingBox())!;
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2 + 80, firstBox.y + firstBox.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await stageTranslate(page, 'Explore')).x).toBeGreaterThan(before.x + 40);

  const second = page.getByRole('region', { name: 'Apply stage' }).locator('.kb-flow-stage-header');
  const applyBefore = await stageTranslate(page, 'Apply');
  const secondBox = (await second.boundingBox())!;
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2 + 90, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await stageTranslate(page, 'Apply')).y).toBeGreaterThan(applyBefore.y + 40);
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'board.workflow.save').length).toBeGreaterThanOrEqual(1);
});

test('drags a stage without moving its neighbours and Organize restores the layout', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const explore = await stageTranslate(page, 'Explore');
  const apply = await stageTranslate(page, 'Apply');
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  const delta = { x: 80, y: 50 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta.x, box.y + box.height / 2 + delta.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'board.workflow.save').length).toBe(1);
  await expect.poll(async () => (await stageTranslate(page, 'Explore')).x).toBeGreaterThan(explore.x + 20);
  expect((await stageTranslate(page, 'Apply')).x).toBeCloseTo(apply.x, 0);
  await page.getByRole('button', { name: 'Organize stages' }).click();
  await expect.poll(async () => (await stageTranslate(page, 'Explore')).x).toBeCloseTo(explore.x, 0);
});

test('follows a dragged stage with its connections', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const edge = page.locator('.kb-flow-edge').first();
  const before = await edge.getAttribute('d');
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 12 });
  const during = await edge.getAttribute('d');
  expect(during).not.toBe(before);
  await page.mouse.up();
});

test('resizes a stage and stores its size', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const region = page.getByRole('region', { name: 'Explore stage' });
  const resize = region.locator('.kb-flow-resize');
  const box = (await resize.boundingBox())!;
  const before = (await region.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'board.workflow.save').length).toBe(1);
  const saves = (await commands(page)).filter(command => command.type === 'board.workflow.save');
  expect(saves[0]?.yaml).toContain('size:');
  await expect.poll(async () => (await region.boundingBox())!.width).toBeGreaterThan(before.width + 30);
  // Explore is content-tall, so an outward vertical drag must grow the rendered
  // rectangle too, not just its invisible minimum.
  await expect.poll(async () => (await region.boundingBox())!.height).toBeGreaterThan(before.height + 20);
});

test('organizes every stage placement', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await page.getByRole('button', { name: 'Organize stages' }).click();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'board.workflow.save').length).toBe(1);
  const saves = (await commands(page)).filter(command => command.type === 'board.workflow.save');
  expect(saves[0]?.yaml).toBeTruthy();
  expect((saves[0]?.yaml ?? '').match(/position:/g)?.length).toBe(3);
});

test('drags a card between stages, travels it, and opens the drawer', async ({ page }) => {
  await openFlow(page);
  await watchTravel(page);
  await dropCard(page, 'Long column task 0', 'Apply');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  const moves = (await commands(page)).filter(command => command.type === 'task.move');
  expect(moves[0]?.columnId).toBe('apply');
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__travelSeen === true)).toBe(true);
  await expect(page.locator('.kb-flow-stage', { hasText: 'Apply' }).locator('.kb-card', { hasText: 'Long column task 0' })).toBeVisible();
  // A click right after a drop is suppressed so a drag never opens a card; wait it out.
  await page.waitForTimeout(250);
  await page.locator('.kb-flow-stage', { hasText: 'Apply' }).getByRole('button', { name: 'Open task Long column task 0' }).click();
  await expect(page.getByRole('heading', { name: 'Long column task 0', level: 2 })).toBeVisible();
});

test('settles a stage change without travel under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFlow(page);
  await watchTravel(page);
  await dropCard(page, 'Long column task 1', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__travelSeen === true)).toBe(false);
});

test('keeps the diagram keyboard reachable', async ({ page }) => {
  await openFlow(page);
  const first = page.locator('.kb-card-open').first();
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kb-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.kb-drawer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeFocused();
});

test('pans by dragging the background and fits every stage', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  await page.mouse.move(1000, 700);
  await page.mouse.down();
  await page.mouse.move(1080, 760, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => translateYOf(await viewportStyle(page))).not.toBe(translateYOf(before));
  await page.getByRole('button', { name: 'Fit to view' }).click();
  const canvas = (await page.locator('.kb-flow-canvas').boundingBox())!;
  for (const label of ['Explore', 'Propose', 'Apply']) {
    await expect.poll(async () => {
      const box = (await page.getByRole('region', { name: label + ' stage' }).boundingBox())!;
      return box.x >= canvas.x - 1 && box.y >= canvas.y - 1
        && box.x + box.width <= canvas.x + canvas.width + 1
        && box.y + box.height <= canvas.y + canvas.height + 1;
    }).toBe(true);
  }
});

test('zooms within its bounds and keeps the pointer anchored', async ({ page }) => {
  await openFlow(page);
  const canvas = (await page.locator('.kb-flow-canvas').boundingBox())!;
  const point = { x: 1000, y: 800 };
  const before = await viewportStyle(page);
  const translateBefore = /translate\((-?[0-9.]+)px, ?(-?[0-9.]+)px\)/.exec(before ?? '');
  const startX = translateBefore === null ? 0 : Number(translateBefore[1]);
  const startY = translateBefore === null ? 0 : Number(translateBefore[2]);
  const scale = scaleOf(before);
  const flowBefore = { x: (point.x - canvas.x - startX) / scale, y: (point.y - canvas.y - startY) / scale };
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThan(scale);
  const after = await viewportStyle(page);
  const translateAfter = /translate\((-?[0-9.]+)px, ?(-?[0-9.]+)px\)/.exec(after ?? '');
  const nextScale = scaleOf(after);
  const flowAfter = {
    x: (point.x - canvas.x - Number(translateAfter === null ? 0 : translateAfter[1])) / nextScale,
    y: (point.y - canvas.y - Number(translateAfter === null ? 0 : translateAfter[2])) / nextScale,
  };
  expect(Math.abs(flowAfter.x - flowBefore.x)).toBeLessThan(3);
  expect(Math.abs(flowAfter.y - flowBefore.y)).toBeLessThan(3);
  for (let index = 0; index < 20; index += 1) await page.mouse.wheel(0, -600);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeLessThanOrEqual(2.5001);
  for (let index = 0; index < 30; index += 1) await page.mouse.wheel(0, 600);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThanOrEqual(0.1999);
});

test('shows the control stack and the minimap', async ({ page }) => {
  await openFlow(page);
  const stack = page.getByRole('group', { name: 'Diagram controls' });
  await expect(stack).toBeVisible();
  for (const name of ['Zoom in', 'Zoom out', 'Fit to view', 'Undo layout change', 'Redo layout change', 'Organize stages', 'Unlock layout editing']) {
    await expect(stack.getByRole('button', { name })).toBeVisible();
  }
  const label = stack.getByRole('button', { name: 'Zoom in' });
  await expect.poll(() => label.evaluate(element => getComputedStyle(element, '::after').content)).toContain('Zoom in');
  await label.hover();
  await expect.poll(() => label.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(3);
});

test('fills the board body without an inner frame', async ({ page }) => {
  await openFlow(page);
  const body = (await page.locator('.kb-page-body').boundingBox())!;
  const canvas = (await page.locator('.kb-flow-canvas').boundingBox())!;
  expect(Math.abs(canvas.x - body.x)).toBeLessThan(1.5);
  expect(Math.abs(canvas.y - body.y)).toBeLessThan(1.5);
  expect(Math.abs(canvas.width - body.width)).toBeLessThan(1.5);
});

test('reveals the connection contact points on hover', async ({ page }) => {
  await openFlow(page);
  const edge = page.locator('.react-flow__edge').first();
  const circle = edge.locator('.kb-flow-contact').first();
  await expect.poll(() => circle.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  // A path's bounding-box center is rarely on its stroke, so find a point the
  // interaction path actually owns.
  const point = await page.evaluate(() => {
    const path = document.querySelector('.react-flow__edge-interaction');
    if (path === null) return null;
    const box = path.getBoundingClientRect();
    for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x += 2) {
      for (let y = Math.ceil(box.top); y <= Math.floor(box.bottom); y += 2) {
        if (document.elementFromPoint(x, y) === path) return { x, y };
      }
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await expect.poll(() => circle.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
});

test('moves focus through the cards in stage order and can leave the diagram', async ({ page }) => {
  await openFlow(page);
  const cards = page.locator('.kb-card-open');
  const ids = await cards.evaluateAll(elements => elements.map(element => element.closest('[data-task-id]')?.getAttribute('data-task-id')));
  await cards.first().focus();
  const seen: Array<string | null> = [];
  for (let step = 0; step < 80 && seen.length < ids.length; step += 1) {
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || !element.classList.contains('kb-card-open')) return null;
      return element.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null;
    });
    if (focused !== null && !seen.includes(focused)) seen.push(focused);
    await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(ids);
  let inside = await page.evaluate(() => document.activeElement?.closest('.kb-flow-canvas') !== null);
  // The control stack is part of the diagram's tab order, and the snapping
  // toggle adds exactly one stop after the stage content.
  for (let index = 0; index < 7 && inside; index += 1) {
    await page.keyboard.press('Tab');
    inside = await page.evaluate(() => document.activeElement?.closest('.kb-flow-canvas') !== null);
  }
  expect(inside).toBe(false);
});

test('a header click alone stores nothing', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header').click();
  await page.waitForTimeout(600);
  expect((await commands(page)).filter(command => command.type === 'board.workflow.save')).toHaveLength(0);
});

test('places the drop indicator inside the destination at any zoom', async ({ page }) => {
  await openFlow(page);
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(200);
  const region = page.getByRole('region', { name: 'Apply stage' });
  const cards = region.locator('.kb-card');
  const anchor = (await cards.first().boundingBox())!;
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  const first = (await cards.nth(0).boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  const third = (await cards.nth(2).boundingBox())!;
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height + 4, { steps: 10 });
  const indicator = page.locator('.kb-drop-indicator');
  await expect(indicator).toBeVisible();
  const indicatorBox = (await indicator.boundingBox())!;
  const expected = (first.y + first.height + third.y) / 2;
  expect(Math.abs(indicatorBox.y - expected)).toBeLessThan(6);
  await page.mouse.up();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  const reorder = (await commands(page)).find(command => command.type === 'task.move') as { columnId?: string; beforeTaskId?: string | null } | undefined;
  expect(reorder?.columnId).toBe('apply');
  expect(reorder?.beforeTaskId).toBeTruthy();
});

test('confirms a restricted diagram drop and keeps the card when cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-restricted');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  await dropCard(page, 'Long column task 0', 'Apply');
  await expect(page.locator('.kb-transition-dialog')).toBeVisible();
  await page.locator('.kb-transition-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.kb-transition-dialog')).toHaveCount(0);
  expect((await commands(page)).filter(command => command.type === 'task.move')).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Explore stage' }).locator('.kb-card', { hasText: 'Long column task 0' })).toBeVisible();
});

test('switches presentations without sending a command', async ({ page }) => {
  await openFlow(page);
  const before = (await commands(page)).length;
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Explore column' })).toBeVisible();
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  expect((await commands(page)).length).toBe(before);
});

test('captures the diagram in both host appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.verification/workflow-diagram-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.verification/workflow-diagram-dark.png' });
});

test('advances a task from its card', async ({ page }) => {
  await openFlow(page);
  const card = page.locator('.kb-flow-stage', { hasText: 'Explore' }).locator('.kb-card', { hasText: 'Long column task 0' });
  await card.getByRole('button', { name: 'Move to Propose' }).click();
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  const move = (await commands(page)).find(command => command.type === 'task.move') as { columnId?: string } | undefined;
  expect(move?.columnId).toBe('propose');
  await expect(page.getByRole('region', { name: 'Propose stage' }).locator('.kb-card', { hasText: 'Long column task 0' })).toBeVisible();
});

test('remembers the chosen presentation after a reload', async ({ page }) => {
  await openFlow(page);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Explore column' })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Explore column' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toHaveCount(0);
});

test('pans the diagram from the minimap', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  const minimap = page.locator('.react-flow__minimap');
  const box = (await minimap.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 + 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => viewportStyle(page)).not.toBe(before);
  expect(await commands(page)).toEqual([]);
});

test('zooms with a modifier key too', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  await page.mouse.move(1000, 800);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThan(scaleOf(before));
});

test('starts locked again after a reload', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await expect(page.locator('.kb-flow-resize')).toHaveCount(3);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('button', { name: 'Unlock layout editing' })).toBeVisible();
  await expect(page.locator('.kb-flow-resize')).toHaveCount(0);
});

test('restores the pan and zoom of the board after a reload', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  await page.mouse.move(1000, 800);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThan(scaleOf(before));
  // The wheel zoom settles immediately; give the stored write its frame.
  await page.waitForTimeout(250);
  const zoomed = await viewportStyle(page);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeCloseTo(scaleOf(zoomed), 2);
  expect(translateYOf(await viewportStyle(page))).toBeCloseTo(translateYOf(zoomed), 0);
  expect(await commands(page)).toEqual([]);
});

test('stores the framed position when fit-to-view is used', async ({ page }) => {
  await openFlow(page);
  const before = await viewportStyle(page);
  await page.mouse.move(1000, 800);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeGreaterThan(scaleOf(before));
  const zoomed = scaleOf(await viewportStyle(page));
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expect.poll(async () => scaleOf(await viewportStyle(page))).not.toBeCloseTo(zoomed, 2);
  // The fit animates, so the stored value is the one it settles on.
  await page.waitForTimeout(400);
  const fitted = scaleOf(await viewportStyle(page));
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => scaleOf(await viewportStyle(page))).toBeCloseTo(fitted, 2);
});

test('asks before advancing a card to a restricted next stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-restricted-next');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  const card = page.locator('.kb-flow-stage', { hasText: 'Explore' }).locator('.kb-card', { hasText: 'Long column task 0' });
  await card.getByRole('button', { name: 'Move to Propose, requires confirmation' }).click();
  const dialog = page.locator('.kb-transition-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await commands(page)).filter(command => command.type === 'task.move')).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Explore stage' }).locator('.kb-card', { hasText: 'Long column task 0' })).toBeVisible();
});

async function connectionEnd(page: Page, index: number, end: 'source' | 'target') {
  return page.locator('.react-flow__edge').nth(index).locator('.kb-flow-contact[data-end="' + end + '"]');
}

/** Points at a place the edge's interaction path owns, revealing its handles. */
async function revealEdge(page: Page, index: number): Promise<void> {
  const point = await page.evaluate(index => {
    const paths = [...document.querySelectorAll('.react-flow__edge-interaction')];
    const path = paths[index] as SVGPathElement | undefined;
    if (path === undefined) return null;
    const box = path.getBoundingClientRect();
    for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x += 4) {
      for (let y = Math.ceil(box.top); y <= Math.floor(box.bottom); y += 4) {
        if (document.elementFromPoint(x, y) === path) return { x, y };
      }
    }
    return null;
  }, index);
  if (point === null) throw new Error('the edge has no reachable point');
  await page.mouse.move(point.x, point.y);
}

/** The screen point of a stage edge, a few pixels outside the stage box. */
async function stageEdge(page: Page, label: string, side: 'top' | 'bottom'): Promise<{ x: number; y: number }> {
  const box = (await page.getByRole('region', { name: label + ' stage' }).boundingBox())!;
  return { x: box.x + box.width / 2, y: side === 'top' ? box.y - 8 : box.y + box.height + 8 };
}

async function dragHandle(page: Page, handle: ReturnType<typeof connectionEnd>, target: { x: number; y: number }, outward = 4): Promise<void> {
  const box = (await (await handle).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + outward, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

test('re-anchors a connection end and stores one change', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await revealEdge(page, 0);
  await dragHandle(page, connectionEnd(page, 0, 'source'), await stageEdge(page, 'Explore', 'top'));
  await expect.poll(async () => (await commands(page)).length).toBe(1);
  const command = (await commands(page))[0]!;
  expect(command.type).toBe('board.workflow.save');
  expect(command.yaml).toContain('connections:');
  expect(command.yaml).toContain('source: {side: top, at: 2}');
  // The handle now sits on the top edge, so its drawn position follows the anchor.
  const circle = await (await connectionEnd(page, 0, 'source')).boundingBox();
  const stage = (await page.getByRole('region', { name: 'Explore stage' }).boundingBox())!;
  expect(Math.abs((circle!.y + circle!.height / 2) - stage.y)).toBeLessThan(3);
});

test('does not adjust a connection while the diagram is locked', async ({ page }) => {
  await openFlow(page);
  await revealEdge(page, 0);
  await dragHandle(page, connectionEnd(page, 0, 'target'), await stageEdge(page, 'Propose', 'bottom'), -4);
  await page.waitForTimeout(700);
  expect(await commands(page)).toHaveLength(0);
});

test('adjusts a connection end with the keyboard', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const handle = await connectionEnd(page, 0, 'source');
  await handle.focus();
  await expect(handle).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  expect(await commands(page)).toHaveLength(0);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await commands(page)).length).toBe(1);
  const command = (await commands(page))[0]!;
  expect(command.yaml).toContain('source: {side: right, at: 4}');
});

test('restores the anchor when the keyboard adjustment is cancelled', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const handle = await connectionEnd(page, 0, 'source');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  expect(await commands(page)).toHaveLength(0);
});

test('presents a stored connection layout on open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-anchored');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  const source = await (await connectionEnd(page, 0, 'source')).boundingBox();
  const stage = (await page.getByRole('region', { name: 'Explore stage' }).boundingBox())!;
  // The stored anchor puts the touch point on the stage's top edge, not its right edge.
  expect(Math.abs((source!.y + source!.height / 2) - stage.y)).toBeLessThan(3);
  expect(Math.abs((source!.x + source!.width / 2) - (stage.x + stage.width / 2))).toBeLessThan(3);
});

test('reaches a connection end by keyboard and never traps focus', async ({ page }) => {
  await openFlow(page);
  const handle = await connectionEnd(page, 0, 'source');
  await handle.focus();
  await expect(handle).toBeFocused();
  // The handles sit in the diagram's tab sequence, and tabbing on from one of
  // them keeps moving until focus leaves the diagram.
  const labels: string[] = [];
  let left = false;
  for (let step = 0; step < 400; step++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => ({
      label: document.activeElement?.getAttribute('aria-label') ?? '',
      inside: document.activeElement !== null && document.activeElement.closest('.kb-flow-shell') !== null,
    }));
    if (!state.inside) { left = true; break; }
    labels.push(state.label);
  }
  expect(labels.filter(label => label.startsWith('Arrow from')).length).toBeGreaterThan(0);
  expect(left).toBe(true);
});

test('ignores a stored layout whose connection the diagram does not draw', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-orphan');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  // The workflow still draws its two real arrows, and the orphan entry adds none.
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  expect(await page.locator('.kb-flow-contact[data-end="source"]').count()).toBe(2);
});


async function dragHeader(page: Page, label: string, delta: { x: number; y: number }, modifier?: 'Alt'): Promise<void> {
  const header = page.getByRole('region', { name: label + ' stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  if (modifier !== undefined) await page.keyboard.down(modifier);
  await page.mouse.move(box.x + box.width / 2 + delta.x, box.y + box.height / 2 + delta.y, { steps: 12 });
  await page.mouse.up();
  if (modifier !== undefined) await page.keyboard.up(modifier);
}

test('settles a dragged stage on the nearest lattice point', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const before = await stageTranslate(page, 'Explore');
  const zoom = scaleOf(await viewportStyle(page));
  await dragHeader(page, 'Explore', { x: 90, y: 70 });
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  expect(explore?.position).toEqual({
    x: snapToLattice(before.x + 90 / zoom),
    y: snapToLattice(before.y + 70 / zoom),
  });
  await expect.poll(async () => (await stageTranslate(page, 'Explore')).x).toBe(explore!.position!.x);
});

test('settles an off-lattice stored stage on the nearest lattice point', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-offgrid');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  // The stored 13x7 placement is presented as stored before any edit.
  expect(await stageTranslate(page, 'Explore')).toEqual({ x: 13, y: 7 });
  await unlock(page);
  const zoom = scaleOf(await viewportStyle(page));
  await dragHeader(page, 'Explore', { x: 10 * zoom, y: 6 * zoom });
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  // Absolute: 13+10=23 and 7+6=13 settle on 24 and 16. A lattice of the gesture's
  // displacement would settle on 21 and 15 instead.
  expect(explore!.position).toEqual({ x: 24, y: 16 });
});

test('settles a resized stage on the nearest lattice size', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const region = page.getByRole('region', { name: 'Explore stage' });
  const before = (await region.boundingBox())!;
  const zoom = scaleOf(await viewportStyle(page));
  // The rendered rectangle is the origin an outward drag grows from.
  const rendered = { width: Math.round(before.width / zoom), height: Math.round(before.height / zoom) };
  const resize = region.locator('.kb-flow-resize');
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  expect(explore?.size).toEqual({
    width: snapToLattice(rendered.width + 90 / zoom),
    height: snapToLattice(rendered.height + 60 / zoom),
  });
  // The accepted minimum is a floor, not a lattice point, so a settled height
  // starts at the first lattice point above it.
  expect(explore!.size!.height).toBeGreaterThanOrEqual(144);
});

test('settles an adjusted route segment on the grid', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const zoom = scaleOf(await viewportStyle(page));
  const startLine = await segmentLine(page, 0, 'x');
  const segment = page.locator('.react-flow__edge').nth(0).locator('.kb-flow-segment[data-axis="x"]').first();
  const box = (await segment.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 37, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const saves = await workflowSaves(page);
  const doc = parseYaml(saves[0]!.yaml ?? '') as { connections?: Array<{ from: string; to: string; segments?: Array<{ axis: string; offset: number }> }> };
  const connection = doc.connections?.find(value => value.from === 'explore' && value.to === 'propose');
  expect(connection?.segments?.some(value => value.axis === 'x')).toBe(true);
  // The drawn line, not the relative offset, is what lands on the lattice.
  const line = await segmentLine(page, 0, 'x');
  expect(line).not.toBeNull();
  expect(line).toBeCloseTo(snapToLattice(startLine! + 37 / zoom), 6);

  // With Alt the same gesture keeps the pointer's own displacement: thirteen
  // units past the settled line, which is not a lattice multiple, so the stored
  // offset cannot move by a whole number of lattice steps.
  const firstOffset = connection?.segments?.find(value => value.axis === 'x')?.offset;
  const moved = page.locator('.react-flow__edge').nth(0).locator('.kb-flow-segment[data-axis="x"]').first();
  const movedBox = (await moved.boundingBox())!;
  await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + movedBox.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(movedBox.x + movedBox.width / 2 + 13 * zoom, movedBox.y + movedBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(2);
  const secondSave = (await workflowSaves(page))[1]!;
  const secondDoc = parseYaml(secondSave.yaml ?? '') as { connections?: Array<{ from: string; to: string; segments?: Array<{ axis: string; offset: number }> }> };
  const secondOffset = secondDoc.connections?.find(value => value.from === 'explore' && value.to === 'propose')?.segments?.find(value => value.axis === 'x')?.offset;
  expect(secondOffset).toBeDefined();
  expect(Math.abs(secondOffset! - firstOffset!) % 8).not.toBe(0);
});

test('moves a stage freely while the bypass modifier is held', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const before = await stageTranslate(page, 'Explore');
  const zoom = scaleOf(await viewportStyle(page));
  await dragHeader(page, 'Explore', { x: 37 * zoom, y: 21 * zoom }, 'Alt');
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  // The pointer moved 37 and 21 units with the bypass on, so the workflow stores
  // exactly that whole-unit displacement and not a lattice neighbour.
  expect(explore!.position).toEqual({ x: Math.round(before.x + 37), y: Math.round(before.y + 21) });
});

test('resizes a stage freely while the bypass modifier is held', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const region = page.getByRole('region', { name: 'Explore stage' });
  const before = (await region.boundingBox())!;
  const zoom = scaleOf(await viewportStyle(page));
  const rendered = { width: Math.round(before.width / zoom), height: Math.round(before.height / zoom) };
  const resize = region.locator('.kb-flow-resize');
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2 + 37 * zoom, box.y + box.height / 2 + 21 * zoom, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  // The pointer's own displacement, rounded to whole units, and not a lattice size.
  expect(explore!.size).toEqual({ width: rendered.width + 37, height: rendered.height + 21 });
});

test('stores nothing for a press without movement', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const undo = page.getByRole('button', { name: 'Undo layout change' });
  await expect(undo).toBeDisabled();
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(await workflowSaves(page)).toHaveLength(0);
  await expect(undo).toBeDisabled();
});

test('keeps the snapping control available and effective while the layout is locked', async ({ page }) => {
  await openFlow(page);
  // The diagram starts locked, so the layout controls are unavailable.
  await expect(page.getByRole('button', { name: 'Organize stages' })).toBeDisabled();
  const toggle = page.getByRole('button', { name: 'Turn off grid snapping' });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  const restored = page.getByRole('button', { name: 'Turn on grid snapping' });
  await expect(restored).toHaveAttribute('aria-pressed', 'false');
  expect(await workflowSaves(page)).toHaveLength(0);
  // A locked diagram still does not rearrange, with snapping on or off.
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 70, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(await workflowSaves(page)).toHaveLength(0);
});

test('remembers the snapping preference after a reload', async ({ page }) => {
  await openFlow(page);
  await page.getByRole('button', { name: 'Turn off grid snapping' }).click();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('button', { name: 'Turn on grid snapping' })).toBeVisible();
  // The remembered preference drives the edit, not only the control: the same
  // unsnapped displacement that is a lattice point under snapping.
  await unlock(page);
  const before = await stageTranslate(page, 'Explore');
  const zoom = scaleOf(await viewportStyle(page));
  await dragHeader(page, 'Explore', { x: 37 * zoom, y: 21 * zoom });
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  // The free pointer result, rounded to the whole units the workflow stores.
  expect(explore!.position).toEqual({ x: Math.round(before.x + 37), y: Math.round(before.y + 21) });
});

test('organizes every stage with the same geometry as without snapping', async ({ page }) => {
  await openFlow(page);
  const labels = ['Explore', 'Propose', 'Apply'];
  const automatic = new Map<string, { x: number; y: number }>();
  for (const label of labels) automatic.set(label, await stageTranslate(page, label));
  await unlock(page);
  await dragHeader(page, 'Explore', { x: 90, y: 70 });
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Organize stages' }).click();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(2);
  const organized = new Map((await lastSavedWorkflow(page)).map(column => [column.id, column.position]));
  expect(organized.get('explore')).toEqual(automatic.get('Explore'));
  expect(organized.get('propose')).toEqual(automatic.get('Propose'));
  expect(organized.get('apply')).toEqual(automatic.get('Apply'));
});


test('keeps the bypass when the modifier is held at pointer down', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const before = await stageTranslate(page, 'Explore');
  const zoom = scaleOf(await viewportStyle(page));
  const header = page.getByRole('region', { name: 'Explore stage' }).locator('.kb-flow-stage-header');
  const box = (await header.boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Released before the pointer moves: the gesture began with the bypass.
  await page.keyboard.up('Alt');
  await page.mouse.move(box.x + box.width / 2 + 37 * zoom, box.y + box.height / 2 + 21 * zoom, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  const explore = (await lastSavedWorkflow(page)).find(column => column.id === 'explore');
  expect((explore!.position!.x - before.x) % 8).not.toBe(0);
  expect((explore!.position!.y - before.y) % 8).not.toBe(0);
});

test('stores nothing when an adjusted route segment returns to its line', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const handle = () => page.locator('.react-flow__edge').nth(0).locator('.kb-flow-segment[data-axis="x"]').first();
  const first = (await (await handle()).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 37, first.y + first.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  // The settled line is a lattice point, so a gesture that returns the segment to
  // it settles exactly where it started and must store nothing.
  const settled = (await (await handle()).boundingBox())!;
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height / 2);
  await page.mouse.down();
  await page.mouse.move(settled.x + settled.width / 2 + 37, settled.y + settled.height / 2, { steps: 6 });
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(await workflowSaves(page)).toHaveLength(1);
});
