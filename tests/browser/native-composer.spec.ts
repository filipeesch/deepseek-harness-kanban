import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('anchors a short embedded native composer to the bottom of the conversation', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=native-composer');
  await page.waitForSelector('[data-composer-seat]');
  const geometry = await page.evaluate(() => {
    const conversation = document.querySelector<HTMLElement>('.kb-native-conversation')!;
    const composer = document.querySelector<HTMLElement>('[data-composer-seat]')!;
    return {
      conversationBottom: conversation.getBoundingClientRect().bottom,
      composerBottom: composer.getBoundingClientRect().bottom,
      composerTop: composer.getBoundingClientRect().top,
      conversationTop: conversation.getBoundingClientRect().top,
    };
  });
  expect(geometry.composerBottom).toBeGreaterThan(geometry.composerTop);
  expect(Math.abs(geometry.conversationBottom - geometry.composerBottom)).toBeLessThanOrEqual(12);
  expect(geometry.composerTop - geometry.conversationTop).toBeGreaterThan(100);
});
