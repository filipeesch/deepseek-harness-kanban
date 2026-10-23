// Plugin-owned real-composition deletion scenario for the manual DSH e2e lane.
// The runner copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it
// after the pinned web lane runs.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent';
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay';
import { launchWebScaffold, readPersistedEvents, type WebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const exec = promisify(execFile);
const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const BASE_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url));
const TASK_TITLE = 'Worktree task';
const BRANCH = 'worktree-task';

// The primary fixture installs the replay seam but records no model calls, so the
// child fixture is the only replay script and binds to the child without a parent turn.
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

async function events(scaffold: WebScaffold, id: SessionId) {
  return await readPersistedEvents(scaffold, id) as Array<{ type: string; data: any }>;
}

it('deletes a task whose own deterministic subagent child uses the worktree', async () => {
  const sidecarRoot = await mkdtemp(join(tmpdir(), 'dsh-kanban-deletion-'));
  const rootPath = join(sidecarRoot, 'root.jsonl');
  const childPath = join(sidecarRoot, 'child.jsonl');
  await writeFile(rootPath, rootFixture());
  const preparedBase = prepareSessionSnapshotFixtureForComparison(await readFile(BASE_FIXTURE, 'utf8'));
  await writeFile(childPath, childFixture(preparedBase, 'kanban-deletion-child'));
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: rootPath,
    compareReplaySession: false,
    replayChildFixtures: [childPath],
  });
  let browser: Browser | undefined;
  onTestFinished(async () => {
    try { await browser?.close(); } finally { try { await scaffold.close(); } finally { await rm(sidecarRoot, { recursive: true, force: true }); } }
  });

  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;
  const basePath = join(repository, '..', 'kanban-worktrees');
  await mkdir(basePath, { recursive: true });
  await writeFile(join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('textbox', { name: 'Worktree base path' }).fill(basePath);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await page.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await page.getByRole('textbox', { name: 'Git root' }).fill(repository);
  await page.getByRole('textbox', { name: 'Default branch (optional)' }).fill('main');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill(TASK_TITLE);
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + TASK_TITLE }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await expect(notice).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('tab', { name: 'Conversations' })).toHaveAttribute('aria-selected', 'true');

  const worktreePath = join(basePath, BRANCH);
  await expect.poll(async () => existsSync(worktreePath), { timeout: 20_000 }).toBe(true);
  const canonicalWorktree = await realpath(worktreePath);
  // Existing conversations keep their creation workspace; the open drawer tab is the reliable parent identity.
  const parentTabId = await page.locator('.kb-agent-tabs [role="tab"]').first().getAttribute('id');
  const rawParentId = parentTabId?.split('-tab-').at(-1);
  if (rawParentId === undefined) throw new Error('task conversation tab id is unavailable');
  const parentId = SessionId(rawParentId);
  await expect.poll(() => scaffold.ctx.agents.get(parentId), { timeout: 20_000 }).not.toBeUndefined();
  const parent = scaffold.ctx.agents.get(parentId)!;
  const started = await scaffold.ctx.subagents.startActivation({
    delivery: 'parent',
    provider: 'spawn',
    label: 'Kanban deletion child',
    signal: new AbortController().signal,
    request: { prompt: [{ type: 'text', text: 'Reply with one sentence about the checkout.' }], parent },
  });
  const childId = started.childId;
  await waitForAgentToSettle(scaffold, childId);
  const childInspection = await scaffold.ctx.sessionController.inspect(childId, new AbortController().signal);
  expect(String(childInspection.meta.parentSession)).toBe(String(parentId));
  expect(childInspection.meta.origin).toBe('subagent');
  const childProjection = await scaffold.ctx.sessionController.projections({ sessionId: childId }, new AbortController().signal);
  const childDirectory = childProjection?.kind === 'sequenced' && typeof childProjection.values.workingDirectory === 'string' ? childProjection.values.workingDirectory : undefined;
  if (childDirectory === undefined) throw new Error('child working directory projection is unavailable');
  expect(await realpath(childDirectory)).toBe(canonicalWorktree);
  await expect(page.locator('.kb-agent-tabs [role="tab"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete task' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open task ' + TASK_TITLE })).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => existsSync(worktreePath), { timeout: 20_000 }).toBe(false);
  expect((await exec('git', ['show-ref', '--verify', 'refs/heads/' + BRANCH], { cwd: repository })).stdout).toContain('refs/heads/' + BRANCH);
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).toContain(parentId);
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(childId);

  // Keep the parent session resolvable while archived so the child prompt can
  // exercise the native archived-parent gate, not a parent-offline rejection.
  if (scaffold.ctx.agents.get(parentId) === undefined) {
    await scaffold.ctx.workspaceRegistry.unarchiveSession(parentId);
    await scaffold.ctx.sessionController.resolveAgent(parentId);
    await scaffold.ctx.workspaceRegistry.archiveSession(parentId);
  }
  await expect.poll(() => scaffold.ctx.agents.get(parentId), { timeout: 10_000 }).not.toBeUndefined();
  const beforeBlocked = await events(scaffold, childId);
  const beforeAssistants = beforeBlocked.filter(event => event.type === 'assistant/message').length;
  const beforeEnds = beforeBlocked.filter(event => event.type === 'turn/end').length;
  await scaffold.ctx.subagents.prompt({
    requestId: 'kanban-deletion-gate' as SubagentPromptRequestId,
    parentSessionId: parentId,
    childSessionId: childId,
    mode: 'continuable',
    delivery: 'queue',
    content: [{ type: 'text', text: 'This turn must be blocked by the archived parent.' }],
  }, new AbortController().signal);
  await expect.poll(async () => (await events(scaffold, childId)).filter(event => event.type === 'turn/end').length, { timeout: 30_000 }).toBeGreaterThan(beforeEnds);
  const blocked = await events(scaffold, childId);
  // The native gate rejects the step; no assistant/model message may be added.
  expect(blocked.filter(event => event.type === 'assistant/message').length).toBe(beforeAssistants);
  expect(blocked.filter(event => event.type === 'turn/end').at(-1)?.data.reason).toMatchObject({ kind: 'blocked' });

  await scaffold.ctx.workspaceRegistry.unarchiveSession(parentId);
  await scaffold.ctx.subagents.prompt({
    requestId: 'kanban-deletion-recover' as SubagentPromptRequestId,
    parentSessionId: parentId,
    childSessionId: childId,
    mode: 'continuable',
    delivery: 'queue',
    content: [{ type: 'text', text: 'Recover after the worktree was removed.' }],
  }, new AbortController().signal);
  await expect.poll(async () => (await events(scaffold, childId)).filter(event => event.type === 'assistant/message').length, { timeout: 30_000 }).toBeGreaterThan(beforeAssistants);
  await expect.poll(async () => {
    const projection = await scaffold.ctx.sessionController.projections({ sessionId: childId }, new AbortController().signal);
    const working = projection?.kind === 'sequenced' && typeof projection.values.workingDirectory === 'string' ? projection.values.workingDirectory : undefined;
    if (working === undefined) return '';
    try { return await realpath(working); } catch { return ''; }
  }, { timeout: 30_000 }).toBe(await realpath(scaffold.workspaceCwd));
}, 120_000);
