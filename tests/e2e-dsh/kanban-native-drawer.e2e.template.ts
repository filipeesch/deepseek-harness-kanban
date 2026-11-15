// Plugin-owned real-composition scenarios for the native drawer shell.
// Copied into $DSH_CHECKOUT/apps/web/tests/ by scripts/e2e-dsh.mjs.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Locator, WebSocketRoute } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts';
import { newEnglishPage, writeComposerDraft } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const TASK_CONTEXT_FIXTURE = process.env.KANBAN_TASK_CONTEXT_FIXTURE
  ?? join(KANBAN_ROOT, 'tests/e2e-dsh/task-context.jsonl');
const ORDINARY_CHAT_FIXTURE = process.env.KANBAN_ORDINARY_CHAT_FIXTURE
  ?? join(KANBAN_ROOT, 'tests/e2e-dsh/ordinary-chat.jsonl');

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

it('keeps a branch of the open conversation inside the drawer and selects it', async () => {
  const replayOverride = process.env.KANBAN_NATIVE_OVERRIDE;
  if (replayOverride === undefined) throw new Error('KANBAN_NATIVE_OVERRIDE is required');
  // An override-only replay script: the fixture path stays absent so the override
  // supplies every response (same shape as the auto-mode lane).
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-native-drawer-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    developerTools: true,
    replayFixture: join(replayDir, 'override-only.jsonl'),
    replayOverride,
  });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  const logs: string[] = [];
  page.on('console', message => { logs.push(message.type() + ': ' + message.text()); });
  page.on('pageerror', error => { logs.push('pageerror: ' + error.message); });
  await page.addInitScript(() => { try { localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await createProjectAndTask(page, scaffold, 'Owned navigation task');

  const drawer = page.locator('.kb-drawer');
  await visible(drawer.locator('.kb-preset-cards'));
  await drawer.getByRole('button', { name: /^Standard mode/ }).first().click();
  const window = drawer.locator('[data-kanban-conversation-window]');
  await visible(window);
  const parentId = await parentSessionId(page);

  // One replayed turn completes, so the transcript tail exposes the branch action.
  const composer = drawer.locator('[data-composer-input][contenteditable="true"]').last();
  await visible(composer);
  await writeComposerDraft(page, composer, 'Prepare the branch source.');
  await composer.press('Enter');
  const reply = drawer.getByText('Branch source ready.', { exact: false });
  await visible(reply);

  // Branching is a native navigation to a brand-new Session. The drawer claims it,
  // asks the host to attach it, and selects the resulting tab without unmounting the
  // board; the classification needs one Session-list refresh first.
  const branch = drawer.getByRole('button', { name: 'Branch into a new conversation' }).first();
  await visible(branch);
  await branch.click();
  try {
    await expect.poll(() => page.locator('.kb-agent-tabs [role="tab"]').count(), { timeout: 15_000 }).toBe(2);
  } catch (error) {
    console.log('--- page log ---\n' + logs.join('\n') + '\n--- end ---');
    const drawers = await page.locator('.kb-drawer').count();
    const tabs = await page.locator('.kb-agent-tabs [role="tab"]').count();
    const columns = await page.locator('[data-column-id]').count();
    console.log('--- page state --- drawers:' + drawers + ' tabs:' + tabs + ' columns:' + columns + ' ---');
    await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
    await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-branch-failure.png') });
    throw error;
  }
  await visible(drawer);
  await visible(window);
  await visible(page.locator('[data-column-id]').first());
  const activeTab = await page.locator('.kb-agent-tabs [role="tab"][aria-selected="true"]').first().getAttribute('id');
  expect(activeTab).not.toContain('-tab-' + parentId);
  await expectCount(drawer.getByRole('alert').filter({ hasText: 'The branch could not be added to this task' }), 0);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-branch-claimed.png') });
}, 120_000);

it('leaves an ordinary chat without a board status and keeps the status on the Kanban page', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] }, developerTools: true });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  // The lane owns the remote transport so it can end the live board feed once and keep it
  // from reconnecting while the page status is observed. Unary commands travel over HTTP,
  // so their requests are observed separately to prove the claim was attempted.
  const sockets: WebSocketRoute[] = [];
  const posts: string[] = [];
  const attachResults: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url() + String.fromCharCode(10) + (request.postData() ?? '').slice(0, 400)); });
  // The refusal is the host's answer to the claim; capture it so the test cannot pass on a
  // successful attach or on no claim at all.
  page.on('response', response => {
    if (response.request().postData()?.includes('conversation.attach') !== true) return;
    void response.text().then(body => attachResults.push(body)).catch(() => undefined);
  });
  let refuseReconnect = false;
  await page.routeWebSocket('**/api/remote.mux', route => {
    sockets.push(route);
    if (refuseReconnect) return;
    route.connectToServer();
  });
  await page.addInitScript(() => { try { localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });

  // One ordinary chat outside every Workspace, so the host lists it as a normal Session.
  const ordinaryId = await seedSession(scaffold, await readFile(ORDINARY_CHAT_FIXTURE, 'utf8'), 'kanban-ordinary-chat-e2e');
  await scaffold.ctx.sessionController.rename({ sessionId: ordinaryId, title: 'Ordinary chat' });

  await createProjectAndTask(page, scaffold, 'Ordinary navigation task');
  const drawer = page.locator('.kb-drawer');
  await visible(drawer.locator('.kb-preset-cards'));
  await drawer.getByRole('button', { name: /^Standard mode/ }).first().click();
  await visible(drawer.locator('[data-kanban-conversation-window]'));

  // Expand the host's Ungrouped bucket so the seeded ordinary chat is reachable.
  const ungrouped = page.locator('[data-row-key="workspace:"]');
  if (await ungrouped.count() > 0 && await ungrouped.first().getAttribute('aria-expanded') !== 'true') await ungrouped.first().click();

  // Selecting that ordinary chat is the navigation that used to leave "Kanban updates are
  // unavailable: Only a branch ..." above its composer. The host refuses the claim and the
  // native navigation stands.
  await page.getByLabel('Sessions', { exact: true }).getByText('Ordinary chat', { exact: true }).click();
  // The drawer asked the host to prove and attach the Session, the host refused, and the
  // native navigation stood. Both halves are asserted so a successful attach cannot pass.
  try {
    await expect.poll(() => posts.some(post => post.includes('conversation.attach')), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => attachResults.some(body => body.includes('FORK_LINEAGE_MISMATCH')), { timeout: 20_000 }).toBe(true);
  } catch (error) {
    console.log('--- posts ' + posts.length + ' / attach results ' + attachResults.length + ' ---');
    for (const post of posts.slice(-10)) console.log(post);
    for (const body of attachResults.slice(-5)) console.log(body.slice(0, 600));
    throw error;
  }
  await expectCount(page.locator('.kb-drawer'), 0);
  await expectCount(page.locator('.kanban-feed-error'), 0);
  await expectCount(page.getByText('Kanban updates are unavailable', { exact: false }), 0);
  await mkdir(join(KANBAN_ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-ordinary-chat.png') });

  // Back on the Kanban page, an available board feed presents no status.
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expectCount(page.locator('.kanban-feed-error'), 0);

  // A real stream failure is presented by the page status with its retry. The transport does
  // not reconnect here, so the presented state stays observable; the recovery is covered by
  // the bridge unit test.
  refuseReconnect = true;
  for (const socket of sockets) await socket.close({ code: 1011, reason: 'lane' }).catch(() => undefined);
  const strip = page.locator('.kanban-feed-error');
  await visible(strip);
  await expectText(strip, 'Kanban updates are unavailable:');
  await visible(page.getByRole('button', { name: 'Retry updates' }));
  await page.screenshot({ path: join(KANBAN_ROOT, '.verification/native-drawer-board-status.png') });
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
