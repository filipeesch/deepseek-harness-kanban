import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.join(import.meta.dirname, '..', '..', '.verification');
const LONG_PROJECT = 'A very long project name that must truncate inside the card';

async function openFilters(page: Page) {
  await page.goto(`${HARNESS}?scenario=board`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filter tasks' })).toBeVisible();
}

test('paints the popover over the board and under the drawer, and dismisses it alone', async ({ page }) => {
  await page.goto(`${HARNESS}?scenario=board`);
  await page.waitForSelector('.kb-column');
  await page.getByRole('button', { name: /^Filter tasks/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter tasks' });
  await expect(dialog).toBeVisible();

  // The layer order is board, filter popover, drawer. Over the board the popover wins.
  const overBoard = await page.locator('.kb-filter-popover').evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.left + box.width / 2, box.bottom - 8));
  });
  expect(overBoard).toBe(true);

  // Opening a task from the keyboard leaves the popover open, and the drawer covers it.
  await page.getByRole('button', { name: 'Open task Short task', exact: true }).evaluate((node: HTMLElement) => node.focus());
  await page.keyboard.press('Enter');
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  await expect(dialog).toBeVisible();
  const underDrawer = await page.locator('.kb-filter-popover').evaluate(element => {
    const box = element.getBoundingClientRect();
    // A null hit means the point is off screen, which proves nothing about coverage.
    return document.elementFromPoint(box.left + box.width / 2, box.top + 8)?.closest('.kb-drawer') != null;
  });
  expect(underDrawer).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filter tasks/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('keeps a long project name inside the popover and offers the full name', async ({ page }) => {
  await openFilters(page);
  await page.getByRole('combobox', { name: 'Project filter' }).selectOption('p2');
  const box = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('.kb-filter-popover select')!;
    const popover = document.querySelector<HTMLElement>('.kb-filter-popover')!;
    // A native select clips its own text without reporting scrollWidth, so measure the label.
    const metrics = document.createElement('canvas').getContext('2d')!;
    metrics.font = getComputedStyle(select).font;
    const label = select.options[select.selectedIndex]?.text ?? '';
    return {
      truncated: metrics.measureText(label).width > select.clientWidth - 8,
      title: select.title,
      insideViewport: popover.getBoundingClientRect().right <= window.innerWidth,
    };
  });
  expect(box.truncated).toBe(true);
  expect(box.title).toBe(LONG_PROJECT);
  expect(box.insideViewport).toBe(true);
  await expect(page.locator('.kb-card')).toHaveCount(1);
  await page.screenshot({ path: path.join(OUT, 'filter-popover.png') });
});

// Once the toolbar owns the whole line the funnel sits at the leading edge, so a
// trailing-aligned popover is pulled off screen and the clipped page root hides it.
for (const width of [700, 420]) {
  test(`keeps the filter popover on screen and usable at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFilters(page);
    const reach = await page.evaluate(() => {
      const popover = document.querySelector<HTMLElement>('.kb-filter-popover');
      if (popover === null) return null;
      const search = popover.querySelector<HTMLInputElement>('input[type=search]');
      const select = popover.querySelector<HTMLSelectElement>('select');
      if (search === null || select === null) return null;
      const reachable = (element: Element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      };
      const box = popover.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        insideViewport: box.left >= 0 && box.right <= window.innerWidth,
        searchReachable: reachable(search),
        selectReachable: reachable(select),
      };
    });
    expect(reach).not.toBeNull();
    expect(reach?.insideViewport).toBe(true);
    expect(reach?.searchReachable).toBe(true);
    expect(reach?.selectReachable).toBe(true);

    // Usable, not merely painted: the narrow popover still filters the board.
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill('Short');
    await expect(page.locator('.kb-card')).toHaveCount(1);
    await expect(page.locator('.kb-card').first()).toContainText('Short task');
    await page.screenshot({ path: path.join(OUT, `filter-popover-${String(width)}.png`) });
  });
}
