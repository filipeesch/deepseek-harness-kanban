// Plugin-owned real-composition scenarios for cross-card messages. The runner
// copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it afterward.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
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

async function runTool<T = unknown>(scaffold: WebScaffold, name: string, args: Record<string, unknown>, sessionId: string, callId = 'e2e-' + name + '-call'): Promise<T> {
  const definition = scaffold.ctx.tools.get(name) as ToolDefinition | undefined;
  if (definition === undefined) throw new Error('tool ' + name + ' is not registered');
  const execution = {
    callId,
    rootCallId: callId,
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
const STAGE_ENTRY_OVERRIDE = process.env.KANBAN_MESSAGES_OVERRIDE;
const STAGE_ENTRY_WORKFLOW = [
  'name: Stage entry flow',
  'initial_column: todo',
  'columns:',
  '  - id: todo',
  '    label: Todo',
  '    allowed_transitions: [plan]',
  '  - id: plan',
  '    label: Plan',
  '    allowed_transitions: [done]',
  '    on_enter_prompt: Plan the delivered handoffs.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

function unwrap(receipt: unknown): Record<string, any> {
  const result = receipt as { ok: boolean; value?: Record<string, any>; error?: { code: string; message: string } };
  if (!result.ok) throw new Error(String(result.error?.code) + ': ' + String(result.error?.message));
  return result.value!;
}

it('delivers every held message into the first step that executes the stage instruction', { timeout: 180_000 }, async () => {
  if (STAGE_ENTRY_OVERRIDE === undefined) throw new Error('KANBAN_MESSAGES_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-messages-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  // No browser and no real model: the replayed turn is the only model request this lane makes.
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride: STAGE_ENTRY_OVERRIDE,
  });
  onTestFinished(async () => { await scaffold.close(); });
  const controller = () => {
    const service = scaffold.ctx.get('kanbanController') as { snapshot: (value: unknown) => Promise<unknown>; command: (value: unknown) => Promise<unknown> } | undefined;
    if (service === undefined) throw new Error('The built plugin did not activate its native controller.');
    return service;
  };
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: Record<string, unknown>) => unwrap(await controller().command(value));
  const hub = async () => (await snapshot()).state.hubs[0];
  const card = async (title: string) => (await hub()).tasks.find((task: { title: string }) => task.title === title);
  const sessionEvents = (sessionId: string) => {
    const session = scaffold.ctx.sessions.get(SessionId(sessionId));
    if (session === undefined) throw new Error('the target conversation is not loaded');
    return session.snapshotEvents();
  };

  const first = await snapshot();
  const hubId = String(first.state.hubs[0].id);
  const boardId = String(first.state.hubs[0].boards[0].id);
  await command({ type: 'project.save', hubId, project: { name: 'Stage entry', projectPath: scaffold.workspaceCwd, projectKey: 'stage-entry' } });
  const projectId = String((await hub()).projects.find((project: { projectKey: string }) => project.projectKey === 'stage-entry').id);
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: STAGE_ENTRY_WORKFLOW });
  await command({ type: 'task.create', hubId, boardId, projectId, title: 'Stage entry task', description: '', autoMode: false });
  const taskId = String((await card('Stage entry task')).id);
  const created = await command({ type: 'conversation.create', taskId });
  const conversation = String(created.commandReceipt.id);

  // Two handoffs queued by that conversation for a later stage of its own task, each a
  // distinct delivery identity. The stage runs in the same conversation they target.
  const firstHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'First held handoff.' }, conversation, 'e2e-held-first');
  const secondHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'Second held handoff.' }, conversation, 'e2e-held-second');
  expect(firstHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  expect(secondHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  expect((await card('Stage entry task')).heldMessages).toHaveLength(2);

  await command({ type: 'task.move', hubId, taskId, columnId: 'plan' });
  await expect.poll(() => card('Stage entry task').then(task => task?.columnId)).toBe('plan');
  const marker = (await card('Stage entry task')).instructionPending;
  expect(marker?.columnId).toBe('plan');
  await command({ type: 'task.runInstruction', hubId, taskId, columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan the delivered handoffs.' });
  const settled = await scaffold.whenTurnSettled(60_000);
  expect(String(settled)).toBe(conversation);
  // Settle the whole agent, not only this turn: a handoff that arrives a moment late would
  // otherwise be counted while the assertions below are already reading the log.
  const agent = scaffold.ctx.agents.get(SessionId(conversation));
  if (agent === undefined) throw new Error('the target conversation has no live agent');
  await agent.whenIdle();

  type LoggedEvent = { type: string; data?: any };
  const countOf = (events: readonly LoggedEvent[], type: string) => events.filter(event => event.type === type).length;
  const userMessagesOf = (events: readonly LoggedEvent[]) => events.flatMap(event => event.type === 'user/message' ? [event.data] : []);
  const identityOccurrences = (events: readonly LoggedEvent[], id: string) =>
    events.filter(event => event.type === 'user/message' && (event.data as any).source?.requestId === id).length;
  /** The user messages admitted by the first step, delimited by the host's own step boundary. */
  const firstStepMessages = (events: readonly LoggedEvent[]) => {
    const start = events.findIndex(event => event.type === 'step/start');
    if (start < 0) throw new Error('the converted turn admitted no step');
    const next = events.findIndex((event, index) => index > start && (event.type === 'step/start' || event.type === 'turn/end'));
    return userMessagesOf(events.slice(start, next < 0 ? events.length : next));
  };
  const report = (events: readonly LoggedEvent[], delivered: any[]) => ({
    turnBoundaries: countOf(events, 'turn/start'),
    admittedSteps: countOf(events, 'step/start'),
    requestHeaders: countOf(events, 'request/header'),
    firstStepUserKinds: firstStepMessages(events).map((message: any) => message.source?.kind),
    deliveredIdentities: delivered.map((message: any) => message.source?.requestId),
    identityOccurrences: Object.fromEntries([firstHeld.requestId, secondHeld.requestId].map(id => [id, identityOccurrences(events, id)])),
  });

  let events = sessionEvents(conversation) as LoggedEvent[];
  // The diagnostic is written before the assertions, so a failing boundary leaves the
  // actual first-step composition as evidence instead of only an exception.
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await writeFile(join(KANBAN_ROOT, '.verification/messages-stage-entry-report.json'), JSON.stringify({
    ...report(events, firstStepMessages(events).slice(1, 3)),
    firstStepUserKinds: firstStepMessages(events).map((message: any) => message.source?.kind),
  }, null, 2) + '\n');
  // One turn and one admitted step: delivery itself never starts a second step or turn.
  expect(countOf(events, 'turn/start')).toBe(1);
  expect(countOf(events, 'step/start')).toBe(1);
  const firstUsers = firstStepMessages(events);
  const instruction = firstUsers.findIndex((message: any) => message.source?.kind === 'stage-instruction');
  expect(instruction).toBeGreaterThanOrEqual(0);
  const delivered = firstUsers.slice(instruction + 1, instruction + 3);
  expect(delivered.map((message: any) => message.source?.kind)).toEqual(['task-message', 'task-message']);
  expect(delivered.map((message: any) => message.source?.requestId)).toEqual([firstHeld.requestId, secondHeld.requestId]);
  expect(JSON.stringify(delivered[0]?.content)).toContain('First held handoff.');
  expect(JSON.stringify(delivered[1]?.content)).toContain('Second held handoff.');

  // Nothing arrives late or twice: the queue is settled and the batch stayed one occurrence.
  await expect.poll(async () => ((await card('Stage entry task')).heldMessages ?? []).length).toBe(0);
  await expect.poll(async () => (await card('Stage entry task')).releasedMessages ?? []).toEqual(expect.arrayContaining([firstHeld.requestId, secondHeld.requestId]));
  await agent.whenIdle();
  events = sessionEvents(conversation) as LoggedEvent[];
  expect(countOf(events, 'turn/start')).toBe(1);
  expect(countOf(events, 'step/start')).toBe(1);
  expect(identityOccurrences(events, firstHeld.requestId)).toBe(1);
  expect(identityOccurrences(events, secondHeld.requestId)).toBe(1);

  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await writeFile(join(KANBAN_ROOT, '.verification/messages-stage-entry-report.json'), JSON.stringify({
    ...report(events, delivered),
    heldAfterRun: (await card('Stage entry task')).heldMessages ?? [],
  }, null, 2) + '\n');
});

/** Create the project, workflow, task and conversation the stage-entry scenarios share. */
async function stageEntryTask(scaffold: WebScaffold) {
  const controller = () => {
    const service = scaffold.ctx.get('kanbanController') as { snapshot: (value: unknown) => Promise<unknown>; command: (value: unknown) => Promise<unknown> } | undefined;
    if (service === undefined) throw new Error('The built plugin did not activate its native controller.');
    return service;
  };
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: Record<string, unknown>) => unwrap(await controller().command(value));
  const hub = async () => (await snapshot()).state.hubs[0];
  const card = async (title: string) => (await hub()).tasks.find((task: { title: string }) => task.title === title);
  const sessionEvents = (sessionId: string) => {
    const session = scaffold.ctx.sessions.get(SessionId(sessionId));
    if (session === undefined) throw new Error('the target conversation is not loaded');
    return session.snapshotEvents();
  };
  const first = await snapshot();
  const hubId = String(first.state.hubs[0].id);
  const boardId = String(first.state.hubs[0].boards[0].id);
  await command({ type: 'project.save', hubId, project: { name: 'Stage entry', projectPath: scaffold.workspaceCwd, projectKey: 'stage-entry' } });
  const projectId = String((await hub()).projects.find((project: { projectKey: string }) => project.projectKey === 'stage-entry').id);
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: STAGE_ENTRY_WORKFLOW });
  await command({ type: 'task.create', hubId, boardId, projectId, title: 'Stage entry task', description: '', autoMode: false });
  const taskId = String((await card('Stage entry task')).id);
  const conversation = String((await command({ type: 'conversation.create', taskId })).commandReceipt.id);
  return { command, card, sessionEvents, hubId, taskId, conversation };
}

