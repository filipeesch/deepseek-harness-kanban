// Plugin-owned real-composition lane for non-blocking destructive admission.
// The runner copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it
// after the pinned web lane runs. Native archiving is gated from the scaffold so
// the board is exercised while the deletion is still queued, and the assertions
// avoid the Playwright matchers because not every DSH web lane registers them.
import type { Browser, Locator } from 'playwright';
import { chromium } from 'playwright';
import { SessionId } from '@deepseek-ai/dsh-session';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const TASK_TITLE = 'Background delete';

/** The DSH web lane does not register the Playwright matchers in every version. */
async function visible(locator: Locator): Promise<boolean> {
  try { return await locator.first().isVisible(); } catch { return false; }
}

async function count(locator: Locator): Promise<number> {
  try { return await locator.count(); } catch { return 0; }
}

it('keeps the board usable while a deletion is still queued', async () => {
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    compareReplaySession: false,
  });
  let browser: Browser | undefined;
  onTestFinished(async () => {
    try { await browser?.close(); } finally { await scaffold.close(); }
  });

  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect.poll(() => count(projectDialog.getByText('Folder project')), { timeout: 20_000 }).toBeGreaterThan(0);
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect.poll(() => count(page.getByText('Project saved.')), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const firstTaskDialog = page.getByRole('dialog', { name: 'New task' });
  await firstTaskDialog.getByRole('textbox', { name: 'Title' }).fill(TASK_TITLE);
  await firstTaskDialog.getByRole('combobox').selectOption({ label: 'Harness' });
  await firstTaskDialog.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + TASK_TITLE }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  const tabId = await page.locator('.kb-agent-tabs [role="tab"]').first().getAttribute('id');
  const rawSessionId = tabId?.split('-tab-').at(-1);
  if (rawSessionId === undefined || rawSessionId === '') throw new Error('task conversation tab id is unavailable');
  const sessionId = SessionId(rawSessionId);

  // Gate native archiving so the deletion cannot finish while the board is exercised.
  const registry = scaffold.ctx.workspaceRegistry;
  const archiveSession = registry.archiveSession.bind(registry);
  let releaseArchive!: () => void;
  const archiveGate = new Promise<void>(resolve => { releaseArchive = resolve; });
  let archiving = false;
  registry.archiveSession = (async (id: SessionId) => { archiving = true; await archiveGate; return archiveSession(id); }) as typeof registry.archiveSession;

  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete task' });
  await expect.poll(() => visible(dialog), { timeout: 20_000 }).toBe(true);
  await dialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect.poll(() => visible(dialog), { timeout: 20_000 }).toBe(false);

  // The deletion reached its queued archiving step while the card stays on the board.
  await expect.poll(() => archiving, { timeout: 20_000 }).toBe(true);
  await expect.poll(() => count(page.getByRole('button', { name: 'Open task ' + TASK_TITLE })), { timeout: 20_000 }).toBe(1);

  // The board still accepts commands while the admitted deletion waits.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const secondTaskDialog = page.getByRole('dialog', { name: 'New task' });
  await secondTaskDialog.getByRole('textbox', { name: 'Title' }).fill('Board stays free');
  await secondTaskDialog.getByRole('combobox').selectOption({ label: 'Harness' });
  await secondTaskDialog.getByRole('button', { name: 'Create task' }).click();
  await expect.poll(() => visible(page.getByRole('button', { name: 'Open task Board stays free' })), { timeout: 20_000 }).toBe(true);

  releaseArchive();
  await expect.poll(() => count(page.getByRole('button', { name: 'Open task ' + TASK_TITLE })), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => registry.archivedSessionIds.includes(sessionId), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => visible(page.getByRole('button', { name: 'Open task Board stays free' })), { timeout: 20_000 }).toBe(true);
}, 90_000);
