import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface HarnessCommand { type: string; stageId?: string; patch?: Record<string, unknown>; yaml?: string; [key: string]: unknown }
type HarnessWindow = { __harness: { commands(): HarnessCommand[] } };

async function openFlow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(HARNESS + '?scenario=flow&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
}

/** The flow with stored stage placements, so a structural edit cannot re-lay it out. */
async function openPlacedFlow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(HARNESS + '?scenario=flow-placed&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.getByRole('region', { name: 'Workflow diagram' })).toBeVisible();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
}

async function unlock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
}

function commands(page: Page): Promise<HarnessCommand[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
}

async function stageCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator('.kb-flow-stage[data-column-id="' + id + '"]').boundingBox();
  if (box === null) throw new Error('stage ' + id + ' is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + (to.x - from.x) * (step / 8), from.y + (to.y - from.y) * (step / 8));
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** A client point that actually belongs to a drawn connection, since an SVG group's
 *  bounding box is mostly empty space. */
async function edgePoint(page: Page, connectionId: string): Promise<{ x: number; y: number } | null> {
  const handle = await page.waitForFunction(id => {
    const group = document.querySelector('[data-connection-id="' + id + '"]');
    if (group === null) return null;
    const path = group.querySelector('.react-flow__edge-interaction') ?? group.querySelector('.kb-flow-edge');
    if (path === null) return null;
    const box = path.getBoundingClientRect();
    // SVG bounds exclude the stroke and can have zero height or width for straight paths.
    for (let x = Math.ceil(box.left - 4); x <= Math.floor(box.right + 4); x += 2) {
      for (let y = Math.ceil(box.top - 4); y <= Math.floor(box.bottom + 4); y += 2) {
        const hit = document.elementFromPoint(x, y);
        if (hit !== null && hit.closest('[data-connection-id]') === group) return { x, y };
      }
    }
    return null;
  }, connectionId);
  return (await handle.jsonValue()) as { x: number; y: number } | null;
}

/**
 * A client point on the line itself. Pointing at the line reveals its marks, so a
 * second pass picks a point the affordance layer does not cover; otherwise a press
 * there would land on a handle or a grip instead of the line.
 */
async function pointOnEdge(page: Page, connectionId: string): Promise<{ x: number; y: number }> {
  const first = await edgePoint(page, connectionId);
  if (first === null) throw new Error('the connection has no reachable point');
  await page.mouse.move(first.x, first.y);
  await page.waitForTimeout(90);
  const clear = await edgePoint(page, connectionId);
  return clear ?? first;
}

async function pressEdge(page: Page, connectionId: string): Promise<void> {
  const point = await pointOnEdge(page, connectionId);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(80);
}

async function doublePressEdge(page: Page, connectionId: string): Promise<void> {
  const point = await pointOnEdge(page, connectionId);
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(120);
}

async function hoverEdge(page: Page, connectionId: string): Promise<void> {
  const point = await pointOnEdge(page, connectionId);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(80);
}

/**
 * Where to press a connection end: the centre of its handle. The handle lives in
 * the affordance layer above the stages, so no part of it is covered by the stage
 * boundary or by the arrowhead.
 */
async function endPressPoint(page: Page, connectionId: string, end: 'source' | 'target'): Promise<{ x: number; y: number }> {
  await hoverEdge(page, connectionId);
  const box = (await page.locator('[data-connection-mark="' + connectionId + '"] .kb-flow-handle[data-end="' + end + '"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A client point on the diagram that no stage, control, or minimap owns. */
async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const canvas = (await page.locator('.kb-flow-canvas').boundingBox())!;
  const point = await page.evaluate(area => {
    for (let x = area.x + 40; x <= area.x + area.width - 40; x += 20) {
      for (let y = area.y + 40; y <= area.y + area.height - 40; y += 20) {
        const element = document.elementFromPoint(x, y);
        if (element === null) continue;
        if (element.closest('[data-column-id], .react-flow__minimap, .kb-flow-controls, .react-flow__panel') !== null) continue;
        return { x, y };
      }
    }
    return null;
  }, canvas);
  if (point === null) throw new Error('the diagram has no empty point');
  return point;
}

/** Draw a connection from one stage's port onto another stage. */
async function drawConnection(page: Page, from: string, to: string): Promise<void> {
  const stage = page.locator('.kb-flow-stage[data-column-id="' + from + '"]');
  await stage.hover();
  const port = await page.locator('.kb-flow-port[data-side="right"]').boundingBox();
  if (port === null) throw new Error('stage ' + from + ' presents no right-hand connection port');
  await drag(page, { x: port.x + port.width / 2, y: port.y + port.height / 2 }, await stageCentre(page, to));
}

async function shoot(page: Page, name: string): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

test('draws a connection from a stage port onto another stage', async ({ page }) => {
  await openFlow(page);
  expect(await page.locator('.kb-flow-port').count()).toBe(0);
  expect(await page.locator('.react-flow__edge').count()).toBe(2);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  const sent = await commands(page);
  const created = sent.find(command => command.type === 'board.stage.update');
  expect(created?.stageId).toBe('explore');
  expect(created?.patch).toMatchObject({ allowedTransitions: [{ to: 'apply' }] });
  // The drawn connection is presented immediately, drawing exactly two solid arrows
  // and no dashed default path from the stage that now permits one destination.
  await expect(page.locator('.kb-flow-edge-group')).toHaveCount(2);
  await shoot(page, 'connections-created.png');
});

test('draws nothing onto the same stage', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const stage = page.locator('.kb-flow-stage[data-column-id="explore"]');
  await stage.hover();
  const port = await page.locator('.kb-flow-port[data-side="right"]').boundingBox();
  if (port === null) throw new Error('no right-hand port');
  // Release inside the stage the port belongs to, which is the same-stage drop.
  await drag(page, { x: port.x + port.width / 2, y: port.y + port.height / 2 }, await stageCentre(page, 'explore'));
  expect(await commands(page)).toEqual([]);
});

test('re-points a connection released over another stage', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  // Two connections can arrive at the same stage edge, and the handle on top belongs
  // to the one drawn last; the dashed default path is that one here.
  await drag(page, await endPressPoint(page, 'propose->apply:0', 'target'), await stageCentre(page, 'explore'));
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  expect(updates.at(-1)?.stageId).toBe('propose');
  expect(updates.at(-1)?.patch).toMatchObject({ allowedTransitions: [{ to: 'explore' }] });
  await expect(page.locator('[data-connection-id^="propose->explore"]')).toHaveCount(1);
});

test('edits a condition through the editor anchored to the connection', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await doublePressEdge(page, 'explore->apply:0');
  const editor = page.getByRole('dialog', { name: /Condition from Explore to Apply/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Transition condition' }).fill('when the plan is approved');
  await shoot(page, 'connections-condition.png');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  expect(updates.at(-1)?.patch).toMatchObject({ transitionCondition: { to: 'apply', when: 'when the plan is approved' } });
  // A connection that authors a condition no longer presents the mark for a missing one.
  await expect(page.locator('[data-connection-id="explore->apply:0"] .kb-flow-condition-mark')).toHaveCount(0);
});

test('marks a connection that authors no condition', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await expect(page.locator('[data-connection-id="explore->apply:0"] .kb-flow-condition-mark')).toHaveCount(1);
  // Close-up evidence: the mark has to read at a comfortable zoom, not only at fit level.
  const mark = await page.locator('[data-connection-id="explore->apply:0"] .kb-flow-condition-mark').boundingBox();
  if (mark !== null) {
    await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2);
    for (let step = 0; step < 6; step += 1) { await page.mouse.wheel(0, -160); await page.waitForTimeout(80); }
    await shoot(page, 'connections-mark-closeup.png');
    await page.getByRole('button', { name: 'Fit to view' }).click({ force: true });
    await page.waitForTimeout(300);
  }
  // The dashed default path already reads as unauthored, so it is never marked.
  await expect(page.locator('[data-connection-id="propose->apply:0"] .kb-flow-condition-mark')).toHaveCount(0);
});

