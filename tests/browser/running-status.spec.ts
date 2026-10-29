import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('cards show working and background activity with a real pulse', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');

  const working = page.locator('[data-task-id="long-0"]');
  await expect(working).toHaveAttribute('data-working', 'true');
  await expect(working.locator('.kb-card-open')).not.toHaveAttribute('data-working');
  await expect(working.locator('.kb-working')).toHaveText(/Working/);
  await expect.poll(() => working.locator('.kb-working-dot').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  expect(await page.locator('.kb-card[data-working=true]').first().evaluate(element => getComputedStyle(element).boxShadow)).toContain('inset');
  await expect(working.locator('.kb-card-activity .kb-working')).toBeVisible();

  const background = page.locator('[data-task-id="long-1"]');
  await expect(background).not.toHaveAttribute('data-working', 'true');
  await expect(background.locator('.kb-card-activity').getByText('1 job')).toBeVisible();

  // The activity region is reserved, so idle, working, and background cards share one height.
  const heights = await page.locator('.kb-card').evaluateAll(cards => cards.slice(0, 6).map(card => Math.round(card.getBoundingClientRect().height)));
  expect(new Set(heights).size, JSON.stringify(heights)).toBe(1);
  const note = background.getByRole('note');
  await expect(note).toHaveAttribute('title', 'Run tests');
  await note.focus();
  await expect(note).toBeFocused();
  await expect(note).toHaveAttribute('aria-label', 'Background activity: 1 job. Run tests');

  const both = page.locator('[data-task-id="long-2"]');
  await expect(both.locator('.kb-working')).toBeVisible();
  await expect(both.getByText('1 subagent')).toBeVisible();
});

test('mixed background kinds aggregate into one activity line beside the identity row', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const card = page.locator('[data-task-id="long-3"]');
  const chip = card.locator('.kb-card-activity .kb-background');
  await expect(chip).toHaveText('2 activities');
  await expect(chip).toHaveAttribute('aria-label', 'Background activity: 2 activities. Run tests · Research');
  await expect(chip).toHaveAttribute('title', 'Run tests · Research');
  await expect(chip).not.toContainText('job');
  await expect(chip).not.toContainText('subagent');

  const dots = card.locator('.kb-card-context .kb-card-attention .kb-dot');
  await expect(dots).toHaveCount(3);
  await expect(card.locator('.kb-card-context').getByText('2 activities')).toHaveCount(0);
  const activity = await card.locator('.kb-card-activity').evaluate(element => Math.round(element.getBoundingClientRect().height));
  expect(activity, 'the activity region stays on one reserved line').toBe(26);
});

test('drawer header keeps the execution status across sections', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.getByRole('button', { name: 'Open task Long column task 2', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer.locator('.kb-drawer-header .kb-working')).toBeVisible();
  await expect(drawer.locator('.kb-drawer-header').getByText('Background: Research')).toBeVisible();
  for (const tab of ['Info', 'Git', 'Notes']) {
    await drawer.getByRole('tab', { name: tab }).click();
    await expect(drawer.locator('.kb-drawer-header .kb-working')).toBeVisible();
  }
});

test('reduced motion keeps the indicator visible without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-working-dot');
  expect(await page.locator('.kb-working-dot').first().evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(page.locator('.kb-working').first()).toBeVisible();
  await expect(page.locator('.kb-card[data-working=true]').first()).toBeVisible();
});
