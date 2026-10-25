// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
import { realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;

it('creates a second Hub and board and keeps their cards isolated', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await page.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await page.getByRole('textbox', { name: 'Git root' }).fill(scaffold.workspaceCwd);
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'Create Hub' }).click();
  await page.getByRole('dialog', { name: 'Create Hub' }).getByRole('textbox', { name: 'Hub name' }).fill('Second Hub');
  await page.getByRole('dialog', { name: 'Create Hub' }).getByRole('button', { name: 'Create Hub' }).click();
  await expect(page.getByRole('tab', { name: 'Second Hub' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.kb-empty').getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('textbox', { name: 'Board name' }).fill('Second board');
  await page.getByRole('dialog', { name: 'Create board' }).getByRole('button', { name: 'Create board', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Second board' })).toBeVisible();

  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await page.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await page.getByRole('textbox', { name: 'Git root' }).fill(scaffold.workspaceCwd);
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  const workspaceRoot = await realpath(scaffold.workspaceCwd);
  const sessionsBefore = scaffold.ctx.sessions.list().length;
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Second hub task');
  await page.getByLabel('Project').selectOption({ label: 'Harness' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task Second hub task' })).toBeVisible();
  await expect.poll(() => scaffold.ctx.sessions.list().length, { timeout: 20_000 }).toBeGreaterThan(sessionsBefore);
  expect(scaffold.ctx.sessions.list().filter(session => session.header.cwd === workspaceRoot).length).toBeGreaterThan(0);

  await page.getByRole('tab', { name: 'My Hub' }).click();
  await expect(page.getByRole('button', { name: 'Open task Second hub task' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Second Hub' }).click();
  await expect(page.getByRole('button', { name: 'Open task Second hub task' })).toBeVisible();
});
