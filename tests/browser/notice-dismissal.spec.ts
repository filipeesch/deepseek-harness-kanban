import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
/** The retained group's heading; the unusable operations stay in the same section. */
const RETAINED_HEADING = 'Checkouts left on disk';

test('dismisses one retained checkout and keeps the other', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained-many');
  const notice = page.getByRole('region', { name: 'Destructive operations' });
  await expect(notice).toContainText('/worktrees/gone');
  await expect(notice).toContainText('/worktrees/plain');
  await notice.getByRole('button', { name: 'Dismiss the retained checkout at /worktrees/gone' }).click();
  await expect(notice).not.toContainText('/worktrees/gone');
  await expect(notice).toContainText('/worktrees/plain');
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __harnessCommands: () => readonly { type: string }[] }).__harnessCommands().map(command => command.type)))
    .toContain('retainedCheckout.dismiss');
});

test('dismisses every retained checkout from the group header', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained-many');
  const notice = page.getByRole('region', { name: 'Destructive operations' });
  await notice.getByRole('button', { name: 'Dismiss all' }).click();
  await expect(notice.getByText(RETAINED_HEADING)).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __harnessCommands: () => readonly { type: string; paths?: string[] }[] }).__harnessCommands().filter(command => command.type === 'retainedCheckout.dismiss').at(-1)?.paths))
    .toEqual(['/worktrees/gone', '/worktrees/plain']);
});

test('a dismissed retained checkout survives hiding and showing the board', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained');
  const notice = page.getByRole('region', { name: 'Destructive operations' });
  await notice.getByRole('button', { name: 'Dismiss the retained checkout at /worktrees/gone' }).click();
  await expect(page.getByText(RETAINED_HEADING)).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide board' }).click();
  await page.getByRole('button', { name: 'Show board' }).click();
  await expect(page.getByText(RETAINED_HEADING)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Destructive operations' })).not.toContainText('/worktrees/gone');
});

test('a failed destructive operation offers no dismiss control', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=appearance');
  const notice = page.getByRole('region', { name: 'Destructive operations' });
  await expect(notice.getByText('Task deletion needs attention: Failed delete')).toBeVisible();
  await expect(notice.getByRole('button', { name: /^Dismiss/ })).toHaveCount(0);
});

test('dismiss all hands focus to the board body', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained-many');
  await page.getByRole('button', { name: 'Dismiss all' }).click();
  await expect(page.getByText(RETAINED_HEADING)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? ''))
    .toContain('kb-page-body');
});

test('dismissing one retained checkout hands focus to the next dismiss control', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained-many');
  await page.getByRole('button', { name: 'Dismiss the retained checkout at /worktrees/gone' }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''))
    .toBe('Dismiss the retained checkout at /worktrees/plain');
});

test('the dismiss control is keyboard operable', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=retained');
  await page.getByRole('button', { name: 'Dismiss the retained checkout at /worktrees/gone' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(RETAINED_HEADING)).toHaveCount(0);
});
