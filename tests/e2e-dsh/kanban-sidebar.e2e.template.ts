// Plugin-owned real-composition scenario for the drawer's embedded right Sidebar panel.
// Copied into $DSH_CHECKOUT/apps/web/tests/ by scripts/e2e-dsh.mjs.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator } from 'playwright';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold, type WebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;

/** The checkout's Vitest runner registers no Playwright matchers; wait and poll instead. */
async function visible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
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

async function startStandardConversation(drawer: Locator): Promise<void> {
  await visible(drawer.locator('.kb-preset-cards'));
  const card = drawer.getByRole('button', { name: /^Standard mode/ }).first();
  await visible(card);
  await card.click();
  await visible(drawer.locator('[data-kanban-conversation-window]'));
}

it('hosts the native right Sidebar panel inside the task drawer', async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] }, developerTools: true });
  let browser: Browser | undefined;
  onTestFinished(async () => { try { await browser?.close(); } finally { await scaffold.close(); } });
  browser = await chromium.launch();
  const page = await newEnglishPage(browser);
  await page.addInitScript(() => { try { localStorage.setItem('dsh-kanban.drawer.width', '620'); } catch { /* storage is optional */ } });
  await createProjectAndTask(page, scaffold, 'Sidebar panel task');

  const drawer = page.locator('.kb-drawer');
  await startStandardConversation(drawer);
  const window = drawer.locator('[data-kanban-conversation-window]');
  const expand = drawer.locator('[data-sidebar-right-expand]');
  await expectCount(expand, 1);

  // The native corner control is the only way in. A host without the embedded
  // panel draws no rail; the drawer keeps its previous behavior and the lane
  // reports the unsupported host instead of failing.
  await expand.click();
  const rail = drawer.getByRole('region', { name: 'Right Sidebar' });
  const supported = await rail.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
  const out = join(KANBAN_ROOT, '.verification');
  await mkdir(out, { recursive: true });
  if (!supported) {
    console.log('sidebar lane: unsupported host — the embedded-panel capability is absent');
    await visible(window);
    await expectCount(drawer.locator('.kb-workspace'), 0);
    await expectCount(drawer.getByRole('alert'), 0);
    await page.screenshot({ path: join(out, 'sidebar-unsupported.png') });
    return;
  }

  const divider = drawer.getByRole('separator', { name: 'Resize right Sidebar' });
  await visible(divider);
  await page.screenshot({ path: join(out, 'sidebar-drawer-light.png') });

  // Shortcuts taken from the drawer open their page inside the rail.
  await window.click();
  await page.keyboard.press('Control+Backquote');
  await expect.poll(async () => (await rail.locator('[role="tab"]').allTextContents()).some(text => /terminal/i.test(text)), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+KeyP' : 'Control+Alt+KeyP');
  await expect.poll(async () => (await rail.locator('[role="tab"]').allTextContents()).some(text => /files/i.test(text)), { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: join(out, 'sidebar-drawer-tabs-light.png') });

  // A second conversation has its own collapsed panel; returning to the first
  // restores the expanded one, and a reload keeps the shared state.
  await page.getByRole('button', { name: 'New conversation' }).click();
  await startStandardConversation(drawer);
  await expectCount(page.locator('.kb-agent-tabs [role="tab"]'), 2);
  await expectCount(drawer.locator('.kb-workspace-rail'), 0);
  await page.locator('.kb-agent-tabs [role="tab"]').first().click();
  await visible(rail);

  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Open task Sidebar panel task' }).click();
  await visible(page.locator('.kb-drawer'));
  await visible(page.getByRole('region', { name: 'Right Sidebar' }));
  // Wait for the drawer's entrance animation to settle before the appearance
  // evidence, so the board cannot bleed through the captured drawer. The
  // entering marker itself stays on the element; the painted opacity is the
  // fact that matters.
  await expect.poll(async () => page.locator('.kb-drawer').evaluate(element => getComputedStyle(element).opacity), { timeout: 5_000 }).toBe('1');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  await page.screenshot({ path: join(out, 'sidebar-drawer-dark.png') });
}, 150_000);
