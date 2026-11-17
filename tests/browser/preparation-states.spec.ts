import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const shot = (name: string) => path.join('.verification', name);

test.beforeAll(async () => { await mkdir('.verification', { recursive: true }); });

test('names the background creation step and its failure on the card in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=move');
  const creating = page.locator('[data-task-id="slow-create"]');
  const failed = page.locator('[data-task-id="failed-create"]');
  await expect(creating.locator('.kb-card-status-line')).toHaveText('Creating worktree…');
  await expect(creating.locator('.kb-card-status-line.is-pending')).toHaveCount(1);
  await expect(failed.locator('.kb-card-status-line')).toHaveText('Worktree creation needs attention');
  await expect(failed.locator('.kb-card-status-line.is-danger')).toHaveCount(1);
  // The two new status labels are text, so they must clear the text contrast floor.
  await expectLegible(page, '[data-task-id="slow-create"] .kb-card-status-line', 4.5);
  await expectLegible(page, '[data-task-id="failed-create"] .kb-card-status-line', 4.5);
  await creating.screenshot({ path: shot('execution-preparation-creating.png') });
  await failed.screenshot({ path: shot('execution-preparation-creation-failed.png') });
  await page.screenshot({ path: shot('execution-preparation-status-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await expect(creating.locator('.kb-card-status-line')).toHaveText('Creating worktree…');
  await expectLegible(page, '[data-task-id="slow-create"] .kb-card-status-line', 4.5);
  await expectLegible(page, '[data-task-id="failed-create"] .kb-card-status-line', 4.5);
  await page.screenshot({ path: shot('execution-preparation-status-dark.png') });
});

test('presents the preparing first execution on the card before the countdown', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=preparing-card');
  const card = page.locator('.kb-card');
  const preparing = card.getByRole('button', { name: 'Preparing Review instruction' });
  await expect(preparing).toBeVisible();
  await expect(preparing).toBeDisabled();
  await expect(preparing).toHaveAttribute('aria-busy', 'true');
  await expect(card.getByText('Preparing the first execution for the Review instruction.')).toBeAttached();
  await card.screenshot({ path: shot('execution-preparation-preparing-card.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await card.screenshot({ path: shot('execution-preparation-preparing-card-dark.png') });
});
