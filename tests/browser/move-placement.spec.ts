import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('a drag past the last card keeps the dropped end position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board');
  const card = page.getByRole('button', { name: 'Open task Long column task 0', exact: true });
  const destination = page.getByRole('region', { name: 'Apply column' });
  const cardBox = (await card.boundingBox())!;
  const columnBox = (await destination.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + columnBox.height - 8, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const harness = (window as unknown as { __harness: { commands(): Array<{ type: string; columnId?: string; beforeTaskId?: string | null }> } }).__harness;
    return harness.commands().filter(command => command.type === 'task.move').at(-1) ?? null;
  })).toMatchObject({ type: 'task.move', taskId: 'long-0', columnId: 'apply', beforeTaskId: null });
  await expect(destination.getByRole('button', { name: 'Open task Long column task 0' })).toBeVisible();
});
