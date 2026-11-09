import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

interface Geometry {
  headerHeight: number;
  hasSubtitle: boolean;
  titleCenter: number;
  hubRowCenter: number;
  boardRowTop: number;
  toolbarCenter: number;
  hubTabHeight: number;
  boardRowHeight: number;
  controlHeights: number[];
  overflow: boolean;
}

function readGeometry(): Geometry {
  const header = document.querySelector<HTMLElement>('.kb-header');
  if (header === null) throw new Error('the board header is missing');
  const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
  const center = (selector: string) => {
    const box = rect(selector);
    return box === undefined ? -1 : Math.round(box.top + box.height / 2);
  };
  const height = (selector: string) => Math.round(rect(selector)?.height ?? 0);
  const headerBox = header.getBoundingClientRect();
  const inside = [...header.querySelectorAll<HTMLElement>('.kb-header h1, .kb-hub-tabs, .kb-board-tabs, .kb-toolbar > *')];
  return {
    headerHeight: Math.round(headerBox.height),
    hasSubtitle: header.querySelector('.kb-hint') !== null,
    titleCenter: center('.kb-header h1'),
    hubRowCenter: center('.kb-hub-tabs'),
    boardRowTop: Math.round(rect('.kb-board-tabs')?.bottom ?? 0),
    toolbarCenter: center('.kb-toolbar'),
    hubTabHeight: height('.kb-hub-tab'),
    boardRowHeight: height('.kb-board-tabs'),
    controlHeights: [...header.querySelectorAll<HTMLElement>('.kb-toolbar .kb-control')].map(element => Math.round(element.getBoundingClientRect().height)),
    overflow: inside.some(element => {
      const box = element.getBoundingClientRect();
      return box.width === 0 || box.right > headerBox.right + 1 || box.left < headerBox.left - 1;
    }),
  };
}

async function geometryAt(page: Page, width: number): Promise<Geometry> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${HARNESS}?scenario=hubs`);
  await page.waitForSelector('.kb-hub-tab');
  return page.evaluate(readGeometry);
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents the header as two compact rows', async ({ page }) => {
  const reading = await geometryAt(page, 1400);
  expect(reading.hasSubtitle).toBe(false);
  // The Hub row shares the title line, and the board row is the second line.
  expect(Math.abs(reading.titleCenter - reading.hubRowCenter)).toBeLessThan(16);
  expect(reading.boardRowTop).toBeGreaterThan(reading.titleCenter);
  expect(reading.headerHeight).toBeLessThanOrEqual(112);
  await page.screenshot({ path: path.join(OUT, 'header-rows-1400.png') });
});

test('gives every first-row control the Hub tab height', async ({ page }) => {
  const reading = await geometryAt(page, 1400);
  expect(reading.controlHeights.length).toBeGreaterThanOrEqual(3);
  for (const height of reading.controlHeights) expect(height).toBe(reading.hubTabHeight);
});

test('keeps both rows on one line at a desktop width', async ({ page }) => {
  const reading = await geometryAt(page, 1100);
  expect(Math.abs(reading.toolbarCenter - reading.hubRowCenter)).toBeLessThan(16);
  expect(reading.headerHeight).toBeLessThanOrEqual(112);
  expect(reading.overflow).toBe(false);
  await page.screenshot({ path: path.join(OUT, 'header-rows-1100.png') });
});

for (const width of [900, 700]) {
  test(`reflows the header without clipping at ${String(width)}px`, async ({ page }) => {
    const reading = await geometryAt(page, width);
    expect(reading.overflow).toBe(false);
    expect(reading.boardRowHeight).toBeGreaterThan(0);
    // Reflow may add lines, but it never resizes a control out of the band.
    for (const height of reading.controlHeights) expect(height).toBe(reading.hubTabHeight);
    await page.screenshot({ path: path.join(OUT, `header-rows-${String(width)}.png`) });
  });
}

test('gives the toolbar its own line once the frame is narrow', async ({ page }) => {
  const reading = await geometryAt(page, 700);
  expect(Math.abs(reading.toolbarCenter - reading.hubRowCenter)).toBeGreaterThanOrEqual(16);
  expect(reading.headerHeight).toBeGreaterThan(112);
});

test('keeps the smaller board chips carrying their attention dots and running count', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${HARNESS}?scenario=hubs`);
  await page.waitForSelector('.kb-board-tab');
  const chip = page.getByRole('tab', { name: /Harness board/ });
  const dots = await chip.locator('.kb-dot').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  expect(dots).toEqual(['Board unread activity', 'Board awaiting reply', 'Board failure']);
  await expect(chip.locator('.kb-tab-running')).toHaveAttribute('aria-label', '4 tasks running');
  const name = await chip.evaluate(node => node.textContent);
  expect(name).toContain('Harness board');

  // Compactness only means something with a row of chips: add a second board and measure both.
  const hubTabHeight = await page.locator('.kb-hub-tab').first().evaluate(node => node.getBoundingClientRect().height);
  const boardRowHeight = await page.locator('.kb-board-tabs').evaluate(node => node.getBoundingClientRect().height);
  await page.getByRole('button', { name: 'Create board', exact: true }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('textbox', { name: 'Board name' }).fill('Second board');
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Second board' })).toBeVisible();

  const chips = page.locator('.kb-board-tab');
  expect(await chips.count()).toBe(2);
  for (const height of await chips.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)))) {
    expect(height).toBeLessThan(hubTabHeight);
    expect(height).toBeGreaterThanOrEqual(20);
  }
  // The row keeps the height it had before the chips shrank, so the second row never collapses.
  expect(await page.locator('.kb-board-tabs').evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(boardRowHeight, 0);
  // The active chip is distinguishable without colour alone.
  await expect(page.getByRole('tab', { name: 'Second board' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Harness board/ })).toHaveAttribute('aria-selected', 'false');
  expect(await page.getByRole('tab', { name: 'Second board' }).evaluate(node => node.className)).toContain('is-active');
});

test('clears the host frame leading clearance for the title and the Hub row', async ({ page }) => {  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${HARNESS}?scenario=hubs`);
  await page.waitForSelector('.kb-hub-tab');
  // The collapsed host sidebar reserves this inset; the first row now carries the Hub tabs too.
  await page.addStyleTag({ content: '.dsh-kanban{--dsh-frame-leading-clearance:96px}' });
  const lefts = await page.evaluate(() => ({
    title: Math.round(document.querySelector<HTMLElement>('.kb-header h1')!.getBoundingClientRect().left),
    tabs: [...document.querySelectorAll<HTMLElement>('.kb-hub-tab')].map(tab => Math.round(tab.getBoundingClientRect().left)),
  }));
  expect(lefts.title).toBeGreaterThanOrEqual(96);
  for (const left of lefts.tabs) expect(left).toBeGreaterThanOrEqual(96);
  await page.screenshot({ path: path.join(OUT, 'header-frame-clearance.png') });
});