test('selects a connection and deletes it with the keyboard', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await pressEdge(page, 'explore->apply:0');
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await page.keyboard.press('Delete');
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  // The stage authored only that destination, so it now permits none at all.
  expect(updates.at(-1)?.patch).toMatchObject({ allowedTransitions: [] });
  await expect(page.locator('[data-connection-id="explore->apply:0"]')).toHaveCount(0);
  await expect(page.locator('[data-column-id="explore"]')).toBeVisible();
});

test('cancels a drawn connection with Escape', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const stage = page.locator('.kb-flow-stage[data-column-id="explore"]');
  await stage.hover();
  const port = await page.locator('.kb-flow-port[data-side="right"]').boundingBox();
  if (port === null) throw new Error('no right-hand port');
  const to = await stageCentre(page, 'apply');
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(await commands(page)).toEqual([]);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('moves the transition owner when the source end is released over another stage', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await drag(page, await endPressPoint(page, 'explore->apply:0', 'source'), await stageCentre(page, 'propose'));
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  const owners = updates.map(command => command.stageId);
  // The receiving stage is authored before the previous one lets the destination go.
  expect(owners.slice(-2)).toEqual(['propose', 'explore']);
  expect(updates.at(-2)?.patch).toMatchObject({ allowedTransitions: [{ to: 'apply' }] });
  expect(updates.at(-1)?.patch).toMatchObject({ allowedTransitions: [] });
  await expect(page.locator('[data-connection-id^="propose->apply"]')).toHaveCount(1);
});

