import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { strokeContrastOf } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

/** Evidence for the reviewer; `.verification/` is gitignored. */
async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

interface HarnessCommand { type: string; yaml?: string; columnId?: string; [key: string]: unknown }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] }; __transitSeen?: boolean; __arrivalSeen?: boolean };

async function openFlow(page: Page, query = 'scenario=flow'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?' + query);
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  // The first paint fits the diagram before it is revealed; wait for that to settle
  // so a gesture starts from the coordinates the page keeps.
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
}

async function unlock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
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

/** The id of the connection drawn at one edge index. */
async function connectionMarkId(page: Page, index: number): Promise<string> {
  const id = await page.locator('.kb-flow-edge-group').nth(index).getAttribute('data-connection-id');
  if (id === null) throw new Error('the diagram draws no connection at ' + index);
  return id;
}

/** The centre of a rendered route segment, in diagram coordinates. */
async function segmentLine(page: Page, index: number, axis: 'x' | 'y'): Promise<number | null> {
  const id = await connectionMarkId(page, index);
  const value = await page.locator('[data-connection-mark="' + id + '"] .kb-flow-grip[data-axis="' + axis + '"]').first()
    .getAttribute('data-' + axis).catch(() => null);
  return value === null ? null : Number(value);
}

/** Zooms with the wheel until the diagram stops changing in that direction. */
async function zoomToBound(page: Page, direction: 'in' | 'out'): Promise<void> {
  let previous = scaleOf(await viewportStyle(page));
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, direction === 'in' ? -220 : 220);
    await page.waitForTimeout(60);
    const next = scaleOf(await viewportStyle(page));
    if (next === previous) return;
    previous = next;
  }
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

/** Accepts the restricted-move confirmation the diagram asks for. */
async function confirmOverride(page: Page): Promise<void> {
  const dialog = page.locator('.kb-transition-dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: 'Move anyway' }).click();
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

/** Records whether a transit and an arrival pulse were ever presented. */
async function watchMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as HarnessWindow;
    scope.__transitSeen = false;
    scope.__arrivalSeen = false;
    const note = () => {
      if (document.querySelector('.kb-flow-transit') !== null) scope.__transitSeen = true;
      if (document.querySelector('.kb-card-arrival') !== null) scope.__arrivalSeen = true;
    };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true });
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

test('drags a card between stages, presents a transit, and opens the drawer', async ({ page }) => {
  await openFlow(page);
  await watchMotion(page);
  await dropCard(page, 'Long column task 0', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  const moves = (await commands(page)).filter(command => command.type === 'task.move');
  expect(moves[0]?.columnId).toBe('propose');
  await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__transitSeen === true)).toBe(true);
  await expect(page.locator('.kb-flow-stage', { hasText: 'Propose' }).locator('.kb-card', { hasText: 'Long column task 0' })).toBeVisible();
  // The card is presented once, in the destination, and the transit is its only other trace.
  await expect(page.locator('[data-task-id]', { hasText: 'Long column task 0' })).toHaveCount(1);
  await expect(page.locator('.kb-flow-travel-card')).toHaveCount(0);
  // A click right after a drop is suppressed so a drag never opens a card; wait it out.
  await page.waitForTimeout(250);
  await page.locator('.kb-flow-stage', { hasText: 'Propose' }).getByRole('button', { name: 'Open task Long column task 0' }).click();
  await expect(page.getByRole('heading', { name: 'Long column task 0', level: 2 })).toBeVisible();
});

test('settles a stage change without transit or pulse under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFlow(page);
  await watchMotion(page);
  await dropCard(page, 'Long column task 1', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__transitSeen === true)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__arrivalSeen === true)).toBe(false);
});

