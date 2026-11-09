// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;

it('creates a schedule and runs one occurrence from the Schedules section', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: 'New schedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'New schedule' });
  await expect(dialog.getByText('Every day at 09:00')).toBeVisible();
  await dialog.getByLabel('Schedule title').fill('Harness schedule');
  await dialog.getByLabel('Prompt').fill('Summarize the workspace.');
  await dialog.getByLabel('Project').selectOption({ label: 'Harness' });
  await dialog.getByLabel('Cron expression').fill('30 22 * * *');
  await expect(dialog.getByText('Every day at 22:30')).toBeVisible();
  // Keep the conversation visible so the run can be observed without racing its archive.
  await dialog.getByLabel('Archive when idle').uncheck();
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Harness schedule')).toBeVisible();
  await expect(page.getByText(/Every day at 22:30/)).toBeVisible();

  async function eventsText(sessionId: string): Promise<string> {
    const observation = await scaffold.ctx.sessionQuery.observeSession(sessionId as never, { signal: AbortSignal.timeout(10_000), projectionMode: 'none' });
    try { return JSON.stringify(observation.events); } finally { observation[Symbol.dispose](); }
  }
  const before = new Set(scaffold.ctx.sessions.list().map(session => session.id));
  await page.getByRole('button', { name: 'Run schedule Harness schedule now' }).click();
  await expect(page.getByText(/Last run sent/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => scaffold.ctx.sessions.list().length, { timeout: 20_000 }).toBe(before.size + 1);
  const created = scaffold.ctx.sessions.list().filter(session => !before.has(session.id));
  expect(created).toHaveLength(1);
  const sessionId = created[0]!.id;
  expect(created[0]!.header.cwd).toBe(await realpath(scaffold.workspaceCwd));
  expect(await eventsText(sessionId)).toContain('Summarize the workspace.');
  await expect.poll(() => eventsText(sessionId), { timeout: 20_000 }).toContain('no replay fixture');
  await expect(page.getByText('Harness schedule')).toBeVisible();
});