// Plugin-owned real-composition deletion scenario for the manual DSH e2e lane.
// The runner copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it
// after the pinned web lane runs.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
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

// The child is the first session to issue a model call, so it binds the primary
// replay script. The parent never sends a model prompt.
function childFixture(source: string, fixtureId: string): string {
  const [header, ...eventLines] = source.trimEnd().split('\n');
  if (header === undefined) throw new Error('base replay fixture has no header');
  const childHeaderValue = JSON.parse(header) as Record<string, unknown>;
  childHeaderValue.id = fixtureId;
  childHeaderValue.createdAt = 1784998084442;
  const childHeader = JSON.stringify(childHeaderValue);
  // One recorded turn is enough: the interrupted continuation never reaches the
  // model, because the host reports the removed directory instead.
  return [childHeader, ...eventLines, ''].join('\n');
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
  const preparedBase = prepareSessionSnapshotFixtureForComparison(await readFile(BASE_FIXTURE, 'utf8'));
  await writeFile(rootPath, childFixture(preparedBase, 'kanban-deletion-child'));
  const worktreeRoot = await mkdtemp(join(tmpdir(), 'kanban-worktrees-'));
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: rootPath,
    compareReplaySession: false,
  });
  let browser: Browser | undefined;
  onTestFinished(async () => {
    try { await browser?.close(); } finally { try { await scaffold.close(); } finally { await rm(sidecarRoot, { recursive: true, force: true }); await rm(worktreeRoot, { recursive: true, force: true }); } }
  });

  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const repository = scaffold.workspaceCwd;
  const basePath = worktreeRoot;
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
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await projectDialog.getByText('Git repository').waitFor({ state: 'visible' });
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await page.getByText('Project saved.').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill(TASK_TITLE);
  await page.getByRole('dialog', { name: 'New task' }).getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + TASK_TITLE }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await notice.waitFor({ state: 'visible' });
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await notice.waitFor({ state: 'hidden', timeout: 20_000 });
  expect(await page.getByRole('tab', { name: 'Conversations' }).getAttribute('aria-selected')).toBe('true');
  await page.locator('.kb-preset-cards').getByRole('button', { name: /^Standard mode/ }).click();
  await page.locator('.kb-agent-tabs [role="tab"]').first().waitFor({ state: 'visible' });
  await page.locator('[data-kanban-conversation-window]').waitFor({ state: 'visible' });

  const worktreePath = join(basePath, BRANCH);
  await expect.poll(async () => existsSync(worktreePath), { timeout: 20_000 }).toBe(true);
  const canonicalWorktree = await realpath(worktreePath);
  // Existing conversations keep their creation workspace; the open drawer tab is the reliable parent identity.
  const parentTabId = await page.locator('.kb-agent-tabs [role="tab"]').first().getAttribute('id');
  const rawParentId = parentTabId?.split('-tab-').at(-1);
  if (rawParentId === undefined) throw new Error('task conversation tab id is unavailable');
  const parentId = SessionId(rawParentId);
  await expect.poll(() => scaffold.ctx.agents.get(parentId), { timeout: 20_000 }).not.toBeUndefined();
  await expect.poll(async () => {
    const projection = await scaffold.ctx.sessionController.projections({ sessionId: parentId }, new AbortController().signal);
    return projection?.kind === 'sequenced' ? projection.values.agentPreset : undefined;
  }, { timeout: 20_000 }).toBe('standard');
  const parent = scaffold.ctx.agents.get(parentId)!;
  const started = await scaffold.ctx.subagents.startActivation({
    delivery: 'parent',
    provider: 'spawn',
    label: 'Kanban deletion child',
    cwd: canonicalWorktree,
    signal: new AbortController().signal,
    prompt: [{ type: 'text', text: 'Reply with one sentence about the checkout.' }],
    parent,
  });
  const childId = started.childId;
  await waitForAgentToSettle(scaffold, childId);
  const childObservation = await scaffold.ctx.sessionQuery.observeSession(childId, { signal: new AbortController().signal });
  let childHeader;
  try {
    childHeader = childObservation.header;
  } finally {
    childObservation[Symbol.dispose]();
  }
  expect(String(childHeader.parentSession)).toBe(String(parentId));
  expect(childHeader.origin).toBe('subagent');
  const childProjection = await scaffold.ctx.sessionController.projections({ sessionId: childId }, new AbortController().signal);
  const childDirectory = childProjection?.kind === 'sequenced' && typeof childProjection.values.workingDirectory === 'string' ? childProjection.values.workingDirectory : undefined;
  if (childDirectory === undefined) throw new Error('child working directory projection is unavailable');
  expect(await realpath(childDirectory)).toBe(canonicalWorktree);
  await expect.poll(() => page.locator('.kb-agent-tabs [role="tab"]').count()).toBe(1);

  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete task' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  try { await expect.poll(() => page.getByRole('button', { name: 'Open task ' + TASK_TITLE }).count(), { timeout: 30_000 }).toBe(0); }
  catch (error) { const controller = scaffold.ctx.get('kanbanController') as any; const value = await controller.snapshot({}); const tasks = value.value?.state?.hubs?.flatMap((hub: any) => hub.tasks) ?? []; throw new Error('Deletion did not settle: ' + JSON.stringify(tasks.find((task: any) => task.title === TASK_TITLE)?.operation?.error), { cause: error }); }
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
  // The host reports the archived-parent denial as blocked or as an error depending on the pinned runtime.
  expect(['blocked', 'error']).toContain((blocked.filter(event => event.type === 'turn/end').at(-1)?.data.reason as { kind?: string } | undefined)?.kind);

  // The pinned host refuses to relocate a session owned by subagent routing, and a
  // task-owned descendant is deliberately neither archived nor moved. Its recorded
  // directory is therefore gone with the checkout, and a continuation reports that
  // diagnostic instead of silently switching directories. Recovery for such a child
  // needs a host that can relocate it; that is tracked as a native-host limitation.
  await scaffold.ctx.workspaceRegistry.unarchiveSession(parentId);
  await scaffold.ctx.subagents.prompt({
    requestId: 'kanban-deletion-recover' as SubagentPromptRequestId,
    parentSessionId: parentId,
    childSessionId: childId,
    mode: 'continuable',
    delivery: 'queue',
    content: [{ type: 'text', text: 'Report the state of this checkout.' }],
  }, new AbortController().signal);
  await expect.poll(async () => (await events(scaffold, childId)).filter(event => event.type === 'turn/end').length, { timeout: 30_000 }).toBeGreaterThan(beforeEnds + 1);
  const afterRemoval = await events(scaffold, childId);
  expect(afterRemoval.filter(event => event.type === 'assistant/message').length).toBe(beforeAssistants);
  const lastReason = afterRemoval.filter(event => event.type === 'turn/end').at(-1)?.data.reason as { kind?: string; error?: { message?: string } } | undefined;
  expect(lastReason?.kind).toBe('error');
  expect(lastReason?.error?.message).toContain('directory does not exist');
  const projection = await scaffold.ctx.sessionController.projections({ sessionId: childId }, new AbortController().signal);
  const working = projection?.kind === 'sequenced' && typeof projection.values.workingDirectory === 'string' ? projection.values.workingDirectory : undefined;
  expect(working).toBe(canonicalWorktree);
}, 120_000);