it('carries a restored queued instruction with its handoffs when no preparation exists', { timeout: 180_000 }, async () => {
  if (STAGE_ENTRY_OVERRIDE === undefined) throw new Error('KANBAN_MESSAGES_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-restored-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride: STAGE_ENTRY_OVERRIDE,
  });
  onTestFinished(async () => { await scaffold.close(); });
  const { command, card, sessionEvents, hubId, taskId, conversation } = await stageEntryTask(scaffold);
  const firstHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'First held handoff.' }, conversation, 'e2e-restored-first');
  const secondHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'Second held handoff.' }, conversation, 'e2e-restored-second');
  expect(firstHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  expect(secondHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });

  await command({ type: 'task.move', hubId, taskId, columnId: 'plan' });
  await expect.poll(() => card('Stage entry task').then((task: any) => task?.columnId)).toBe('plan');
  const entryId = String((await card('Stage entry task')).stageEntry.id);
  const agent = scaffold.ctx.agents.get(SessionId(conversation));
  if (agent === undefined) throw new Error('the target conversation has no live agent');
  // Queue the exact instruction the way a resumed native inbox does. The plugin's runtime
  // map has no preparation for it, so the first step must reconcile at that boundary.
  const settled = scaffold.whenTurnSettled(60_000);
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Plan the delivered handoffs.' }],
    source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: Plan', requestId: 'restored-instruction', entryId, columnId: 'plan' } as never,
  }));
  expect(String(await settled)).toBe(conversation);
  await agent.whenIdle();

  const events = sessionEvents(conversation) as Array<{ type: string; data?: any }>;
  const firstStepUsers = (() => {
    const start = events.findIndex(event => event.type === 'step/start');
    if (start < 0) throw new Error('the converted turn admitted no step');
    const next = events.findIndex((event, index) => index > start && (event.type === 'step/start' || event.type === 'turn/end'));
    return events.slice(start, next < 0 ? events.length : next)
      .filter(event => event.type === 'user/message').map(event => event.data);
  })();
  const instruction = firstStepUsers.findIndex((message: any) => message.source?.kind === 'stage-instruction');
  expect(instruction).toBeGreaterThanOrEqual(0);
  expect(firstStepUsers[instruction]!.source).toMatchObject({ requestId: 'restored-instruction' });
  const delivered = firstStepUsers.slice(instruction + 1, instruction + 3);
  expect(delivered.map((message: any) => message.source?.kind)).toEqual(['task-message', 'task-message']);
  expect(delivered.map((message: any) => message.source?.requestId)).toEqual([firstHeld.requestId, secondHeld.requestId]);
  // Each identity appears exactly once across the whole conversation, and the queue settles.
  const occurrences = (id: string) => events.filter(event => event.type === 'user/message' && event.data?.source?.requestId === id).length;
  expect(occurrences(firstHeld.requestId)).toBe(1);
  expect(occurrences(secondHeld.requestId)).toBe(1);
  await expect.poll(async () => ((await card('Stage entry task')).heldMessages ?? []).length).toBe(0);

  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await writeFile(join(KANBAN_ROOT, '.verification/messages-restored-instruction-report.json'), JSON.stringify({
    firstStepUserKinds: firstStepUsers.map((message: any) => message.source?.kind),
    deliveredIdentities: delivered.map((message: any) => message.source?.requestId),
    identityOccurrences: { first: occurrences(firstHeld.requestId), second: occurrences(secondHeld.requestId) },
    heldAfterRun: (await card('Stage entry task')).heldMessages ?? [],
  }, null, 2) + '\n');
});

