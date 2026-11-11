import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = '.verification';

/** The diagram's live zoom, read from the viewport transform the surface renders. */
async function viewportZoom(page: Page): Promise<number> {
  const style = await page.locator('.react-flow__viewport').getAttribute('style');
  const match = /scale\(([\d.]+)\)/.exec(style ?? '');
  return match === null ? 1 : Number(match[1]);
}

/** The live zoom and the bounded mark scale read from one frame, so they cannot disagree mid-animation. */
async function viewportPair(page: Page): Promise<{ zoom: number; scale: number }> {
  return page.evaluate(() => {
    const style = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '';
    const match = /scale\(([\d.]+)\)/.exec(style);
    const canvas = document.querySelector('.kb-flow-canvas');
    const scale = canvas === null ? 1 : Number(getComputedStyle(canvas).getPropertyValue('--kb-mark-scale').trim() || '1');
    return { zoom: match === null ? 1 : Number(match[1]), scale };
  });
}

/** Wait for the animated zoom to stop so the pair describes the settled viewport. */
async function settledViewport(page: Page): Promise<{ zoom: number; scale: number }> {
  let previous = await viewportPair(page);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(50);
    const current = await viewportPair(page);
    if (current.zoom === previous.zoom && current.scale === previous.scale) return current;
    previous = current;
  }
  return previous;
}

/** Click one zoom control until the diagram satisfies the predicate. */
async function zoomUntil(page: Page, label: 'Zoom in' | 'Zoom out', done: (zoom: number) => boolean, max = 24): Promise<number> {
  for (let step = 0; step < max; step += 1) {
    const zoom = await viewportZoom(page);
    if (done(zoom)) return zoom;
    await page.getByRole('button', { name: label }).click();
    await page.waitForTimeout(70);
  }
  return viewportZoom(page);
}

test('paints the dominant state on the card and keeps every mark', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');

  const failed = page.locator('[data-task-id="long-3"]');
  await expect(failed).toHaveAttribute('data-presence', 'error');
  await expect(failed.locator('.kb-card-context .kb-attention-dots .kb-dot')).toHaveCount(3);

  const running = page.locator('[data-task-id="long-0"]');
  await expect(running).toHaveAttribute('data-presence', 'running');
  // Execution is never a mark, so a running card adds no dot of its own.
  await expect(running.locator('.kb-dot')).toHaveCount(0);

  const quiet = page.locator('[data-task-id="long-1"]');
  await expect(quiet).toHaveAttribute('data-presence', 'none');

  const backgrounds = await page.evaluate(() => {
    const read = (id: string): string => getComputedStyle(document.querySelector('[data-task-id="' + id + '"]')!).backgroundColor;
    return { failed: read('long-3'), running: read('long-0'), quiet: read('long-1') };
  });
  expect(backgrounds.failed).not.toBe(backgrounds.quiet);
  expect(backgrounds.running).not.toBe(backgrounds.quiet);
  expect(backgrounds.failed).not.toBe(backgrounds.running);

  // Selection mode paints the surface too and keeps its own accent.
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  await expect(page.locator('[data-task-id="long-3"]')).toHaveAttribute('data-presence', 'error');
});

