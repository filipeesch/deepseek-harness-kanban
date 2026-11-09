import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

/** Both filter inputs live inside the popover, so a test opens it before using them. */
async function openFilterPopover(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
}

interface HarnessColumn { id: string; name: string }
interface HarnessTask { id: string; columnId: string; position: number; title: string; [key: string]: unknown }
interface HarnessState { hubs: Array<{ tasks: HarnessTask[]; boards: Array<{ workflow: { columns: HarnessColumn[] } }> }> }
type HarnessWindow = { __harness: { mutate(change: (state: unknown) => void): void; commands(): Array<{ type: string }> } };

type HarnessMutation =
  | { kind: 'remove-task'; taskId: string }
  | { kind: 'empty-column'; columnId: string }
  | { kind: 'move-task'; taskId: string; columnId: string }
  | { kind: 'widen-workflow' }
  | { kind: 'add-task' };

/** Applies a host-driven board change, the way a team update or an automatic advance arrives. */
async function mutate(page: Page, change: HarnessMutation): Promise<void> {
  await page.evaluate(input => {
    const harness = (window as unknown as HarnessWindow).__harness;
    harness.mutate(value => {
      const state = value as unknown as HarnessState;
      const hub = state.hubs[0]!;
      if (input.kind === 'remove-task') hub.tasks = hub.tasks.filter(task => task.id !== input.taskId);
      if (input.kind === 'empty-column') hub.tasks = hub.tasks.filter(task => task.columnId !== input.columnId);
      if (input.kind === 'widen-workflow') {
        for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) hub.boards[0]!.workflow.columns.push({ id, name: id.toUpperCase() });
      }
      if (input.kind === 'move-task') {
        const task = hub.tasks.find(value => value.id === input.taskId);
        if (task !== undefined) { task.columnId = input.columnId; task.position = 95; }
      }
      if (input.kind === 'add-task') {
        const template = hub.tasks[0]!;
        hub.tasks.push({ ...template, id: 'synced', title: 'Synced task', columnId: 'apply', position: 90 });
      }
    });
  }, change);
}

function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.kb-card[data-task-id]')).filter(card => card.getAnimations().length > 0).length);
}

function flatTaskIds(page: Page): Promise<Array<string | null>> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.kb-card[data-task-id]')).map(card => card.getAttribute('data-task-id')));
}

async function dragCard(page: Page, title: string, destinationName: string): Promise<void> {
  const card = page.getByRole('button', { name: 'Open task ' + title, exact: true });
  const destination = page.getByRole('region', { name: destinationName });
  const cardBox = (await card.boundingBox())!;
  const columnBox = (await destination.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + columnBox.height - 8, { steps: 15 });
  await page.mouse.up();
}

test('a drop glides the card and the cards that make room for it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const frame = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.kb-header')!.getBoundingClientRect();
    const columns = document.querySelector<HTMLElement>('.kb-columns')!.getBoundingClientRect();
    return { headerHeight: header.height, columnsTop: columns.top };
  });
  await dragCard(page, 'Long column task 0', 'Apply column');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.kb-card')).some(card => card.getAnimations().length > 0));
  const motion = await page.evaluate(() => {
    const moved = document.querySelector<HTMLElement>('[data-task-id="long-0"]');
    const animated = Array.from(document.querySelectorAll<HTMLElement>('.kb-card[data-task-id]')).filter(card => card.getAnimations().length > 0).length;
    return {
      animated,
      gliding: moved?.classList.contains('kb-card-gliding') ?? false,
      transform: moved === null ? 'none' : getComputedStyle(moved).transform,
    };
  });
  expect(motion.animated).toBeGreaterThan(1);
  expect(motion.gliding).toBe(true);
  expect(motion.transform).not.toBe('none');
  const interactive = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-task-id="long-0"]')!;
    const open = card.querySelector<HTMLButtonElement>('.kb-card-open')!;
    open.focus();
    return { pointerEvents: getComputedStyle(card).pointerEvents, disabled: open.disabled, focusable: open.tabIndex >= 0, focused: document.activeElement === open };
  });
  expect(interactive.pointerEvents).not.toBe('none');
  expect(interactive.disabled).toBe(false);
  expect(interactive.focusable).toBe(true);
  expect(interactive.focused).toBe(true);
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Long column task 0', exact: true })).toBeVisible();
  await expect(page.locator('.kb-card.kb-card-gliding')).toHaveCount(0, { timeout: 2000 });
  expect(await runningAnimations(page)).toBe(0);
  const after = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.kb-header')!.getBoundingClientRect();
    const columns = document.querySelector<HTMLElement>('.kb-columns')!.getBoundingClientRect();
    return { headerHeight: header.height, columnsTop: columns.top };
  });
  expect(after.headerHeight).toBe(frame.headerHeight);
  expect(after.columnsTop).toBe(frame.columnsTop);
  const moves = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands().filter(command => command.type === 'task.move'));
  expect(moves).toHaveLength(1);
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close task details' })).toBeVisible();
});

