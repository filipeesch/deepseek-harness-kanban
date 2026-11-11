// Plugin-owned real-composition scenario for the task's recorded flow. The runner
// copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it afterward.
import { execFileSync } from 'node:child_process';
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
const OUT = join(KANBAN_ROOT, '.verification');

/** Two stages configure transitions, so a recorded destination and its clearing are exercisable. */
const WORKFLOW = [
  'name: Recorded flow',
  'initial_column: backlog',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '    allowed_transitions: [plan, in_progress, done]',
  '  - id: plan',
  '    label: Plan',
  '    allowed_transitions: [backlog, in_progress, done]',
  '  - id: in_progress',
  '    label: In Progress',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

async function visible(locator: Locator): Promise<void> { await locator.waitFor({ state: 'visible' }); }
async function expectText(locator: Locator, expected: string): Promise<void> {
  await expect.poll(async () => (await locator.textContent()) ?? '').toContain(expected);
}

async function openKanban(page: Page, scaffold: WebScaffold): Promise<void> {
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
}

async function registerProject(page: Page, name: string, projectPath: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
  await dialog.getByRole('textbox', { name: 'Project path' }).fill(projectPath);
  await dialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await visible(page.getByText('Project saved.'));
}

async function authorWorkflow(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(WORKFLOW);
  await expect.poll(() => page.getByRole('button', { name: 'Save workflow' }).isEnabled()).toBe(true);
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await visible(page.getByText('Workflow saved.'));
}

async function createTask(page: Page, title: string, project: string): Promise<void> {
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByRole('combobox').selectOption({ label: project });
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await visible(page.getByRole('button', { name: 'Open task ' + title }));
}

async function openHistory(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
  await visible(page.locator('.kb-history'));
}

function rows(page: Page): Locator { return page.locator('.kb-history tbody tr'); }

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

async function listedTaskId(scaffold: WebScaffold, sessionId: string): Promise<string> {
  const listed = await runTool<Array<{ id: string }>>(scaffold, 'list_cards', { query: 'Recorded flow', limit: 1 }, sessionId);
  const id = listed[0]?.id;
  if (id === undefined) throw new Error('the recorded task is not listed');
  return id;
}

async function launch(): Promise<{ scaffold: WebScaffold; page: Page; browser: Browser }> {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await openKanban(page, scaffold);
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await registerProject(page, 'Harness', scaffold.workspaceCwd);
  // A real Git repository, so the worktree outcome is recorded by the real coordinator.
  const gitRoot = join(scaffold.workspaceCwd, 'repo');
  await mkdir(gitRoot, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', gitRoot]);
  execFileSync('git', ['-C', gitRoot, '-c', 'user.email=e2e@example.test', '-c', 'user.name=E2E', 'commit', '-q', '--allow-empty', '-m', 'Initial commit']);
  await registerProject(page, 'Repo', gitRoot);
  await authorWorkflow(page);
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  return { scaffold, page, browser };
}

it('records creation, stage entries, auto mode, a recorded destination, and a worktree outcome', { timeout: 240_000 }, async () => {
  const { scaffold, page, browser } = await launch();
  onTestFinished(async () => { try { await browser.close(); } finally { await scaffold.close(); } });

  await createTask(page, 'Recorded flow', 'Harness');
  await openHistory(page, 'Recorded flow');
  await expect.poll(() => rows(page).count()).toBe(1);
  await expectText(rows(page).first(), 'Created');
  await expectText(rows(page).first(), 'Backlog');

  // A conversation is the session the transition tools run in; it sends nothing.
  await page.locator('.kb-drawer').getByRole('tab', { name: 'Conversations' }).click();
  await page.locator('.kb-drawer .kb-preset-cards').getByRole('button', { name: /^PTC mode/ }).first().click();
  await visible(page.locator('.kb-drawer [data-kanban-conversation-window]'));
  const tabId = await page.locator('.kb-agent-tabs [role="tab"][aria-selected="true"]').first().getAttribute('id');
  const sessionId = tabId?.split('-tab-').at(-1);
  if (sessionId === undefined) throw new Error('conversation tab id is unavailable');

  // Move one stage from the drawer's stage control, then read the entry back.
  await page.getByRole('combobox', { name: 'Move task to' }).selectOption({ label: 'Plan' });
  await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
  await expect.poll(() => rows(page).count()).toBe(2);
  await expectText(rows(page).first(), 'Stage changed');
  await expectText(rows(page).first(), 'Backlog \u2192 Plan');
  await expectText(rows(page).first(), 'min');
  await expectText(rows(page).last(), 'Created');

  // Auto mode is a settled change; the record gains one row.
  await page.locator('.kb-drawer .kb-auto-chip').click();
  await expect.poll(() => rows(page).count()).toBe(3);
  await expectText(rows(page).first(), 'Auto mode enabled');

  // A pause the agent requests is its own settled fact, with the reason it gave.
  await runTool(scaffold, 'pause_task', { task_id: await listedTaskId(scaffold, sessionId), reason: 'Review the diff' }, sessionId);
  await expect.poll(() => rows(page).count()).toBe(4);
  await expectText(rows(page).first(), 'Task paused');
  await expectText(rows(page).first(), 'Requested by the agent: Review the diff');

  // A recorded destination is an intention; clearing it records nothing.
  const taskId = await listedTaskId(scaffold, sessionId);
  await runTool(scaffold, 'set_next_transition', { task_id: taskId, column_id: 'done' }, sessionId);
  await expect.poll(() => rows(page).count()).toBe(5);
  await expectText(rows(page).first(), 'Next stage recorded');
  await expectText(rows(page).first(), 'Plan \u2192 Done');
  await runTool(scaffold, 'set_next_transition', { task_id: taskId }, sessionId);
  await page.waitForTimeout(1000);
  expect(await rows(page).count()).toBe(5);

  await mkdir(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(OUT, 'history-e2e-' + scheme + '.png') });
  }
  await page.getByRole('button', { name: 'Close task details' }).click();

  // The worktree outcome is recorded by the real coordinator when it settles.
  await createTask(page, 'Recorded checkout', 'Repo');
  await page.getByRole('button', { name: 'Open task Recorded checkout' }).click();
  const notice = page.locator('.kb-drawer').getByRole('note', { name: 'Worktree not created' });
  await visible(notice);
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await expect.poll(async () => await notice.count()).toBe(0);
  await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
  await visible(page.locator('.kb-history'));
  await expect.poll(() => rows(page).count()).toBe(2);
  await expectText(rows(page).first(), 'Worktree created');
  await expectText(rows(page).first(), 'recorded-checkout');

  // The record is durable: closing and reopening the drawer keeps every row.
  await page.getByRole('button', { name: 'Close task details' }).click();
  await page.getByRole('button', { name: 'Open task Recorded checkout' }).click();
  await page.locator('.kb-drawer').getByRole('tab', { name: 'History' }).click();
  await expect.poll(() => rows(page).count()).toBe(2);
});