test('presents the transit on a solid authored connection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=flow-restricted&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);
  await expect(page.locator('.kb-flow-edge.is-explicit')).toHaveCount(1);
  // Freeze the particles so the transit can be photographed mid-flight.
  await page.addStyleTag({ content: '.kb-flow-transit-particle{animation-play-state:paused !important}' });
  await watchMotion(page);
  await dropCard(page, 'Long column task 0', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForFunction(() => (window as unknown as HarnessWindow).__transitSeen === true);
  const transit = page.locator('.kb-flow-transit');
  await expect(transit).toHaveCount(1);
  await expect(transit).toHaveAttribute('data-transit-from', 'explore');
  await expect(transit).toHaveAttribute('data-transit-to', 'propose');
  // Halfway along the drawn path, where the particle and its trail are apart.
  const positioned = await page.evaluate(() => {
    const particles = [...document.querySelectorAll<HTMLElement>('.kb-flow-transit-particle')];
    let placed = 0;
    for (const particle of particles) {
      const animation = particle.getAnimations()[0];
      if (animation === undefined) continue;
      const duration = Number(animation.effect?.getTiming().duration ?? 0);
      animation.currentTime = duration * 0.55;
      placed += 1;
    }
    return placed;
  });
  expect(positioned).toBeGreaterThan(1);
  await shoot(page, 'workflow-transit-light.png');
  const box = await page.locator('.kb-flow-transit-particle.is-core').boundingBox();
  expect(box).not.toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await shoot(page, 'workflow-transit-dark.png');
  // A working zoom, where a card's text is legible and the particle must not dwarf it.
  await page.mouse.move(640, 450);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);
  await shoot(page, 'workflow-transit-zoom.png');
});

test('presents only the arrival pulse, and no transit, without a drawn connection', async ({ page }) => {
  await openFlow(page, 'scenario=flow&theme=host');
  const before = await commands(page);
  // Freeze the pulse so the documented arrival signal can be photographed and measured.
  await page.addStyleTag({ content: '.kb-card-arrival{animation-play-state:paused !important}' });
  await watchMotion(page);
  await dropCard(page, 'Long column task 0', 'Apply');
  await confirmOverride(page);
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForFunction(() => (window as unknown as HarnessWindow).__arrivalSeen === true);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).__transitSeen === true)).toBe(false);
  const pulse = page.locator('.kb-flow-stage', { hasText: 'Apply' }).locator('.kb-card-arrival');
  await expect(pulse).toHaveCount(1);
  const card = page.locator('.kb-flow-stage', { hasText: 'Apply' }).locator('.kb-card', { hasText: 'Long column task 0' });
  await expect(card).toBeVisible();
  const duringPulse = (await card.boundingBox())!;
  const extents = () => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    shellWidth: document.querySelector('.kb-flow-shell')?.scrollWidth ?? 0,
    shellHeight: document.querySelector('.kb-flow-shell')?.scrollHeight ?? 0,
    canvasWidth: document.querySelector('.kb-flow-canvas')?.scrollWidth ?? 0,
    canvasHeight: document.querySelector('.kb-flow-canvas')?.scrollHeight ?? 0,
  }));
  const canvasDuring = await extents();
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('.kb-card-arrival')) {
      const animation = element.getAnimations()[0];
      if (animation !== undefined) animation.currentTime = 150;
    }
  });
  await shoot(page, 'workflow-arrival-pulse.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await shoot(page, 'workflow-arrival-pulse-dark.png');
  // The pulse is a painting over the card, so its presence changes neither the card's
  // box nor any scrollable area, and it sends nothing.
  await page.evaluate(() => { for (const element of document.querySelectorAll('style')) if (element.textContent?.includes('kb-card-arrival{animation-play-state:paused')) element.remove(); });
  await expect(pulse).toHaveCount(0, { timeout: 5000 });
  const withoutPulse = (await card.boundingBox())!;
  expect(duringPulse.width).toBeCloseTo(withoutPulse.width, 1);
  expect(duringPulse.height).toBeCloseTo(withoutPulse.height, 1);
  expect(await extents()).toEqual(canvasDuring);
  expect((await commands(page)).length).toBe(before.length + 1);
  expect((await commands(page))[before.length]!.type).toBe('task.move');
});