/** One replay script entry that finishes a turn with a single text answer. */
function replayTurn(text: string) {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 96, outputTokens: 6, totalTokens: 102 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  };
}

it('queues the instruction behind a running turn and carries its handoffs on its own first step', { timeout: 180_000 }, async () => {
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-busy-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const override = join(replayDir, 'busy-override.json');
  await writeFile(override, JSON.stringify([replayTurn('The prior turn finished.'), replayTurn('The instruction turn finished.')]) + '\n');
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride: override,
  });
  onTestFinished(async () => { await scaffold.close(); });
  const { command, card, sessionEvents, hubId, taskId, conversation } = await stageEntryTask(scaffold);
  const firstHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'First held handoff.' }, conversation, 'e2e-busy-first');
  const secondHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'Second held handoff.' }, conversation, 'e2e-busy-second');
  expect(firstHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  expect(secondHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  await command({ type: 'task.move', hubId, taskId, columnId: 'plan' });
  await expect.poll(() => card('Stage entry task').then((task: any) => task?.columnId)).toBe('plan');
  const entryId = String((await card('Stage entry task')).stageEntry.id);
  const agent = scaffold.ctx.agents.get(SessionId(conversation));
  if (agent === undefined) throw new Error('the target conversation has no live agent');
  // The conversation is busy: a prior turn is queued first, and the exact stage instruction is
  // queued behind it before that turn claims anything.
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Prior work first.' }], source: { kind: 'user' } }));
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Plan the delivered handoffs.' }],
    source: { kind: 'stage-instruction', form: 'notice', summary: 'Stage: Plan', requestId: 'busy-instruction', entryId, columnId: 'plan' } as never,
  }));
  await agent.whenIdle();

  const events = sessionEvents(conversation) as Array<{ type: string; data?: any }>;
  // Group the admitted user messages by the host's own step boundary.
  const steps: any[][] = [];
  for (const event of events) {
    if (event.type === 'step/start') steps.push([]);
    else if (event.type === 'user/message' && steps.length > 0) steps.at(-1)!.push(event.data);
  }
  expect(steps).toHaveLength(2);
  // The prior turn carries no handoff and no instruction.
  expect(steps[0]!.map(message => message.source?.kind)).not.toContain('task-message');
  expect(steps[0]!.map(message => message.source?.kind)).not.toContain('stage-instruction');
  // The instruction turn carries the instruction followed by both handoffs, once each.
  const instruction = steps[1]!.findIndex(message => message.source?.kind === 'stage-instruction');
  expect(instruction).toBeGreaterThanOrEqual(0);
  expect(steps[1]![instruction]!.source).toMatchObject({ requestId: 'busy-instruction' });
  const delivered = steps[1]!.slice(instruction + 1, instruction + 3);
  expect(delivered.map(message => message.source?.kind)).toEqual(['task-message', 'task-message']);
  expect(delivered.map(message => message.source?.requestId)).toEqual([firstHeld.requestId, secondHeld.requestId]);
  const occurrences = (id: string) => events.filter(event => event.type === 'user/message' && event.data?.source?.requestId === id).length;
  expect(occurrences(firstHeld.requestId)).toBe(1);
  expect(occurrences(secondHeld.requestId)).toBe(1);
  await expect.poll(async () => ((await card('Stage entry task')).heldMessages ?? []).length).toBe(0);

  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await writeFile(join(KANBAN_ROOT, '.verification/messages-busy-turn-report.json'), JSON.stringify({
    turns: events.filter(event => event.type === 'turn/start').length,
    steps: steps.map(step => step.map((message: any) => message.source?.kind)),
    deliveredIdentities: delivered.map((message: any) => message.source?.requestId),
    identityOccurrences: { first: occurrences(firstHeld.requestId), second: occurrences(secondHeld.requestId) },
    heldAfterRun: (await card('Stage entry task')).heldMessages ?? [],
  }, null, 2) + '\n');
});

