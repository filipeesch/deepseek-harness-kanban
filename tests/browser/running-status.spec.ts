import { expect, test, type Locator } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

/** The trailing execution accent's animated pseudo-element. */
function accent(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((element: HTMLElement, name: string) => getComputedStyle(element, '::after').getPropertyValue(name), property);
}

test('cards show the execution accent with a real pulse', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');

  const working = page.locator('[data-task-id="long-0"]');
  await expect(working).toHaveAttribute('data-working', 'true');
  await expect(working.locator('.kb-card-open')).not.toHaveAttribute('data-working');
  expect(await accent(working, 'animation-name')).toBe('kb-working-bar');
  expect(await accent(working, 'width')).toBe('3px');
  // The working label is gone; the activity announcement is the only text.
  await expect(working.locator('.kb-working')).toHaveCount(0);
  await expect(working.getByRole('status')).toHaveText(/Working/);

  const background = page.locator('[data-task-id="long-1"]');
  await expect(background).not.toHaveAttribute('data-working', 'true');
  expect(await accent(background, 'animation-name')).toBe('none');
  await expect(background.locator('.kb-background')).toHaveCount(0);
  await expect(background.getByText('1 job')).toHaveCount(0);

  // The activity region is reserved, so idle, working, and background cards share one height.
  const heights = await page.locator('.kb-card').evaluateAll(cards => cards.slice(0, 6).map(card => Math.round(card.getBoundingClientRect().height)));
  expect(new Set(heights).size, JSON.stringify(heights)).toBe(1);

  const both = page.locator('[data-task-id="long-2"]');
  expect(await accent(both, 'animation-name')).toBe('kb-working-bar');
  await expect(both.getByText('1 schedule')).toHaveCount(0);
});

test('mixed attention states coexist with the accent and no background chip', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const card = page.locator('[data-task-id="long-3"]');
  const dots = card.locator('.kb-card-context .kb-attention-dots .kb-dot');
  await expect(dots).toHaveCount(3);
  await expect(card.locator('.kb-background')).toHaveCount(0);
  expect(await accent(card, 'animation-name')).toBe('none');
  const activity = await card.locator('.kb-card-activity').evaluate(element => Math.round(element.getBoundingClientRect().height));
  expect(activity, 'the activity region stays on one reserved line').toBe(26);
});

test('keeps the controls of the activity row at one height', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const card = page.locator('[data-task-id="long-0"]');
  await expect(card.locator('.kb-auto-chip')).toBeVisible();
  const heights = await card.evaluate(element => {
    const values = [...element.querySelectorAll('.kb-card-actions > *')].map(child => Math.round(child.getBoundingClientRect().height));
    return values.length === 0 ? [0] : values;
  });
  expect(new Set(heights).size, JSON.stringify(heights)).toBe(1);
  expect(heights[0]).toBe(26);
});

test('drawer activity dot stays on the Conversations tab across sections', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.getByRole('button', { name: 'Open task Long column task 2', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  const conversations = drawer.getByRole('tab', { name: 'Conversations, Agent running. Background activity: Wake later' });
  await expect(conversations.locator('.kb-activity-dot')).toBeVisible();
  await expect(conversations).toHaveAttribute('title', 'Conversations, Agent running. Background activity: Wake later');
  await expect.poll(() => conversations.locator('.kb-activity-dot').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await expect(drawer.locator('.kb-drawer-header .kb-working')).toHaveCount(0);
  await expect(drawer.locator('.kb-drawer-header').getByText(/Background:/)).toHaveCount(0);
  for (const tab of ['Info', 'Git', 'Notes']) {
    await drawer.getByRole('tab', { name: tab }).click();
    await expect(drawer.getByRole('tab', { name: /^Conversations/ }).locator('.kb-activity-dot')).toBeVisible();
  }
});

test('reduced motion keeps the accent visible without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const working = page.locator('[data-task-id="long-0"]');
  await expect(working).toHaveAttribute('data-working', 'true');
  expect(await accent(working, 'animation-name')).toBe('none');
  expect(await accent(working, 'opacity')).toBe('1');
  const dot = page.locator('.kb-drawer .kb-activity-dot');
  await page.getByRole('button', { name: 'Open task Long column task 0', exact: true }).click();
  await expect(dot).toBeVisible();
  expect(await dot.evaluate(element => element.getAnimations().length)).toBe(0);
});