test('keeps one transit through a re-render of the view', async ({ page }) => {
  await openFlow(page);
  // Freeze the particles so the transit cannot finish while the view re-renders.
  await page.addStyleTag({ content: '.kb-flow-transit-particle{animation-play-state:paused !important}' });
  await dropCard(page, 'Long column task 0', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForFunction(() => document.querySelector('.kb-flow-transit') !== null);
  // Advance the frozen flight, so a restart would visibly rewind it.
  await page.evaluate(() => {
    for (const particle of document.querySelectorAll<HTMLElement>('.kb-flow-transit-particle')) {
      const animation = particle.getAnimations()[0];
      if (animation !== undefined) animation.currentTime = 140;
    }
  });
  await page.evaluate(() => {
    const scope = window as unknown as { __transitProbe?: { node: Element; animation: Animation | null; time: number } };
    const node = document.querySelector('.kb-flow-transit')!;
    const particle = node.querySelector('.kb-flow-transit-particle');
    const animation = particle === null ? null : particle.getAnimations()[0] ?? null;
    scope.__transitProbe = { node, animation, time: Number(animation?.currentTime ?? 0) };
  });
  // The card keeps working while the flight is held active.
  const interaction = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-task-id]')!;
    // The card's own activation control is its keyboard entry point.
    const open = card.querySelector<HTMLElement>('.kb-card-open')!;
    open.focus();
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { focused: document.activeElement === open, hitIsCard: hit !== null && hit.closest('[data-task-id]') === card };
  });
  expect(interaction.focused).toBe(true);
  expect(interaction.hitIsCard).toBe(true);
  // A view re-render: the layout lock changes state but no board card and no stage change.
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const scope = window as unknown as { __transitProbe: { node: Element; animation: Animation | null; time: number } };
    const node = document.querySelector('.kb-flow-transit');
    const particle = node === null ? null : node.querySelector('.kb-flow-transit-particle');
    const animation = particle === null ? null : particle.getAnimations()[0] ?? null;
    return {
      count: document.querySelectorAll('.kb-flow-transit').length,
      sameNode: node === scope.__transitProbe.node,
      sameAnimation: animation === scope.__transitProbe.animation,
      animations: particle === null ? 0 : particle.getAnimations().length,
      time: Number(animation?.currentTime ?? 0),
      before: scope.__transitProbe.time,
    };
  });
  expect(after.count).toBe(1);
  expect(after.sameNode).toBe(true);
  expect(after.sameAnimation).toBe(true);
  expect(after.animations).toBe(1);
  // The flight continued from where it was: it was never cancelled and replayed.
  expect(after.time).toBeGreaterThanOrEqual(after.before);
});

test('settles a running transit when the motion preference changes mid-flight', async ({ page }) => {
  await openFlow(page);
  // Freeze the particles: only the preference change can settle this flight.
  await page.addStyleTag({ content: '.kb-flow-transit-particle{animation-play-state:paused !important}' });
  await dropCard(page, 'Long column task 0', 'Propose');
  await expect.poll(async () => (await commands(page)).filter(command => command.type === 'task.move').length).toBe(1);
  await page.waitForFunction(() => document.querySelector('.kb-flow-transit') !== null);
  await expect(page.locator('.kb-flow-transit')).toHaveCount(1);
  // The host preference changes with no board update and no other render.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('.kb-flow-transit').count(), { timeout: 5000 }).toBe(0);
  // Restoring the preference does not replay the settled flight.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(400);
  expect(await page.locator('.kb-flow-transit').count()).toBe(0);
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

test('presents the connection marks above the stage regions on hover', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const id = await connectionMarkId(page, 0);
  const marks = page.locator('[data-connection-mark="' + id + '"]');
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  await revealEdge(page, 0);
  await expect(marks).toHaveAttribute('data-active', 'true');
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  // The visible mark sits above the stage: the point at the handle's centre belongs
  // to the handle, not to the stage boundary or the arrowhead under it.
  const handle = marks.locator('.kb-flow-handle[data-end="source"]');
  const box = (await handle.boundingBox())!;
  const hit = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('.kb-flow-handle') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBe(true);
  await shoot(page, 'connection-marks-hover.png');
  // Crossing from the line onto the handle keeps the marks presented through the
  // hover linger instead of clearing them for one frame.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(120);
  await expect(marks).toHaveAttribute('data-active', 'true');
});

test('selects a connection from a press on a segment grip', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const id = await connectionMarkId(page, 0);
  await revealEdge(page, 0);
  const grip = page.locator('[data-connection-mark="' + id + '"] .kb-flow-grip').first();
  const box = (await grip.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await page.waitForTimeout(600);
  expect(await workflowSaves(page)).toHaveLength(0);
});

test('keeps the marks of a selected connection and clears them on a press elsewhere', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const id = await connectionMarkId(page, 0);
  await revealEdge(page, 0);
  const handle = page.locator('[data-connection-mark="' + id + '"] .kb-flow-handle[data-end="source"]');
  const box = (await handle.boundingBox())!;
  // A press that never moves selects the connection and starts no adjustment.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await shoot(page, 'connection-marks-selected.png');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.waitForTimeout(250);
  await expect(page.locator('[data-connection-mark="' + id + '"]')).toHaveAttribute('data-active', 'true');
  const stage = page.getByRole('region', { name: 'Apply stage' });
  const stageBox = (await stage.boundingBox())!;
  // The stage header is a press target that clears the selection without opening a
  // card or starting a layout change.
  await page.mouse.click(stageBox.x + 12, stageBox.y + 10);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(0);
  await expect(page.locator('[data-connection-mark="' + id + '"]')).not.toHaveAttribute('data-active', 'true');
  expect(await commands(page)).toHaveLength(0);
});

