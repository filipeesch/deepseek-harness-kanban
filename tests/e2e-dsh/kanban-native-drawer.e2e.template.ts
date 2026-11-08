// Plugin-owned real-composition scenarios for the native drawer shell.
// Copied into $DSH_CHECKOUT/apps/web/tests/ by scripts/e2e-dsh.mjs.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const TASK_CONTEXT_FIXTURE = process.env.KANBAN_TASK_CONTEXT_FIXTURE
  ?? join(KANBAN_ROOT, 'tests/e2e-dsh/task-context.jsonl');

/** The checkout's Vitest 4 runner registers no Playwright matchers; wait and poll instead. */
async function visible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
}
async function expectText(locator: Locator, expected: string): Promise<void> {
  await expect.poll(async () => (await locator.textContent()) ?? '').toContain(expected);
}
async function expectCount(locator: Locator, expected: number): Promise<void> {
  await expect.poll(() => locator.count()).toBe(expected);
}

async function createProjectAndTask(page: Awaited<ReturnType<typeof newEnglishPage>>, scaffold: WebScaffold, title: string): Promise<void> {
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(projectDialog.getByText('No Git repository found'));
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByRole('combobox').selectOption({ label: 'Harness' });
  await taskDialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  await expect.poll(async () => page.getByRole('tab', { name: 'Conversations' }).getAttribute('aria-selected')).toBe('true');
}

async function parentSessionId(page: Awaited<ReturnType<typeof newEnglishPage>>): Promise<SessionId> {
  const tabId = await page.locator('.kb-agent-tabs [role="tab"][aria-selected="true"]').first().getAttribute('id');
  const raw = tabId?.split('-tab-').at(-1);
  if (raw === undefined) throw new Error('task conversation tab id is unavailable');
  return SessionId(raw);
}

async function presetOf(scaffold: WebScaffold, sessionId: SessionId): Promise<string | undefined> {
  const projection = await scaffold.ctx.sessionController.projections({ sessionId }, new AbortController().signal);
  return projection?.kind === 'sequenced' && typeof projection.values.agentPreset === 'string'
    ? projection.values.agentPreset
    : undefined;
}

it('hosts the native conversation window and starts conversations from preset cards', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] }, developerTools: true });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await page.addInitScript(() => { try { localStorage.setItem('dsh-kanban.drawer.width', '360'); } catch { /* storage is optional */ } });
  await createProjectAndTask(page, scaffold, 'Native header task');

  const drawer = page.locator('.kb-drawer');
  const cards = drawer.locator('.kb-preset-cards');
  await visible(cards);
  await expectCount(drawer.locator('[data-kanban-conversation-window]'), 0);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-presets.png') });

  const firstCard = drawer.getByRole('button', { name: /^PTC mode/ }).first();
  await visible(firstCard);
  await firstCard.click();
  const window = drawer.locator('[data-kanban-conversation-window]');
  const header = drawer.locator('[data-conversation-header-embedded]');
  await visible(window);
  await visible(header);
  await expectCount(header.locator('[data-conversation-header-corner]'), 1);
  await expectCount(drawer.locator('[data-window-drag]'), 0);
  await expectCount(drawer.locator('[data-sidebar-right-expand]'), 1);
  expect(await header.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const firstId = await parentSessionId(page);
  await expect.poll(() => presetOf(scaffold, firstId), { timeout: 20_000 }).toBe('ptc');
  await visible(drawer.getByRole('button', { name: 'Close Agent 1' }));

  await page.getByRole('button', { name: 'New conversation' }).click();
  await visible(cards);
  const secondCard = drawer.getByRole('button', { name: /^Standard mode/ }).first();
  await visible(secondCard);
  await secondCard.click();
  await expectCount(page.locator('.kb-agent-tabs [role="tab"]'), 2);
  const secondId = await parentSessionId(page);
  await expect.poll(() => presetOf(scaffold, secondId), { timeout: 20_000 }).toBe('standard');
  expect(await presetOf(scaffold, firstId)).toBe('ptc');

  await page.locator('.kb-agent-tabs [role="tab"]').first().click();
  await visible(drawer.getByRole('button', { name: 'Close Agent 1' }));
  await page.locator('.kb-agent-tabs [role="tab"]').nth(1).click();
  await visible(drawer.getByRole('button', { name: 'Close Agent 2' }));

  await page.getByRole('tab', { name: 'Info' }).click();
  await expectCount(drawer.locator('[data-kanban-conversation-window]'), 0);
  await page.getByRole('tab', { name: 'Conversations' }).click();
  await visible(window);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-window-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-window-dark.png') });
}, 90_000);

it('renders the seeded task-context message as an inline native Chat row', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  const sessionId = await seedSession(scaffold, await readFile(TASK_CONTEXT_FIXTURE, 'utf8'), 'kanban-task-context-e2e');
  await scaffold.ctx.sessionController.rename({ sessionId, title: 'Task context fixture' });
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd);
  await workspace.attachSession(sessionId);
  await page.reload({ waitUntil: 'load' });
  await page.getByLabel('Sessions', { exact: true }).getByText('Task context fixture', { exact: true }).click();

  const row = page.locator('[data-chat-flow-kind="kanban-task-context"]');
  await expectCount(row, 1);
  await visible(row);
  expect(await row.evaluate(element => element.closest('[data-chat-flow]') !== null)).toBe(true);
  expect(await row.evaluate(element => getComputedStyle(element).position)).not.toBe('absolute');
  await expectText(row.locator('[data-context-source]'), 'kanban-task');
  await expectCount(page.locator('.kb-task-context'), 0);
  await row.getByRole('button').first().click();
  await expectText(row, 'Task: Seeded task');
  await page.reload({ waitUntil: 'load' });
  await page.getByLabel('Sessions', { exact: true }).getByText('Task context fixture', { exact: true }).click();
  await expectCount(page.locator('[data-chat-flow-kind="kanban-task-context"]'), 1);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-task-context.png') });
}, 90_000);