test('a same-stage reorder glides the cards that change position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const card = page.getByRole('button', { name: 'Open task Long column task 0', exact: true });
  const target = page.locator('[data-task-id="long-3"]');
  const cardBox = (await card.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height + 6, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.kb-card')).some(element => element.getAnimations().length > 0));
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-column-id="explore"] [data-task-id]')).map(element => element.getAttribute('data-task-id')));
  expect(order.indexOf('long-0')).toBeGreaterThan(order.indexOf('long-3'));
  const moves = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands().filter(command => command.type === 'task.move'));
  expect(moves).toHaveLength(1);
});

test('a drawer stage change glides the card on the board', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).click();
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('apply');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.kb-card')).some(card => card.getAnimations().length > 0));
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Short task', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close task details' })).toBeVisible();
});

test("a drawer change on a column's last card still glides", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const before = await flatTaskIds(page);
  await page.getByRole('button', { name: 'Open task Delete target', exact: true }).click();
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption('apply');
  await page.waitForFunction(() => {
    const card = document.querySelector<HTMLElement>('[data-task-id="delete-target"]');
    return card !== null && card.getAnimations().length > 0;
  });
  const after = await flatTaskIds(page);
  expect(after).toEqual(before);
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Delete target', exact: true })).toBeVisible();
});

test('a host-driven move glides the card and sends no command', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await mutate(page, { kind: 'move-task', taskId: 'long-1', columnId: 'apply' });
  await page.waitForFunction(() => {
    const card = document.querySelector<HTMLElement>('[data-task-id="long-1"]');
    return card !== null && card.getAnimations().length > 0;
  });
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Long column task 1', exact: true })).toBeVisible();
  const commands = await page.evaluate(() => (window as unknown as HarnessWindow).__harness.commands());
  expect(commands).toHaveLength(0);
});

test('a leaving card fades as an inert copy in the hidden overlay without extending the scroll area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const before = await page.evaluate(() => ({
    width: document.querySelector<HTMLElement>('.kb-columns')!.scrollWidth,
    height: document.querySelector<HTMLElement>('.kb-page-body')!.scrollHeight,
  }));
  await mutate(page, { kind: 'remove-task', taskId: 'other' });
  await page.waitForFunction(() => document.querySelectorAll('.kb-motion-overlay > *').length === 1);
  const copy = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('.kb-motion-overlay')!;
    const element = overlay.firstElementChild as HTMLElement;
    return {
      taskId: element.getAttribute('data-task-id'),
      inert: element.inert,
      running: element.getAnimations().length,
      overlayHidden: overlay.getAttribute('aria-hidden'),
      width: document.querySelector<HTMLElement>('.kb-columns')!.scrollWidth,
      height: document.querySelector<HTMLElement>('.kb-page-body')!.scrollHeight,
    };
  });
  expect(copy.taskId).toBeNull();
  expect(copy.inert).toBe(true);
  expect(copy.running).toBeGreaterThan(0);
  expect(copy.overlayHidden).toBe('true');
  expect(copy.width).toBe(before.width);
  expect(copy.height).toBe(before.height);
  await expect(page.locator('.kb-motion-overlay > *')).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('[data-task-id="other"]')).toHaveCount(0);
});