test('reads a locked connection without presenting a mark', async ({ page }) => {
  await openFlow(page);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-mode', 'inspect');
  const id = await connectionMarkId(page, 0);
  const marks = page.locator('[data-connection-mark="' + id + '"]');
  // Pointing at a locked arrow strengthens its stroke and reveals no mark.
  await revealEdge(page, 0);
  await expect(marks).not.toHaveAttribute('data-active', 'true');
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  const hoveredWidth = await page.locator('.kb-flow-edge-group[data-connection-id="' + id + '"] .kb-flow-edge')
    .evaluate(element => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(hoveredWidth).toBeGreaterThan(1.6);
  // Pressing selects it for reading and copies its route above the stage regions.
  await pressEdge(page, 0);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await expect(marks).not.toHaveAttribute('data-active', 'true');
  const route = page.locator('.kb-flow-selected-route');
  await expect(route).toHaveCount(1);
  const drawn = await page.locator('.kb-flow-edge-group[data-connection-id="' + id + '"] .kb-flow-edge').getAttribute('d');
  await expect(route.locator('.kb-flow-selected-route-path')).toHaveAttribute('d', drawn!);
  const paint = await page.evaluate(() => {
    const svg = document.querySelector('.kb-flow-selected-route');
    const marks = document.querySelector('.kb-flow-affordances');
    const node = document.querySelector('.react-flow__node');
    const path = document.querySelector<SVGPathElement>('.kb-flow-selected-route-path');
    if (svg === null || marks === null || node === null || path === null) return null;
    const matrix = path.getScreenCTM();
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = matrix === null ? null : new DOMPoint(middle.x, middle.y).matrixTransform(matrix);
    const hit = screen === null ? null : document.elementFromPoint(screen.x, screen.y);
    return {
      route: Number(getComputedStyle(svg).zIndex) || 0,
      marks: Number(getComputedStyle(marks).zIndex) || 0,
      node: Number(getComputedStyle(node).zIndex) || 0,
      pointerEvents: getComputedStyle(path).pointerEvents,
      covered: hit !== null && hit.closest('.kb-flow-selected-route') !== null,
    };
  });
  expect(paint).not.toBeNull();
  expect(paint!.route).toBeGreaterThan(paint!.node);
  expect(paint!.route).toBeLessThan(paint!.marks);
  expect(paint!.pointerEvents).toBe('none');
  expect(paint!.covered).toBe(false);
  await shoot(page, 'connection-locked-inspection.png');
  const routeBox = (await route.locator('.kb-flow-selected-route-path').boundingBox())!;
  const clip = {
    x: Math.max(0, routeBox.x - 40),
    y: Math.max(0, routeBox.y - 40),
    width: Math.min(1280, routeBox.width + 80),
    height: Math.min(900, routeBox.height + 80),
  };
  await page.screenshot({ path: path.join(OUT, 'connection-locked-route.png'), clip });
  // The keyboard reads a connection too: focusing an end selects its arrow, still
  // reveals no mark, and leaves no invisible pointer target behind.
  const other = await connectionMarkId(page, 1);
  const otherEnd = page.locator('[data-connection-mark="' + other + '"] .kb-flow-handle[data-end="target"]');
  await otherEnd.focus();
  await expect(page.locator('[data-connection-mark="' + other + '"]')).not.toHaveAttribute('data-active', 'true');
  await expect(page.locator('.kb-flow-edge-group[data-connection-id="' + other + '"]')).toHaveClass(/is-selected/);
  const focused = await otherEnd.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { pointerEvents: getComputedStyle(element).pointerEvents, hit: hit !== null && hit.closest('.kb-flow-handle') !== null };
  });
  expect(focused.pointerEvents).toBe('none');
  expect(focused.hit).toBe(false);
  // Return to the first connection, then unlock without changing the view: the same
  // connection at the same zoom shows its editable marks, so the pair of prints is a
  // direct before/after comparison.
  await page.locator('[data-connection-mark="' + id + '"] .kb-flow-handle[data-end="target"]').focus();
  await expect(page.locator('.kb-flow-edge-group[data-connection-id="' + id + '"]')).toHaveClass(/is-selected/);
  await unlock(page);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-mode', 'edit');
  await expect(marks).toHaveAttribute('data-active', 'true');
  // The marks fade in over a short transition; wait for the fade to settle so the
  // capture shows them instead of a half-transparent frame.
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await shoot(page, 'connection-inspection-unlocked.png');
  await page.screenshot({ path: path.join(OUT, 'connection-unlocked-route.png'), clip });
  // The copy keeps the drawn path at both zoom bounds.
  const alignment = async () => {
    const boxes = await page.evaluate(connectionId => {
      const routeBox = document.querySelector('.kb-flow-selected-route-path')!.getBoundingClientRect();
      const edgeBox = document.querySelector('.kb-flow-edge-group[data-connection-id="' + connectionId + '"] .kb-flow-edge')!.getBoundingClientRect();
      return {
        route: { x: routeBox.x, y: routeBox.y, width: routeBox.width, height: routeBox.height },
        edge: { x: edgeBox.x, y: edgeBox.y, width: edgeBox.width, height: edgeBox.height },
      };
    }, id);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(boxes.route[key] - boxes.edge[key])).toBeLessThan(1.5);
  };
  await page.mouse.move(640, 450);
  await zoomToBound(page, 'in');
  await alignment();
  await zoomToBound(page, 'out');
  await alignment();
  // A press on a control keeps the inspection; a press on a stage clears it, and
  // the copy leaves with the selection.
  await page.getByRole('button', { name: 'Fit to view' }).click({ force: true });
  await page.waitForTimeout(250);
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(1);
  const applyBox = (await page.getByRole('region', { name: 'Apply stage' }).boundingBox())!;
  await page.mouse.click(applyBox.x + 12, applyBox.y + 10);
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(0);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(0);
});