it('carries a handoff committed after the stage admission into the instruction step', { timeout: 180_000 }, async () => {
  if (STAGE_ENTRY_OVERRIDE === undefined) throw new Error('KANBAN_MESSAGES_OVERRIDE is required');
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-late-hold-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride: STAGE_ENTRY_OVERRIDE,
  });
  onTestFinished(async () => { await scaffold.close(); });
  const { command, card, sessionEvents, hubId, taskId, conversation } = await stageEntryTask(scaffold);
  const firstHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'First held handoff.' }, conversation, 'e2e-late-first');
  expect(firstHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  await command({ type: 'task.move', hubId, taskId, columnId: 'plan' });
  await expect.poll(async () => (await card('Stage entry task')).columnId).toBe('plan');
  const agent = scaffold.ctx.agents.get(SessionId(conversation));
  if (agent === undefined) throw new Error('the target conversation has no live agent');
  // Gate the instruction behind prior work so the admission prepares with the first hold
  // only; the second hold is committed while the instruction is queued.
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const maintenance = agent.runMaintenance(async () => { await gate; });
  const marker = (await card('Stage entry task')).instructionPending;
  expect(marker?.columnId).toBe('plan');
  const receipt = await command({ type: 'task.runInstruction', hubId, taskId, columnId: 'plan', expectedEnteredAt: marker.enteredAt, expectedInstruction: 'Plan the delivered handoffs.' });
  expect(receipt).toBeDefined();
  await expect.poll(() => agent.inbox.nextTurn.length > 0).toBe(true);
  const secondHeld = await runTool<{ delivered: boolean; held?: { columnId: string }; requestId: string }>(scaffold, 'send_task_message', { deliver_at: 'plan', message: 'Second held handoff.' }, conversation, 'e2e-late-second');
  expect(secondHeld).toMatchObject({ delivered: false, held: { columnId: 'plan' } });
  open();
  await maintenance.catch(() => {});
  await agent.whenIdle();

  const events = sessionEvents(conversation) as Array<{ type: string; data?: any }>;
  const steps: any[][] = [];
  for (const event of events) {
    if (event.type === 'step/start') steps.push([]);
    else if (event.type === 'user/message' && steps.length > 0) steps.at(-1)!.push(event.data);
  }
  expect(steps).toHaveLength(1);
  const users = steps[0]!;
  const instruction = users.findIndex(message => message.source?.kind === 'stage-instruction');
  expect(instruction).toBeGreaterThanOrEqual(0);
  const delivered = users.slice(instruction + 1, instruction + 3);
  expect(delivered.map(message => message.source?.kind)).toEqual(['task-message', 'task-message']);
  expect(delivered.map(message => message.source?.requestId)).toEqual([firstHeld.requestId, secondHeld.requestId]);
  const occurrences = (id: string) => events.filter(event => event.type === 'user/message' && event.data?.source?.requestId === id).length;
  expect(occurrences(firstHeld.requestId)).toBe(1);
  expect(occurrences(secondHeld.requestId)).toBe(1);
  await expect.poll(async () => ((await card('Stage entry task')).heldMessages ?? []).length).toBe(0);

  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await writeFile(join(KANBAN_ROOT, '.verification/messages-late-hold-report.json'), JSON.stringify({
    turns: events.filter(event => event.type === 'turn/start').length,
    steps: steps.map(step => step.map((message: any) => message.source?.kind)),
    deliveredIdentities: delivered.map((message: any) => message.source?.requestId),
    identityOccurrences: { first: occurrences(firstHeld.requestId), second: occurrences(secondHeld.requestId) },
    heldAfterRun: (await card('Stage entry task')).heldMessages ?? [],
  }, null, 2) + '\n');
});
