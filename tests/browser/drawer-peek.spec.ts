import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { contrastOf } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('presents an owned subagent as a transient peek inside the task drawer', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-peek');

  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toBeVisible();
  // The tab strip keeps listing only the task's conversations while the peek renders.
  const tabs = drawer.getByRole('tablist', { name: 'Agent conversations' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: /Agent 1/ })).toHaveAttribute('aria-selected', 'true');
  const peek = drawer.locator('[data-surface-mode="peek"]');
  await expect(peek).toBeVisible();
  await expect(peek).toHaveAttribute('data-native', 'child-subagent');
  // The peek fills the conversation area without adding plugin chrome above it.
  const panel = await drawer.locator('.kb-conversation-panel').boundingBox();
  const surface = await peek.boundingBox();
  expect(surface?.height).toBeGreaterThan(240);
  expect(surface?.width).toBe(panel?.width);
  await page.screenshot({ path: path.join(OUT, 'drawer-subagent-peek-light.png') });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await expect(peek).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'drawer-subagent-peek-dark.png') });
});

test('reports a claimed branch while it attaches and when the host refuses it', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=drawer-peek&claim=pending');
  const drawer = page.locator('.kb-drawer');
  // The claim sits over the task's conversation, which is where it can happen.
  await expect(drawer.locator('[data-surface-mode="conversation"]')).toBeVisible();
  await expect(drawer.getByText('Attaching the branch…')).toBeVisible();
  await expect(drawer.getByRole('status').filter({ hasText: 'Attaching the branch…' })).toBeVisible();
  expect(await contrastOf(page, '.kb-claim-pending')).toBeGreaterThan(4.5);
  await page.screenshot({ path: path.join(OUT, 'drawer-claim-pending-light.png') });

  await page.goto(HARNESS + '?scenario=drawer-peek&claim=failed');
  const title = drawer.getByText('Branch not added');
  await expect(title).toBeVisible();
  // The alert carries the reason only, and the actions live next to it.
  const alert = drawer.getByRole('alert');
  await expect(alert).toHaveText('The task stayed busy while the branch was attached. Try again.');
  await expect(drawer.getByRole('button', { name: 'Open in main chat' })).toBeVisible();
  expect(await contrastOf(page, '.kb-claim-title')).toBeGreaterThan(4.5);
  expect(await contrastOf(page, '.kb-claim-notice .kb-error span')).toBeGreaterThan(4.5);
  await page.screenshot({ path: path.join(OUT, 'drawer-claim-failed-light.png') });
  await drawer.getByRole('button', { name: 'Dismiss' }).click();
  await expect(title).toHaveCount(0);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(HARNESS + '?scenario=drawer-peek&claim=failed');
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
  await expect(drawer.getByText('Branch not added')).toBeVisible();
  expect(await contrastOf(page, '.kb-claim-title')).toBeGreaterThan(4.5);
  await page.screenshot({ path: path.join(OUT, 'drawer-claim-failed-dark.png') });
});
