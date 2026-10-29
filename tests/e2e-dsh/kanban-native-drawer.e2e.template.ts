// Plugin-owned real-composition scenarios for the native drawer shell.
// Copied into $DSH_CHECKOUT/apps/web/tests/ by scripts/e2e-dsh.mjs.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay';
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const TASK_CONTEXT_FIXTURE = process.env.KANBAN_TASK_CONTEXT_FIXTURE
  ?? join(KANBAN_ROOT, 'tests/e2e-dsh/task-context.jsonl');
const BASE_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url));

function rootFixture(): string {
  const at = 1784998084442;
  return [
    JSON.stringify({ type: 'session', version: 4, id: '00000000-0000-4000-8000-000000000001', createdAt: at, cwd: process.cwd(), isSeeded: false, delegationDepth: 0 }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: at, data: { turn: 1 } }),
    JSON.stringify({ type: 'turn/end', seq: 1, time: at + 1, data: { turn: 1, reason: { kind: 'completed' } } }),
    '',
  ].join('\n');
}

function childFixture(source: string, fixtureId: string): string {
  const [header, ...eventLines] = source.trimEnd().split('\n');
  if (header === undefined) throw new Error('base replay fixture has no header');
  const childHeaderValue = JSON.parse(header) as Record<string, unknown>;
  childHeaderValue.id = fixtureId;
  childHeaderValue.createdAt = 1784998084442;
  const childHeader = JSON.stringify(childHeaderValue);
  const seqOffset = eventLines.length;
  const continued = eventLines.map(line => {
    const event = JSON.parse(line) as { type: string; seq: number; data: Record<string, unknown> };
    const data = { ...event.data };
    if (data.turn === 1) data.turn = 2;
    if (event.type === 'session/title' && Array.isArray(data.messageSeqs)) {
      data.messageSeqs = data.messageSeqs.map(seq => typeof seq === 'number' ? seq + seqOffset : seq);
    }
    return JSON.stringify({ ...event, seq: event.seq + seqOffset, data });
  });
  return [childHeader, ...eventLines, ...continued, ''].join('\n');
}

async function waitForAgentToSettle(scaffold: WebScaffold, id: SessionId): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (scaffold.ctx.agents.get(id) !== undefined) {
    if (Date.now() >= deadline) throw new Error(`subagent ${id} did not settle`);
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
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
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  await expect(page.getByRole('tab', { name: 'Conversations' })).toHaveAttribute('aria-selected', 'true');
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

it('hosts the native session header and selects a mode per blank conversation', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] }, developerTools: true });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await page.addInitScript(() => { try { localStorage.setItem('dsh-kanban.drawer.width', '360'); } catch { /* storage is optional */ } });
  await createProjectAndTask(page, scaffold, 'Native header task');

  const drawer = page.locator('.kb-drawer');
  const header = drawer.locator('.kb-native-session-header');
  await expect(header).toBeVisible();
  await expect(drawer.locator('.kb-conversation-status')).toHaveCount(0);
  await expect(drawer.locator('[data-window-drag]')).toHaveCount(0);
  await expect(drawer.locator('[data-conversation-tabs]')).toHaveCount(0);
  await expect(drawer.locator('[data-sidebar-right-expand]')).toHaveCount(0);
  expect(await header.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const firstId = await parentSessionId(page);
  const firstChip = header.getByRole('button', { name: /Standard/ }).first();
  await expect(firstChip).toBeVisible();
  await firstChip.click();
  await page.getByRole('menuitem', { name: /PTC/ }).click();
  await expect.poll(() => presetOf(scaffold, firstId), { timeout: 20_000 }).toBe('ptc');
  await expect(header).toContainText('PTC mode');

  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.locator('.kb-agent-tabs [role="tab"]')).toHaveCount(2);
  const secondId = await parentSessionId(page);
  const secondChip = header.getByRole('button', { name: /Standard/ }).first();
  await expect(secondChip).toBeVisible();
  await secondChip.click();
  await page.getByRole('menuitem', { name: /Standard/ }).click();
  await expect.poll(() => presetOf(scaffold, secondId), { timeout: 20_000 }).toBe('standard');
  expect(await presetOf(scaffold, firstId)).toBe('ptc');

  await page.locator('.kb-agent-tabs [role="tab"]').first().click();
  await expect(header).toContainText('PTC mode');
  await page.locator('.kb-agent-tabs [role="tab"]').nth(1).click();
  await expect(header).toContainText('Standard mode');

  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(drawer.locator('.kb-native-session-header')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Conversations' }).click();
  await expect(header).toBeVisible();
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-mode.png') });
}, 90_000);