it('deletes a task after its project directory moved and retains the unverifiable checkout', async () => {
  const worktreeRoot = await mkdtemp(join(tmpdir(), 'kanban-retained-worktrees-'));
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  let browser: Browser | undefined;
  onTestFinished(async () => {
    try { await browser?.close(); } finally { try { await scaffold.close(); } finally { await rm(worktreeRoot, { recursive: true, force: true }); } }
  });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const repository = join(scaffold.workspaceCwd, 'repo');
  const movedRepository = join(scaffold.workspaceCwd, 'repo-moved');
  await mkdir(repository, { recursive: true });
  const title = 'Retained checkout task';
  const branch = 'retained-checkout-task';
  await writeFile(join(repository, 'tracked.txt'), 'tracked\n');
  await exec('git', ['init', '-b', 'main'], { cwd: repository });
  await exec('git', ['add', 'tracked.txt'], { cwd: repository });
  await exec('git', ['-c', 'user.name=Kanban fixture', '-c', 'user.email=kanban@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial'], { cwd: repository });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('textbox', { name: 'Worktree base path' }).fill(worktreeRoot);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(repository);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await projectDialog.getByText('Git repository').waitFor({ state: 'visible' });
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await page.getByText('Project saved.').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('dialog', { name: 'New task' }).getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open task ' + title }).click();
  const notice = page.getByRole('note', { name: 'Worktree not created' });
  await notice.waitFor({ state: 'visible' });
  await notice.getByRole('button', { name: 'Create worktree' }).click();
  await notice.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.locator('.kb-preset-cards').getByRole('button', { name: /^Standard mode/ }).click();
  await page.locator('.kb-agent-tabs [role="tab"]').first().waitFor({ state: 'visible' });
  await page.locator('[data-kanban-conversation-window]').waitFor({ state: 'visible' });
  const worktreePath = join(worktreeRoot, branch);
  await expect.poll(async () => existsSync(worktreePath), { timeout: 20_000 }).toBe(true);
  const tabId = await page.locator('.kb-agent-tabs [role="tab"]').first().getAttribute('id');
  const parentId = SessionId(tabId?.split('-tab-').at(-1)!);

  // The project directory moves after the task exists, so its Git context no longer resolves.
  await rename(repository, movedRepository);

  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete task' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect.poll(() => page.getByRole('button', { name: 'Open task ' + title }).count(), { timeout: 30_000 }).toBe(0);
  await expect.poll(async () => existsSync(worktreePath), { timeout: 20_000 }).toBe(true);
  // The retained entry reports the canonical directory, which may differ from the temp root spelling.
  const retainedPath = await realpath(worktreePath);
  const retainedNotice = page.getByRole('region', { name: 'Destructive operations' });
  await retainedNotice.waitFor({ state: 'visible' });
  await expect(retainedNotice).toContainText(retainedPath);
  await expect(retainedNotice).toContainText('was left on disk because its project path or Git root could not be resolved');
  await expect(retainedNotice.getByText('Checkouts left on disk')).toBeVisible();
  await retainedNotice.getByRole('button', { name: 'Dismiss the retained checkout at ' + retainedPath }).click();
  await expect.poll(() => retainedNotice.getByText('Checkouts left on disk').count(), { timeout: 20_000 }).toBe(0);
  // Dismissing the report acknowledges the notice; the checkout itself stays on disk.
  expect(existsSync(worktreePath)).toBe(true);
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('region', { name: 'Harness board column' }).or(page.locator('.kb-page-body')).first().waitFor({ state: 'visible', timeout: 30_000 });
  await expect.poll(() => page.getByText('Checkouts left on disk').count(), { timeout: 20_000 }).toBe(0);
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).toContain(parentId);
  expect((await exec('git', ['show-ref', '--verify', 'refs/heads/' + branch], { cwd: movedRepository })).stdout).toContain('refs/heads/' + branch);
}, 120_000);