test('presents a selected route above the stage it crosses, in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-crossing&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-mode', 'inspect');
  await page.waitForTimeout(300);
  await pressEdge(page, 0);
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(1);
  // An interior sample of the presented route lies inside the stage the drawn edge
  // crosses, away from either end. The fixture places that stage between the two
  // connected stages, so this is the occlusion the copy exists for.
  const crossingPoint = async () => page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>('.kb-flow-selected-route-path');
    if (path === null) return null;
    const matrix = path.getScreenCTM();
    if (matrix === null) return null;
    const stages = [...document.querySelectorAll('.kb-flow-stage')].map(stage => ({ id: stage.getAttribute('data-column-id'), rect: stage.getBoundingClientRect() }));
    const total = path.getTotalLength();
    for (let step = 20; step <= 180; step += 1) {
      const local = path.getPointAtLength((total * step) / 200);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      for (const stage of stages) {
        const { rect } = stage;
        if (screen.x > rect.left + 8 && screen.x < rect.right - 8 && screen.y > rect.top + 8 && screen.y < rect.bottom - 8) return { x: screen.x, y: screen.y, stage: stage.id };
      }
    }
    return null;
  });
  const crossing = await crossingPoint();
  expect(crossing).not.toBeNull();
  await page.screenshot({ path: path.join(OUT, 'connection-route-over-stage-light.png') });
  // The copy carries the selected paint and the implicit dash, with its arrowhead,
  // and paints above the stage node it crosses.
  const parity = await page.evaluate(() => {
    const route = document.querySelector<SVGPathElement>('.kb-flow-selected-route-path');
    const base = document.querySelector<SVGPathElement>('.kb-flow-edge-group.is-selected .kb-flow-edge');
    const svg = document.querySelector('.kb-flow-selected-route');
    const node = document.querySelector('.react-flow__node');
    if (route === null || base === null || svg === null || node === null) return null;
    const routeStyle = getComputedStyle(route);
    const baseStyle = getComputedStyle(base);
    return {
      sameStroke: routeStyle.stroke === baseStyle.stroke && routeStyle.strokeWidth === baseStyle.strokeWidth,
      sameDash: routeStyle.strokeDasharray === baseStyle.strokeDasharray,
      dash: routeStyle.strokeDasharray,
      arrow: document.querySelectorAll('.kb-flow-selected-route-arrow').length,
      aboveNode: (Number(getComputedStyle(svg).zIndex) || 0) > (Number(getComputedStyle(node).zIndex) || 0),
    };
  });
  expect(parity).not.toBeNull();
  expect(parity!.sameStroke).toBe(true);
  expect(parity!.sameDash).toBe(true);
  expect(parity!.dash).not.toBe('none');
  expect(parity!.arrow).toBe(1);
  expect(parity!.aboveNode).toBe(true);
  // A press through the copy reaches the stage below and clears the inspection.
  const through = await page.evaluate(point => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && hit.closest('.kb-flow-stage') !== null && hit.closest('.kb-flow-selected-route') === null;
  }, crossing!);
  expect(through).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await page.waitForTimeout(300);
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(1);
  await page.screenshot({ path: path.join(OUT, 'connection-route-over-stage-dark.png') });
  const darkParity = await page.evaluate(() => {
    const route = document.querySelector<SVGPathElement>('.kb-flow-selected-route-path');
    const base = document.querySelector<SVGPathElement>('.kb-flow-edge-group.is-selected .kb-flow-edge');
    if (route === null || base === null) return null;
    return { stroke: getComputedStyle(route).stroke, width: getComputedStyle(route).strokeWidth, base: getComputedStyle(base).stroke };
  });
  expect(darkParity).not.toBeNull();
  expect(darkParity!.stroke).toBe(darkParity!.base);
  await page.mouse.click(crossing!.x, crossing!.y);
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(0);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(0);
});

