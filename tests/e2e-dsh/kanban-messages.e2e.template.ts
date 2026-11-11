// Plugin-owned real-composition scenarios for cross-card messages. The runner
// copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it afterward.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SessionId } from '@deepseek-ai/dsh-session';
import { launchWebScaffold, type WebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;

async function visible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
}
async function expectText(locator: Locator, expected: string): Promise<void> {
  await expect.poll(async () => (await locator.textContent()) ?? '').toContain(expected);
}
async function expectCount(locator: Locator, expected: number): Promise<void> {
  await expect.poll(() => locator.count()).toBe(expected);
}

async function openKanban(page: Page, scaffold: WebScaffold): Promise<void> {
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
}

async function createProject(page: Page, scaffold: WebScaffold): Promise<void> {
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await dialog.getByRole('textbox', { name: 'Project path' }).fill(scaffold.workspaceCwd);
  await dialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await visible(dialog.getByText('No Git repository found'));
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
}

async function createTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByRole('combobox').selectOption({ label: 'Harness' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  await expect.poll(async () => page.getByRole('tab', { name: 'Conversations' }).getAttribute('aria-selected')).toBe('true');
}

async function closeDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expectCount(page.locator('.kb-drawer'), 0);
}

async function createTaskWithConversation(page: Page, title: string): Promise<string> {
  await createTask(page, title);
  const cards = page.locator('.kb-drawer .kb-preset-cards');
  await visible(cards);
  await cards.getByRole('button', { name: /^PTC mode/ }).first().click();
  await visible(page.locator('.kb-drawer [data-kanban-conversation-window]'));
  const tabId = await page.locator('.kb-agent-tabs [role="tab"][aria-selected="true"]').first().getAttribute('id');
  const raw = tabId?.split('-tab-').at(-1);
  if (raw === undefined) throw new Error('conversation tab id is unavailable');
  await closeDrawer(page);
  return raw;
}

async function createTaskWithoutConversation(page: Page, title: string): Promise<void> {
  await createTask(page, title);
  await closeDrawer(page);
}

async function runTool<T = unknown>(scaffold: WebScaffold, name: string, args: Record<string, unknown>, sessionId: string): Promise<T> {
  const definition = scaffold.ctx.tools.get(name) as ToolDefinition | undefined;
  if (definition === undefined) throw new Error('tool ' + name + ' is not registered');
  const execution = {
    callId: 'e2e-' + name + '-call',
    rootCallId: 'e2e-' + name + '-call',
    token: 'e2e-' + name + '-token',
    signal: new AbortController().signal,
    agent: { id: SessionId(sessionId) },
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext;
  return definition.execute(args, execution) as Promise<T>;
}

async function launch(): Promise<{ scaffold: WebScaffold; page: Page; browser: Browser }> {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await openKanban(page, scaffold);
  await createProject(page, scaffold);
  return { scaffold, page, browser };
}

async function targetTask(scaffold: WebScaffold, senderSession: string): Promise<{ id: string; title: string }> {
  const cards = await runTool<Array<{ id: string; title: string }>>(scaffold, 'list_cards', {}, senderSession);
  const target = cards.find(card => card.title === 'Message target' || card.title === 'First target');
  if (target === undefined) throw new Error('the target task is not listed');
  return target;
}

it('delivers a cross-card message into an open target conversation and renders its row', { timeout: 120_000 }, async () => {
  const launched = await launch();
  const { scaffold, page, browser } = launched;
  onTestFinished(async () => { try { await browser.close(); } finally { await scaffold.close(); } });

  const senderSession = await createTaskWithConversation(page, 'Message sender');
  const targetSession = await createTaskWithConversation(page, 'Message target');
  const target = await targetTask(scaffold, senderSession);

  const result = await runTool<{ delivered: boolean; target: { taskId: string; sessionId: string } }>(scaffold, 'send_task_message', {
    task_id: target.id,
    message: 'Please reply with the deployment window.',
  }, senderSession);
  expect(result.delivered).toBe(true);
  expect(result.target.sessionId).toBe(targetSession);

  await page.getByRole('button', { name: 'Open task Message target' }).click();
  await visible(page.locator('.kb-drawer [data-kanban-conversation-window]'));
  const row = page.locator('[data-chat-flow-kind="kanban-task-message"]');
  await expectCount(row, 1);
  await visible(row);
  await expectText(row, 'Task message from Message sender');
  await row.getByRole('button').first().click();
  await expectText(row, 'deployment window');
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/messages-e2e-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/messages-e2e-dark.png') });
});

it('creates the target task first conversation before delivering', { timeout: 120_000 }, async () => {
  const launched = await launch();
  const { scaffold, page, browser } = launched;
  onTestFinished(async () => { try { await browser.close(); } finally { await scaffold.close(); } });

  const senderSession = await createTaskWithConversation(page, 'First sender');
  await createTaskWithoutConversation(page, 'First target');
  const target = await targetTask(scaffold, senderSession);

  const result = await runTool<{ delivered: boolean; createdConversation: boolean; target: { taskId: string; sessionId: string } }>(scaffold, 'send_task_message', {
    task_id: target.id,
    message: 'The first conversation is ready.',
  }, senderSession);
  expect(result.delivered).toBe(true);
  expect(result.createdConversation).toBe(true);
  expect(result.target.sessionId.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Open task First target' }).click();
  const tabs = page.locator('.kb-agent-tabs [role="tab"]');
  await expect.poll(() => tabs.count()).toBeGreaterThan(0);
  await tabs.first().click();
  await visible(page.locator('.kb-drawer [data-kanban-conversation-window]'));
  const row = page.locator('[data-chat-flow-kind="kanban-task-message"]');
  await expectCount(row, 1);
  await visible(row);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/messages-first-conversation.png') });
});
