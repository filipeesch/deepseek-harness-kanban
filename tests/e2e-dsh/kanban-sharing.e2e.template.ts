// Plugin-owned real-composition scenario. The runner copies this file into
// $DSH_CHECKOUT/apps/web/tests/ and removes it after the pinned web lane runs.
//
// The team sharing lane publishes through the storage-provider boundary only: no
// model traffic and no owner profile. It asserts with plain Vitest polling, because
// the checkout's web vitest lane does not register the Playwright matchers.
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;

const visible = async (target: Locator) => expect.poll(() => target.first().isVisible(), { timeout: 20_000 }).toBe(true);
const count = async (target: Locator, value: number) => expect.poll(() => target.count(), { timeout: 20_000 }).toBe(value);
const contains = async (target: Locator, text: string) => expect.poll(async () => (await target.first().textContent()) ?? '', { timeout: 20_000 }).toContain(text);

/** Every published board log in the bound folder, keyed by file name. */
async function publishedLogs(folder: string): Promise<Map<string, string>> {
  const directory = join(folder, 'kanban-boards');
  const entries = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  const logs = new Map<string, string>();
  for (const entry of entries) logs.set(entry, await readFile(join(directory, entry), 'utf8'));
  return logs;
}

function logOf(logs: Map<string, string>, key: string): string {
  const value = logs.get(key + '.jsonl');
  expect(value, 'missing published log for ' + key).toBeDefined();
  return value!;
}

it('publishes a recorded board default without a false pending change', { timeout: 240_000 }, async () => {
  const replayDir = await mkdtemp(join(tmpdir(), 'dsh-kanban-sharing-'));
  onTestFinished(async () => { await rm(replayDir, { recursive: true, force: true }); });
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  // A team folder inside the isolated workspace, never the developer's home.
  const folder = join(scaffold.workspaceCwd, 'team-folder');
  await mkdir(folder, { recursive: true });

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await count(page.locator('.kb-share-banner'), 0);

  // Connect the Hub to a local folder; the default board is published as it is.
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Team Settings' }).click();
  await page.getByRole('radiogroup', { name: 'Team storage' }).getByRole('radio', { name: 'Local folder' }).click();
  await page.getByRole('textbox', { name: 'Team folder path' }).fill(folder);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await visible(page.getByRole('tab', { name: 'Changes', exact: true }));
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  const changes = page.getByRole('region', { name: 'Changes' });
  await visible(changes);
  await contains(changes, '0 boards to publish');
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  // Nothing was edited, so the banner must not ask for a publication.
  await count(page.locator('.kb-share-banner'), 0);
  // The migrated default board records no default preset choice, so it publishes
  // none and stays readable by an installation that predates the format.
  const first = await publishedLogs(folder);
  expect(logOf(first, 'kanban')).toContain('"kind":"board.renamed"');
  expect(logOf(first, 'kanban')).not.toContain('"kind":"board.preset-changed"');

  // A board created here records the workflow-operator default, which publishes.
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Boards' }).click();
  await page.getByRole('button', { name: 'New board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByRole('textbox', { name: 'Board name' }).fill('Second board');
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();

  // The banner names the new board, offers its publish, and clears once published.
  const banner = page.locator('.kb-share-banner');
  await visible(banner);
  await contains(banner, 'You have changes to send for this board “Second board”.');
  await banner.getByRole('button', { name: 'Publish board' }).click();
  await count(banner, 0);
  const after = await publishedLogs(folder);
  expect(logOf(after, 'second-board')).toContain('"kind":"board.preset-changed"');
  expect(logOf(after, 'second-board')).toContain('"mode":"operator"');
});