test('forgets a hover that ends while the layout is locked', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const id = await connectionMarkId(page, 0);
  const marks = page.locator('[data-connection-mark="' + id + '"]');
  await revealEdge(page, 0);
  await expect(marks).toHaveAttribute('data-active', 'true');
  // Lock from the keyboard so the pointer never leaves the line; while locked the
  // line reports no leave, so the editable surface must forget the hover itself.
  await page.getByRole('button', { name: 'Lock layout editing', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.mouse.move(8, 8);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await expect(marks).not.toHaveAttribute('data-active', 'true');
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
});

test('keeps a connection handle reachable at both zoom bounds', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const id = await connectionMarkId(page, 0);
  const handle = page.locator('[data-connection-mark="' + id + '"] .kb-flow-handle[data-end="source"]');
  async function assertReachable(): Promise<void> {
    await revealEdge(page, 0);
    const box = (await handle.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(23.5);
    // The visible mark is counter-scaled with its border, shadow, and focus ring,
    // so it keeps the same rendered size at every zoom level.
    const dot = (await handle.locator('.kb-flow-handle-dot').boundingBox())!;
    expect(Math.min(dot.width, dot.height)).toBeGreaterThanOrEqual(11.5);
    const hit = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('.kb-flow-handle') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit).toBe(true);
  }
  await assertReachable();
  await zoomToBound(page, 'in');
  await assertReachable();
  await shoot(page, 'connection-handle-zoom-max.png');
  await zoomToBound(page, 'out');
  await assertReachable();
  await shoot(page, 'connection-handle-zoom-min.png');
  await page.getByRole('button', { name: 'Fit to view' }).click({ force: true });
  await page.waitForTimeout(250);
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
  // The connection handles and the control stack follow the stage content in the
  // diagram's tab order; the point is that focus keeps moving and can leave.
  for (let index = 0; index < 60 && inside; index += 1) {
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

/** Pointing at a locked arrow strengthens its stroke in the current appearance. */
async function expectHoverEmphasis(page: Page): Promise<void> {
  const edge = page.locator('.kb-flow-edge-group .kb-flow-edge').first();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(120);
  const resting = await edge.evaluate(element => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(resting).toBeCloseTo(1.6, 1);
  await revealEdge(page, 0);
  const hovered = await edge.evaluate(element => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(hovered).toBeGreaterThan(resting);
  // A stroke is a non-text surface: the emphasized line must stay visible against
  // the diagram in the current appearance.
  expect(await strokeContrastOf(page, '.kb-flow-edge-group .kb-flow-edge')).toBeGreaterThanOrEqual(3);
}

test('captures the diagram in both host appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
  await expectHoverEmphasis(page);
  await page.screenshot({ path: '.verification/workflow-diagram-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await page.waitForTimeout(300);
  await expectHoverEmphasis(page);
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
  await expect(page.getByRole('button', { name: 'Unlock layout editing', exact: true })).toBeVisible();
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
  const id = await connectionMarkId(page, index);
  return page.locator('[data-connection-mark="' + id + '"] .kb-flow-handle[data-end="' + end + '"]');
}

/** A client point the edge's interaction path owns. */
async function edgePoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  // The edge is measured after the first paint, and the hit target may be the
  // visible path under the interaction path. Sample the actual stroke instead of
  // a bounding-box grid, accept any element inside the edge group, and retry
  // while the canvas settles. This is deterministic across font metrics.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const point = await page.evaluate(index => {
      const paths = [...document.querySelectorAll('.react-flow__edge-interaction')];
      const path = paths[index] as SVGPathElement | undefined;
      if (path === undefined) return null;
      const group = path.closest('.react-flow__edge');
      const connectionId = group?.querySelector('.kb-flow-edge-group')?.getAttribute('data-connection-id');
      const matrix = path.getScreenCTM();
      if (matrix === null) return null;
      const total = path.getTotalLength();
      for (let step = 0; step <= 48; step += 1) {
        const local = path.getPointAtLength((total * step) / 48);
        const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
        const element = document.elementFromPoint(screen.x, screen.y);
        if (element === null) continue;
        if (element === path || (group !== null && group.contains(element))) return { x: screen.x, y: screen.y };
        // A mark of this connection may already cover its own line; a mark of
        // another connection is not a valid place to point at this one.
        const mark = element.closest('[data-connection-mark]');
        if (mark !== null && mark.getAttribute('data-connection-mark') === connectionId) return { x: screen.x, y: screen.y };
      }
      return null;
    }, index);
    if (point !== null) return point;
    await page.waitForTimeout(60);
  }
  throw new Error('the edge has no reachable point');
}

/** Points at a place the edge's interaction path owns, revealing its handles. */
async function revealEdge(page: Page, index: number): Promise<void> {
  const point = await edgePoint(page, index);
  await page.mouse.move(point.x, point.y);
}

/** Presses the line of one connection. */
async function pressEdge(page: Page, index: number): Promise<void> {
  const point = await edgePoint(page, index);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(80);
}

/** The screen point of a stage edge, a few pixels outside the stage box. */
async function stageEdge(page: Page, label: string, side: 'top' | 'bottom'): Promise<{ x: number; y: number }> {
  const box = (await page.getByRole('region', { name: label + ' stage' }).boundingBox())!;
  return { x: box.x + box.width / 2, y: side === 'top' ? box.y - 8 : box.y + box.height + 8 };
}

async function dragHandle(page: Page, handle: ReturnType<typeof connectionEnd>, target: { x: number; y: number }): Promise<void> {
  const box = (await (await handle).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
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

test('presents no mark and adjusts nothing while the diagram is locked', async ({ page }) => {
  await openFlow(page);
  const id = await connectionMarkId(page, 0);
  const marks = page.locator('[data-connection-mark="' + id + '"]');
  await revealEdge(page, 0);
  await expect(marks).not.toHaveAttribute('data-active', 'true');
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  await shoot(page, 'connection-locked-no-marks.png');
  // The handle positions stay in the document for the keyboard, but pressing one
  // falls through instead of starting an adjustment.
  await dragHandle(page, connectionEnd(page, 0, 'target'), await stageEdge(page, 'Propose', 'bottom'));
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
  expect(await page.locator('.kb-flow-edge-group').count()).toBe(2);
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
  await revealEdge(page, 0);
  const segment = page.locator('[data-connection-mark="' + await connectionMarkId(page, 0) + '"] .kb-flow-grip[data-axis="x"]').first();
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
  await revealEdge(page, 0);
  const moved = page.locator('[data-connection-mark="' + await connectionMarkId(page, 0) + '"] .kb-flow-grip[data-axis="x"]').first();
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
  const handle = async () => page.locator('[data-connection-mark="' + await connectionMarkId(page, 0) + '"] .kb-flow-grip[data-axis="x"]').first();
  await revealEdge(page, 0);
  const first = (await (await handle()).boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 37, first.y + first.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  // The settled line is a lattice point, so a gesture that returns the segment to
  // it settles exactly where it started and must store nothing.
  await revealEdge(page, 0);
  const settled = (await (await handle()).boundingBox())!;
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height / 2);
  await page.mouse.down();
  await page.mouse.move(settled.x + settled.width / 2 + 37, settled.y + settled.height / 2, { steps: 6 });
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(await workflowSaves(page)).toHaveLength(1);
});

test('starts an adjustment from a press on the target handle under the arrowhead', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await revealEdge(page, 0);
  // The target handle sits where the arrowhead paints; the layer keeps it reachable.
  await dragHandle(page, connectionEnd(page, 0, 'target'), await stageEdge(page, 'Propose', 'bottom'));
  await expect.poll(async () => (await workflowSaves(page)).length).toBe(1);
  expect((await workflowSaves(page))[0]!.yaml).toContain('target: {side: bottom, at: 2}');
});

test('marks the candidate destination while an end is dragged over another stage', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await revealEdge(page, 0);
  const handle = await connectionEnd(page, 0, 'target');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const apply = (await page.getByRole('region', { name: 'Apply stage' }).boundingBox())!;
  await page.mouse.move(apply.x + apply.width / 2, apply.y + apply.height / 2, { steps: 10 });
  await expect(page.locator('.kb-flow-stage[data-column-id="apply"][data-connect-candidate="true"]')).toHaveCount(1);
  await shoot(page, 'connection-candidate.png');
  const empty = await page.evaluate(() => {
    const canvas = document.querySelector('.kb-flow-canvas');
    if (canvas === null) return null;
    const area = canvas.getBoundingClientRect();
    for (let x = area.left + 40; x <= area.right - 40; x += 20) {
      for (let y = area.top + 40; y <= area.bottom - 40; y += 20) {
        const element = document.elementFromPoint(x, y);
        if (element === null) continue;
        if (element.closest('[data-column-id], .react-flow__minimap, .kb-flow-controls, .react-flow__panel') !== null) continue;
        return { x, y };
      }
    }
    return null;
  });
  expect(empty).not.toBeNull();
  await page.mouse.move(empty!.x, empty!.y, { steps: 10 });
  await expect(page.locator('.kb-flow-stage[data-connect-candidate="true"]')).toHaveCount(0);
  // Escape returns the connection to the layout it had; nothing is stored.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(250);
  await expect(page.locator('.kb-flow-stage[data-connect-candidate="true"]')).toHaveCount(0);
  expect(await workflowSaves(page)).toHaveLength(0);
});

test('captures the connection marks in both host appearances', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=flow&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await page.waitForTimeout(300);
  await unlock(page);
  const marks = page.locator('[data-connection-mark="' + await connectionMarkId(page, 0) + '"]');
  await revealEdge(page, 0);
  // The marks fade in; capture only once the presentation has settled.
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await shoot(page, 'connection-marks-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await revealEdge(page, 0);
  await expect.poll(() => marks.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await shoot(page, 'connection-marks-dark.png');
});
