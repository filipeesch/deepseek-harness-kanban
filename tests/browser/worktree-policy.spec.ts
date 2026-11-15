import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

async function openTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  await page.getByRole('tab', { name: 'Conversations' }).waitFor();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, name) });
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('states the Always create policy in the notice and the Git section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board&policy=always');
  await openTask(page, 'Long column task 0');
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('This project creates a worktree for its tasks by default.');
  await expect(notice.getByRole('button', { name: 'Continue in base project' })).toHaveCount(0);
  await expect(notice.getByRole('button', { name: 'Create worktree' })).toBeVisible();
  await shot(page, 'worktree-policy-always-notice.png');
  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(page.getByText('This project creates a worktree for its tasks by default, so a first execution starts on the derived default.')).toBeVisible();
  await shot(page, 'worktree-policy-always-git.png');
});

test('hides the notice under the Never policy and states it in the Git section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board&policy=never');
  await openTask(page, 'Long column task 0');
  await expect(page.getByRole('note', { name: 'Worktree not created' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New conversation' })).toBeEnabled();
  await shot(page, 'worktree-policy-never-conversations.png');
  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(page.getByText('This project never creates a worktree for its tasks; they run in the base project, and creating one here is explicit.')).toBeVisible();
  await shot(page, 'worktree-policy-never-git.png');
});

test('keeps the Ask policy silent in both surfaces', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await openTask(page, 'Long column task 0');
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Continue in base project' })).toBeVisible();
  await expect(notice).not.toContainText('by default');
  await page.getByRole('tab', { name: 'Git' }).click();
  await expect(page.getByText(/creates a worktree for its tasks by default/)).toHaveCount(0);
});