it('opens a subagent in the drawer and returns through the native breadcrumb', async () => {
  const sidecarRoot = await mkdtemp(join(tmpdir(), 'dsh-kanban-native-drawer-'));
  const rootPath = join(sidecarRoot, 'root.jsonl');
  const childPath = join(sidecarRoot, 'child.jsonl');
  await writeFile(rootPath, rootFixture());
  const preparedBase = prepareSessionSnapshotFixtureForComparison(await readFile(BASE_FIXTURE, 'utf8'));
  await writeFile(childPath, childFixture(preparedBase, 'kanban-native-drawer-child'));
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: rootPath,
    compareReplaySession: false,
    replayChildFixtures: [childPath],
  });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { try { await scaffold.close(); } finally { await rm(sidecarRoot, { recursive: true, force: true }); } } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await createProjectAndTask(page, scaffold, 'Native peek task');
  const parentId = await parentSessionId(page);
  await expect.poll(() => scaffold.ctx.agents.get(parentId), { timeout: 20_000 }).not.toBeUndefined();
  await scaffold.ctx.sessionController.rename({ sessionId: parentId, title: 'Parent agent' });
  const parent = scaffold.ctx.agents.get(parentId)!;
  const started = await scaffold.ctx.subagents.startActivation({
    delivery: 'parent',
    provider: 'spawn',
    label: 'Native child',
    signal: new AbortController().signal,
    request: { prompt: [{ type: 'text', text: 'Reply with one sentence.' }], parent },
  });
  const childId = started.childId;
  await waitForAgentToSettle(scaffold, childId);
  await scaffold.ctx.sessionController.rename({ sessionId: childId, title: 'Native child' });

  const drawer = page.locator('.kb-drawer');
  const header = drawer.locator('.kb-native-session-header');
  const catalog = header.getByRole('button', { name: /subagent/i }).first();
  await expect.poll(() => catalog.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await catalog.click();
  const tree = page.getByRole('tree');
  await expect(tree).toBeVisible();
  const childRow = tree.getByRole('treeitem').first();
  await childRow.click();
  await expect(header).toContainText('Native child');
  await expect(header.getByRole('button', { name: /Standard mode|PTC mode|Minimal mode/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Kanban' })).toBeVisible();
  await expect(page.locator('.kb-agent-tabs [role="tab"]')).toHaveCount(1);
  await expect(header.getByRole('button', { name: 'Parent agent' })).toBeVisible();
  await header.getByRole('button', { name: 'Parent agent' }).click();
  await expect(header).toContainText('Parent agent');
  await expect(page.locator('.kb-agent-tabs [role="tab"]')).toHaveCount(1);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-peek.png') });
}, 120_000);

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
  await page.getByText('Task context fixture', { exact: true }).click();

  const row = page.locator('[data-chat-flow-kind="kanban-task-context"]');
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  expect(await row.evaluate(element => element.closest('[data-chat-flow]') !== null)).toBe(true);
  expect(await row.evaluate(element => getComputedStyle(element).position)).not.toBe('absolute');
  await expect(row.locator('[data-context-source]')).toHaveText('kanban-task');
  await expect(page.locator('.kb-task-context')).toHaveCount(0);
  await row.getByRole('button').first().click();
  await expect(row).toContainText('Task: Seeded task');
  await page.reload({ waitUntil: 'load' });
  await page.getByText('Task context fixture', { exact: true }).click();
  await expect(page.locator('[data-chat-flow-kind="kanban-task-context"]')).toHaveCount(1);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-task-context.png') });
}, 90_000);