test('an exit copy stays visible after horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1600 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await mutate(page, { kind: 'widen-workflow' });
  await mutate(page, { kind: 'move-task', taskId: 'other', columnId: 'c6' });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-task-id="other"]')?.closest('[data-column-id="c6"]') !== null);
  await expect(page.locator('.kb-card-gliding')).toHaveCount(0, { timeout: 2000 });
  const scrolled = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.kb-columns')!;
    list.scrollLeft = list.scrollWidth;
    return { scrollLeft: list.scrollLeft, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth };
  });
  expect(scrolled.scrollLeft).toBeGreaterThan(0);
  await mutate(page, { kind: 'remove-task', taskId: 'other' });
  await page.waitForFunction(() => document.querySelectorAll('.kb-motion-overlay > *').length === 1);
  const copy = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.kb-columns')!;
    const overlay = document.querySelector<HTMLElement>('.kb-motion-overlay')!;
    const element = overlay.firstElementChild as HTMLElement;
    // Compare against the overlay's own box: that is the clip box the fade is
    // painted through. Comparing against the scroller's box would pass even when
    // the overlay still sat at the content origin and clipped the copy away.
    const clip = overlay.getBoundingClientRect();
    const copyRect = element.getBoundingClientRect();
    return {
      width: copyRect.width,
      inside: copyRect.left >= clip.left - 1 && copyRect.right <= clip.right + 1
        && copyRect.top >= clip.top - 1 && copyRect.bottom <= clip.bottom + 1,
      scrollWidth: list.scrollWidth,
    };
  });
  expect(copy.width).toBeGreaterThan(0);
  expect(copy.inside).toBe(true);
  expect(copy.scrollWidth).toBe(scrolled.scrollWidth);
});

test('an appearing card fades in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await mutate(page, { kind: 'add-task' });
  await page.waitForFunction(() => {
    const card = document.querySelector<HTMLElement>('[data-task-id="synced"]');
    return card !== null && card.getAnimations().length > 0;
  });
  await expect(page.getByRole('button', { name: 'Open task Synced task', exact: true })).toBeVisible();
});

test('reduced motion removes the card movement', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await dragCard(page, 'Long column task 0', 'Apply column');
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Long column task 0', exact: true })).toBeVisible();
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-card-gliding').count()).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
});

test('replacing the presented view settles immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await openFilterPopover(page);
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await search.fill('Short task');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length === 1);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length > 10);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
  const projectFilter = page.getByRole('combobox', { name: 'Project filter' });
  await projectFilter.selectOption('p2');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length === 1);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
  await projectFilter.selectOption('');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length > 10);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
});

test('switching Hub settles immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=hubs');
  await page.waitForSelector('.kb-card');
  await page.getByRole('tab', { name: 'Second Hub' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length === 0);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
  await page.getByRole('tab', { name: 'Harness Hub' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length > 0);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
});

test('the empty-column note waits for the card exit and then fades in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await mutate(page, { kind: 'empty-column', columnId: 'propose' });
  const note = page.locator('[data-column-id="propose"] .kb-empty-column');
  await expect(note).toHaveCount(1);
  const early = await note.evaluate(element => ({ opacity: Number(getComputedStyle(element).opacity), animation: getComputedStyle(element).animation }));
  expect(early.opacity).toBeLessThan(0.5);
  expect(early.animation).toContain('kb-empty-column-enter');
  expect(early.animation).toContain('0.1s');
  await page.waitForTimeout(400);
  await expect(note).toHaveCSS('opacity', '0.6');
});
