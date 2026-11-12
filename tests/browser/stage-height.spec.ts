import { expect, test, type Page } from '@playwright/test';
import { estimateStageHeight } from '../../src/domain/diagram/stage-height.js';
import { STAGE_MIN_SIZE } from '../../src/domain/stage-size.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

/**
 * The documented tolerance of the stage-height estimate, in diagram pixels. The
 * estimate omits the stage's own 1px borders and counts one card-list gap where
 * the rendered list pads on both sides, so a plain card lands 2px above the
 * estimate; the tolerance covers that and font metrics that differ by a pixel
 * between browsers. A stylesheet change to the header, the list padding, the
 * card gap, or a card row moves a stage past it.
 */
const TOLERANCE_PX = 8;

/** The flow scenario authors no stage size, so every stage renders at the accepted minimum. */
const AUTHORED_HEIGHT = STAGE_MIN_SIZE.height;

interface HarnessTask { id: string; title: string; columnId: string; position: number; [key: string]: unknown }
interface HarnessHub { tasks: HarnessTask[] }
interface HarnessState { hubs: HarnessHub[] }
type HarnessWindow = { __harness: { mutate(change: (state: unknown) => void): void } };

/** Replaces the board's cards so each named stage holds exactly the given count. */
async function setCards(page: Page, counts: Readonly<Record<string, number>>): Promise<void> {
  await page.evaluate(input => {
    const harness = (window as unknown as HarnessWindow).__harness;
    harness.mutate(value => {
      const hub = (value as HarnessState).hubs[0]!;
      const template = hub.tasks[0]!;
      hub.tasks = Object.entries(input).flatMap(([columnId, count]) => Array.from({ length: count }, (_, index) => ({
        ...template,
        id: columnId + '-card-' + index,
        title: columnId + ' card ' + index,
        columnId,
        position: index,
        sessionIds: [],
        closedSessionIds: [],
      })));
    });
  }, counts);
}

function stage(page: Page, columnId: string) {
  return page.locator('.kb-flow-stage[data-column-id="' + columnId + '"]');
}

/** The diagram height of one stage; the viewport transform never scales a layout offset. */
function stageHeight(page: Page, columnId: string): Promise<number> {
  return stage(page, columnId).evaluate(element => (element as HTMLElement).offsetHeight);
}

/** Reads the stage height until two consecutive reads agree, so an animation frame is never measured. */
async function settledHeight(page: Page, columnId: string): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const height = await stageHeight(page, columnId);
    if (height === previous) return height;
    previous = height;
    await page.waitForTimeout(50);
  }
  return previous;
}

test('the stage-height estimate stays within tolerance of the rendered stages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(HARNESS + '?scenario=flow&theme=host');
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(250);

  const counts = { explore: 0, propose: 1, apply: 5 } as const;
  await setCards(page, counts);
  for (const [columnId, count] of Object.entries(counts)) {
    await expect(stage(page, columnId).locator('.kb-card')).toHaveCount(count);
  }

  for (const [columnId, count] of Object.entries(counts)) {
    const measured = await settledHeight(page, columnId);
    const estimate = estimateStageHeight(AUTHORED_HEIGHT, count);
    expect(Math.abs(estimate - measured), columnId + ' with ' + count + ' cards: estimate ' + estimate + ', measured ' + measured)
      .toBeLessThanOrEqual(TOLERANCE_PX);
  }
});
