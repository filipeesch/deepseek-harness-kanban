import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
const repairCalls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __kanbanRepairCalls?: number }).__kanbanRepairCalls ?? 0);

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents both states on the card and one diagnosis inside a native conversation', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HARNESS + '?scenario=session-diagnosis');
    if (scheme === 'light') expect(await page.locator('body').getAttribute('data-ds-dark-theme')).toBeNull();
    else await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');

    // The card presents the state in its status strip, and a healthy card does not.
    const unreadableCard = page.locator('[data-task-id="long-0"]');
    await expect(unreadableCard).toContainText('Session log unreadable');
    await expect(page.locator('[data-task-id="short"]')).toContainText('Session log missing');
    await expect(page.locator('[data-task-id="long-1"]')).not.toContainText('Session log');
    // The card stays usable while it reports the state.
    await expect(unreadableCard.getByRole('button', { name: 'Open task Long column task 0' })).toBeEnabled();

    // One diagnosis in the conversation: cause and artifact behind Details, never a retry instruction.
    const chat = page.locator('[data-conversation="ordinary"]');
    await expect(chat.getByRole('alert')).toHaveCount(1);
    await expect(chat).toContainText('Session log unreadable');
    await expect(chat).toContainText('The stored log cannot be validated');
    await expect(page.getByText(/Close and reopen/)).toHaveCount(0);
    await chat.getByText('Details').click();
    await expect(chat).toContainText('PTC dispatch repeats subCallId');
    await expect(chat).toContainText('/dsh/sessions/p/session-s-long-0/session.v4.jsonl.zstd');
    await expect(chat.getByRole('button', { name: 'Copy log path' })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Recheck' })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Repair…' })).toBeVisible();

    await expectLegible(page, '[data-task-id="long-0"] .kb-card-status-line.is-danger');
    await expectLegible(page, '[data-conversation="ordinary"] .kbdx-advice');

    await page.screenshot({ path: path.join(OUT, 'session-diagnosis-' + scheme + '.png'), fullPage: true });
  }
});

test('rechecking a repaired conversation clears the diagnosis in place', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=session-diagnosis&recovered=1');
  // The board already reflects the repaired log: no card carries the state.
  await expect(page.locator('[data-task-id="long-0"]')).not.toContainText('Session log unreadable');
  const chat = page.locator('[data-conversation="ordinary"]');
  await expect(chat).toContainText('Session log unreadable');
  await chat.getByRole('button', { name: 'Recheck' }).click();
  await expect(chat).toContainText('Session log readable again');
  await expect(chat).not.toContainText('Session log unreadable');
  await expect(chat.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT, 'session-diagnosis-recovered-light.png'), fullPage: true });
});

test('repair asks before writing, and cancelling writes nothing', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=session-diagnosis');
  const chat = page.locator('[data-conversation="ordinary"]');
  await chat.getByRole('button', { name: 'Repair…' }).click();
  // The confirmation states what the write does before it happens.
  await expect(chat).toContainText('keeps the original as a backup');
  await expect(chat.getByRole('button', { name: 'Repair this log' })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await chat.getByRole('button', { name: 'Cancel' }).click();
  await expect(chat.getByRole('button', { name: 'Repair…' })).toBeVisible();
  await expect(chat).toContainText('Session log unreadable');
  // Nothing was written: the repair port was never called.
  expect(await repairCalls(page)).toBe(0);
});

test('a confirmed repair reports the applied result and its backup', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=session-diagnosis&recovered=1');
  const chat = page.locator('[data-conversation="ordinary"]');
  await chat.getByRole('button', { name: 'Repair…' }).click();
  await chat.getByRole('button', { name: 'Repair this log' }).click();
  await expect(chat).toContainText('Session log readable again');
  await expect(chat).toContainText('/dsh/session-repair-backups/kanban/s-long-0/stamp/session.v4.jsonl.zstd');
  expect(await repairCalls(page)).toBe(1);
  await page.screenshot({ path: path.join(OUT, 'session-diagnosis-repaired-light.png'), fullPage: true });
});
