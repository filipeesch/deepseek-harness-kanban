import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('grouped columns grow with their cards and the board scrolls', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.waitForSelector('.kb-column');
  const layout = await page.evaluate(() => {
    const body = document.querySelector('.kb-page-body')!;
    const columns = [...document.querySelectorAll<HTMLElement>('.kb-column')].map(column => {
      const cards = [...column.querySelectorAll<HTMLElement>('.kb-card')];
      const rect = column.getBoundingClientRect();
      const last = cards.at(-1)?.getBoundingClientRect();
      return { label: column.querySelector('h2')?.textContent, height: rect.height, cards: cards.length, overflow: last ? last.bottom - rect.bottom : 0 };
    });
    return { columns, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight };
  });
  const explore = layout.columns.find(column => column.label === 'Explore')!;
  const propose = layout.columns.find(column => column.label === 'Propose')!;
  expect(explore.cards).toBe(12);
  expect(explore.height).toBeGreaterThan(propose.height);
  expect(explore.overflow).toBeLessThanOrEqual(0);
  expect(propose.overflow).toBeLessThanOrEqual(0);
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);
});