test('keeps the attention marks readable at every diagram zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow-presence&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);

  const dot = page.locator('[data-task-id="long-3"] .kb-attention-dots .kb-dot').first();
  await expect(dot).toBeAttached();
  // The rendered mark is the 9px circle plus its 1px border on each side.
  const authored = 11;

  // Between the bound and zoom 1 the mark keeps a constant on-screen size.
  await zoomUntil(page, 'Zoom in', zoom => zoom >= 1);
  await zoomUntil(page, 'Zoom out', zoom => zoom <= 0.5 + 0.001);
  // The zoom animates, so the pair is read only once the viewport stopped moving;
  // reading the two values from different frames compares different zooms.
  const mid = await settledViewport(page);
  expect(mid.zoom).toBeGreaterThan(0.2);
  expect(mid.scale).toBeGreaterThan(1);
  expect(mid.scale).toBeLessThan(3.5);
  expect(mid.scale).toBeCloseTo(1 / mid.zoom, 3);
  expect((await dot.boundingBox())!.height).toBeCloseTo(authored, 0);

  // At the minimum zoom the bounded scale stops the mark from dwarfing the card.
  await zoomUntil(page, 'Zoom out', zoom => zoom <= 0.2 + 0.001);
  const min = await settledViewport(page);
  expect(min.zoom).toBeCloseTo(0.2, 3);
  expect(min.scale).toBeCloseTo(3.5, 3);
  const bounded = (await dot.boundingBox())!;
  expect(bounded.height).toBeCloseTo(authored * 3.5 * min.zoom, 0);
  expect(bounded.height).toBeLessThan(authored);

  // Past zoom 1 the mark follows the canvas instead of shrinking below its authored size.
  await zoomUntil(page, 'Zoom in', zoom => zoom >= 2.5 - 0.001);
  const max = await settledViewport(page);
  expect(max.zoom).toBeCloseTo(2.5, 3);
  expect(max.scale).toBe(1);
  expect((await dot.boundingBox())!.height).toBeCloseTo(authored * max.zoom, 0);

  // The marks keep their names at every zoom.
  const names = await page.locator('[data-task-id="long-3"] .kb-attention-dots .kb-dot').evaluateAll(dots => dots.map(dot => dot.getAttribute('aria-label')));
  expect(names).toEqual(['Unread messages', 'Awaiting reply', 'Agent failure']);

  // Running still carries no mark inside the diagram.
  await expect(page.locator('[data-task-id="long-0"] .kb-dot')).toHaveCount(0);
});

test('captures the board and the diagram at three zooms in both appearances', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(HARNESS + '?scenario=appearance');
    await page.waitForSelector('.kb-card');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await page.screenshot({ path: OUT + '/card-presence-' + scheme + '-board.png', fullPage: false });

    await page.goto(HARNESS + '?scenario=flow-presence&theme=host');
    await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
    await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(250);
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');

    await zoomUntil(page, 'Zoom in', zoom => zoom >= 1);
    await page.screenshot({ path: OUT + '/card-presence-' + scheme + '-zoom-1.png' });
    await zoomUntil(page, 'Zoom out', zoom => zoom <= 0.5 + 0.001);
    await page.screenshot({ path: OUT + '/card-presence-' + scheme + '-zoom-05.png' });
    await zoomUntil(page, 'Zoom out', zoom => zoom <= 0.2 + 0.001);
    await page.screenshot({ path: OUT + '/card-presence-' + scheme + '-zoom-02.png' });
  }
});

test('captures each attention state, selection mode, and reduced motion', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 1400 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
    await page.goto(HARNESS + '?scenario=presence');
    await page.waitForSelector('.kb-card');
    if (scheme === 'dark') await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
    await expect(page.locator('[data-task-id="long-0"]')).toHaveAttribute('data-presence', 'running');
    await expect(page.locator('[data-task-id="long-1"]')).toHaveAttribute('data-presence', 'unread');
    await expect(page.locator('[data-task-id="long-2"]')).toHaveAttribute('data-presence', 'attention');
    await expect(page.locator('[data-task-id="long-3"]')).toHaveAttribute('data-presence', 'error');

    // The mark renders at its authored size in the column board, where no zoom applies.
    const authored = (await page.locator('[data-task-id="long-1"] .kb-attention-dots .kb-dot').first().boundingBox())!;
    expect(authored.height).toBeCloseTo(11, 0);

    // The four tints share one geometry, so which state wins cannot shift the board.
    const heights = await page.locator('.kb-card[data-presence]:not([data-presence="none"])').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().height)));
    expect(heights).toHaveLength(4);
    expect(new Set(heights).size, JSON.stringify(heights)).toBe(1);

    await page.screenshot({ path: OUT + '/card-presence-' + scheme + '-states.png' });
  }

  // Selection mode keeps the painted surface and adds the selection accent.
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.goto(HARNESS + '?scenario=presence');
  await page.waitForSelector('.kb-card');
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  await page.locator('[data-task-id="long-3"] .kb-card-select').check();
  await page.screenshot({ path: OUT + '/card-presence-light-selection.png' });

  // Reduced motion keeps both accent surfaces without animating them.
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(HARNESS + '?scenario=presence');
  await page.waitForSelector('.kb-card');
  await expect(page.locator('[data-task-id="long-0"]')).toHaveAttribute('data-working', 'true');
  await page.screenshot({ path: OUT + '/card-presence-reduced-motion.png' });
});
