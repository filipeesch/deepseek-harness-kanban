import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('notice creates with displayed defaults without switching tabs', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Long column task 0' }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await expect(notice).toContainText('long-column-task-0');
  await expect(notice).toContainText('/worktrees/long-column-task-0');
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Conversations' })).toHaveAttribute('aria-selected', 'true');
  const commands = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; branchName?: string }> } }).__harness.commands());
  expect(commands).toContainEqual(expect.objectContaining({ type: 'worktree.create', branchName: 'long-column-task-0' }));
});
