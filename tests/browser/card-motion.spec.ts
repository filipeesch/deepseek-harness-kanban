import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

interface HarnessTask { id: string; columnId: string; position: number; title: string; [key: string]: unknown }
interface HarnessState { hubs: Array<{ tasks: HarnessTask[] }> }
type HarnessWindow = { __harness: { mutate(change: (state: unknown) => void): void; commands(): Array<{ type: string }> } };

type HarnessMutation =
  | { kind: 'remove-task'; taskId: string }
  | { kind: 'empty-column'; columnId: string }
  | { kind: 'move-task'; taskId: string; columnId: string }
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

/** A pointer press inside the grid arms the frame, as any user interaction does. */
async function armBoard(page: Page): Promise<void> {
  const header = page.locator('.kb-column-header h2').first();
  const box = (await header.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
}

function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.kb-card')).filter(card => card.getAnimations().length > 0).length);
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
  await dragCard(page, 'Long column task 0', 'Apply column');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.kb-card')).some(card => card.getAnimations().length > 0));
  const motion = await page.evaluate(() => {
    const moved = document.querySelector<HTMLElement>('[data-task-id="long-0"]');
    const animated = Array.from(document.querySelectorAll<HTMLElement>('.kb-card')).filter(card => card.getAnimations().length > 0).length;
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
    return { pointerEvents: getComputedStyle(card).pointerEvents, disabled: open.disabled, focusable: open.tabIndex >= 0 };
  });
  expect(interactive.pointerEvents).not.toBe('none');
  expect(interactive.disabled).toBe(false);
  expect(interactive.focusable).toBe(true);
  await expect(page.getByRole('region', { name: 'Apply column' }).getByRole('button', { name: 'Open task Long column task 0', exact: true })).toBeVisible();
  await expect(page.locator('.kb-card.kb-card-gliding')).toHaveCount(0, { timeout: 2000 });
  expect(await runningAnimations(page)).toBe(0);
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

test('a host-driven move glides the card and sends no command', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await armBoard(page);
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
  await armBoard(page);
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

test('an appearing card fades in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await armBoard(page);
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
  await armBoard(page);
  const search = page.getByRole('searchbox', { name: 'Search tasks' });
  await search.fill('Short task');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length === 1);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
  await search.fill('');
  await page.waitForFunction(() => document.querySelectorAll('.kb-card').length > 10);
  expect(await runningAnimations(page)).toBe(0);
  expect(await page.locator('.kb-motion-overlay > *').count()).toBe(0);
});

test('the empty-column note waits for the card exit and then fades in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  await armBoard(page);
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