test('authors the default path when its condition is saved and names the condition on its ends', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const dashed = page.locator('[data-connection-id="propose->apply:0"]');
  await expect(page.locator('[data-connection-mark="propose->apply:0"] .kb-flow-handle[data-end="source"]')).toHaveAttribute('aria-label', /without a condition/);
  await doublePressEdge(page, 'propose->apply:0');
  const editor = page.getByRole('dialog', { name: /Condition from Propose to Apply/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Transition condition' }).fill('after the proposal');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  expect(updates.at(-1)?.patch).toMatchObject({ transitionCondition: { to: 'apply', when: 'after the proposal' } });
  await expect(page.locator('[data-connection-mark^="propose->apply"] .kb-flow-handle[data-end="source"]')).toHaveAttribute('aria-label', /with a condition/);
});

test('keeps the condition editor open when the store refuses the write', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(HARNESS + '?scenario=flow-refused&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
  await unlock(page);
  await doublePressEdge(page, 'propose->apply:0');
  const editor = page.getByRole('dialog', { name: /Condition from Propose to Apply/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Transition condition' }).fill('after the proposal');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('alert')).toContainText('The Hub changed while the stage edit was open.');
  await expect(editor.getByRole('textbox', { name: 'Transition condition' })).toHaveValue('after the proposal');
  // The diagram returned to the acknowledged workflow: the dashed default path is back.
  await expect(page.locator('[data-connection-id="propose->apply:0"]')).toHaveCount(1);
  await shoot(page, 'connections-refused.png');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
});

test('discards an open condition editor and its error when the layout is locked', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(HARNESS + '?scenario=flow-refused&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
  await unlock(page);
  await doublePressEdge(page, 'propose->apply:0');
  const editor = page.getByRole('dialog', { name: /Condition from Propose to Apply/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Transition condition' }).fill('after the proposal');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByRole('alert')).toContainText('The Hub changed while the stage edit was open.');
  // Lock from the keyboard so the editor is still open when the mode changes; a
  // pointer press anywhere else would dismiss it before the lock applies.
  await page.getByRole('button', { name: 'Lock layout editing', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kb-condition-popover')).toHaveCount(0);
  await page.waitForTimeout(120);
  // The discarded draft leaves no stale problem behind when the editor reopens.
  await unlock(page);
  await doublePressEdge(page, 'propose->apply:0');
  const reopened = page.getByRole('dialog', { name: /Condition from Propose to Apply/ });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reopened).toBeHidden();
});

test('clears the connection selection when the diagram background is pressed', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await pressEdge(page, 'propose->apply:0');
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  // Inside the diagram's own surface, away from the stages, the control stack, and the minimap.
  const canvas = (await page.locator('.kb-flow-canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width - 60, canvas.y + 40);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(0);
});

test('refuses creation and deletion while the layout is locked but reads a selected arrow', async ({ page }) => {
  await openFlow(page);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-mode', 'inspect');
  await expect(page.locator('.kb-flow-port')).toHaveCount(0);
  await pressEdge(page, 'propose->apply:0');
  // A locked press is reading only: the arrow is selected for its route, with no
  // mark that could change it, and the delete key changes nothing.
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await expect(page.locator('[data-connection-mark="propose->apply:0"]')).not.toHaveAttribute('data-active', 'true');
  await expect(page.locator('.kb-flow-selected-route')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  expect(await commands(page)).toEqual([]);
  await expect(page.locator('.kb-flow-edge-group.is-selected')).toHaveCount(1);
  await shoot(page, 'connections-locked.png');
});

test('keeps a connection without a condition out of reach while the layout is locked', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await page.getByRole('button', { name: 'Lock layout editing', exact: true }).click();
  // Authoring a condition for a connection that has none changes the diagram's structure.
  await expect(page.locator('[data-connection-id="explore->apply:0"] .kb-flow-condition-mark')).toHaveCount(0);
  // The locked diagram does not present a stage edit action.
  const header = page.locator('.kb-flow-stage[data-column-id="explore"] .kb-flow-stage-header');
  await expect(header.getByRole('button', { name: 'Edit stage Explore' })).toHaveCount(0);
  await header.screenshot({ path: path.join(OUT, 'connections-locked-header.png') });
  await doublePressEdge(page, 'explore->apply:0');
  await expect(page.getByRole('dialog', { name: /^Condition from / })).toHaveCount(0);
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  expect(updates).toHaveLength(1);
});

test('refuses an authored condition while the layout is locked', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  await doublePressEdge(page, 'explore->apply:0');
  const first = page.getByRole('dialog', { name: /^Condition from / });
  await first.getByRole('textbox', { name: 'Transition condition' }).fill('before locking');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(first).toBeHidden();
  await page.getByRole('button', { name: 'Lock layout editing', exact: true }).click();
  await page.waitForTimeout(120);
  await doublePressEdge(page, 'explore->apply:0');
  await expect(page.getByRole('dialog', { name: /^Condition from / })).toHaveCount(0);
  // A draft that is open when the lock turns on is discarded, not stored.
  await unlock(page);
  await doublePressEdge(page, 'explore->apply:0');
  const editor = page.getByRole('dialog', { name: /Condition from Explore to Apply/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Transition condition' }).fill('draft that must be discarded');
  // The lock is activated from the keyboard so the editor is still open when the
  // mode changes; a pointer press anywhere else would dismiss it first.
  await page.getByRole('button', { name: 'Lock layout editing', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Condition from Explore to Apply/ })).toHaveCount(0);
  await page.waitForTimeout(120);
  const updates = (await commands(page)).filter(command => command.type === 'board.stage.update');
  expect(updates.at(-1)?.patch).toMatchObject({ transitionCondition: { to: 'apply', when: 'before locking' } });
  expect(JSON.stringify(updates)).not.toContain('draft that must be discarded');
});

test('presents a connection port on each of the four sides', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  // The shortest stage keeps all four ports inside one crop.
  const stage = page.locator('.kb-flow-stage[data-column-id="propose"]');
  // Fit the whole diagram first: a zoomed stage can push its top port outside the
  // canvas viewport, and the evidence must show all four ports.
  await page.getByRole('button', { name: 'Fit to view' }).click({ force: true });
  await page.waitForTimeout(300);
  await stage.hover();
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect(page.locator('.kb-flow-port[data-side="' + side + '"]')).toHaveCount(1);
  }
  await shoot(page, 'connections-four-ports.png');
  const crop = (await stage.boundingBox())!;
  await page.screenshot({ path: path.join(OUT, 'connections-four-ports-closeup.png'), clip: { x: crop.x - 40, y: crop.y - 40, width: crop.width + 80, height: crop.height + 80 } });
});

test('draws a connection that leaves from the side it was drawn from', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const source = page.locator('.kb-flow-stage[data-column-id="explore"]');
  await source.hover();
  const port = await page.locator('.kb-flow-port[data-side="bottom"]').boundingBox();
  if (port === null) throw new Error('no bottom port');
  await drag(page, { x: port.x + port.width / 2, y: port.y + port.height / 2 }, await stageCentre(page, 'apply'));
  const saves = (await commands(page)).filter(command => command.type === 'board.workflow.save');
  expect(saves).toHaveLength(1);
  expect(saves[0]?.yaml).toContain('source: {side: bottom, at: 2}');
  await expect(page.locator('[data-connection-id^="explore->apply"]')).toHaveCount(1);
  await shoot(page, 'connections-bottom-port.png');
});

test('presents the line being drawn and the route over a candidate destination', async ({ page }) => {
  await openPlacedFlow(page);
  await unlock(page);
  const stage = page.locator('.kb-flow-stage[data-column-id="explore"]');
  await stage.hover();
  const port = (await page.locator('.kb-flow-port[data-side="right"]').boundingBox())!;
  const empty = await emptyCanvasPoint(page);
  const to = await stageCentre(page, 'apply');
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(empty.x, empty.y, { steps: 6 });
  // Away from every stage the gesture presents the pointer line, and it stays
  // presented while the drag runs.
  await expect(page.locator('.kb-flow-creation-line')).toHaveCount(1);
  await expect(page.locator('.kb-flow-creation-route')).toHaveCount(0);
  await shoot(page, 'creation-line.png');
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // Over a candidate the gesture presents the route the release would author,
  // including its arrowhead, and marks the destination stage.
  await expect(page.locator('.kb-flow-creation-route')).toHaveCount(1);
  await expect(page.locator('.kb-flow-creation-line')).toHaveCount(0);
  await expect(page.locator('.kb-flow-creation-arrow')).toHaveCount(1);
  await expect(page.locator('.kb-flow-stage[data-column-id="apply"][data-connect-candidate="true"]')).toHaveCount(1);
  await shoot(page, 'creation-route-preview.png');
  const previewPath = await page.locator('.kb-flow-creation-route').getAttribute('d');
  await page.mouse.up();
  await expect(page.locator('.kb-flow-edge-group')).toHaveCount(2);
  await expect(page.locator('.kb-flow-stage[data-connect-candidate="true"]')).toHaveCount(0);
  // The preview is the route the release authors, not an approximation of a single
  // destination: the drawn edge settles on exactly the previewed path.
  const createdPath = await page.locator('.kb-flow-edge-group[data-connection-id="explore->apply:0"] .kb-flow-edge').getAttribute('d');
  expect(createdPath).toBe(previewPath);
});

test('presents no destination for a stage that already authors it', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  await drawConnection(page, 'explore', 'apply');
  const before = (await commands(page)).length;
  const stage = page.locator('.kb-flow-stage[data-column-id="explore"]');
  await stage.hover();
  const port = (await page.locator('.kb-flow-port[data-side="bottom"]').boundingBox())!;
  const to = await stageCentre(page, 'apply');
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // The source already authors Apply, so the release would author nothing: the
  // gesture keeps the plain pointer line and marks no candidate.
  await expect(page.locator('.kb-flow-creation-route')).toHaveCount(0);
  await expect(page.locator('.kb-flow-creation-line')).toHaveCount(1);
  await expect(page.locator('.kb-flow-stage[data-connect-candidate="true"]')).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect((await commands(page)).length).toBe(before);
});

test('offers a connection port with a reachable 24-pixel target on every side', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const stage = page.locator('.kb-flow-stage[data-column-id="propose"]');
  await stage.hover();
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const port = page.locator('.kb-flow-port[data-side="' + side + '"]');
    const box = (await port.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(23.5);
    const hit = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('.kb-flow-port') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit).toBe(true);
  }
});

test('keeps a card pressable while a stage reveals its connection ports', async ({ page }) => {
  await openFlow(page);
  await unlock(page);
  const stage = page.locator('.kb-flow-stage[data-column-id="propose"]');
  await stage.hover();
  await expect(page.locator('.kb-flow-port[data-side="right"]')).toBeVisible();
  const card = stage.locator('.kb-card').first();
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.kb-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.kb-drawer')).toHaveCount(0);
});
