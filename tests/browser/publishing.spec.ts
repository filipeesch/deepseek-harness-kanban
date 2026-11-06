import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

async function sharingCommands(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __harness: { sharingCommands(): Array<Record<string, unknown>> } }).__harness.sharingCommands());
}

test('connects an unpublished Hub through the Publishing section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await expect(page.getByRole('tab', { name: 'Publishing' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Repository address')).toBeVisible();
  await page.getByLabel('Repository address').fill('https://example.test/team.git');
  await page.getByLabel('Check interval in minutes').fill('7');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.connect', repository: 'https://example.test/team.git', intervalMinutes: 7 });
});

test('previews existing team content and offers both first-connection choices', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=preview');
  await expect(page.getByText(/already contains a published configuration with 2 boards/)).toBeVisible();
  await expect(page.getByText('Compare the workflow versions')).toBeVisible();
  await expect(page.getByText(/Getting the team configuration adopts the team version/)).toBeVisible();
  await page.getByRole('button', { name: 'Get the team configuration' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.receive' });
  await page.getByRole('button', { name: 'Publish this Hub instead' }).click();
  await expect(page.getByRole('button', { name: 'Replace the team configuration' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace the team configuration' }).click();
  await expect.poll(async () => (await sharingCommands(page))[1]).toMatchObject({ type: 'sharing.publishInitial', confirmed: true });
});

test('publishes only after getting team updates', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=updates');
  await expect(page.getByText('Updates available', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Provider: Git')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await page.getByRole('button', { name: 'Get updates (2)' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.getUpdates' });
  await expect(page.getByText(/New from the team: Team board/)).toBeVisible();
  const text = await page.locator('[aria-label="Publishing settings"]').innerText();
  expect(text).not.toMatch(/\b(commit|branch|remote|fetch|push)\b/i);
});

test('resolves a board conflict and republishes an orphan', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=review');
  await expect(page.getByText('Needs review', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Compare the workflow versions')).toBeVisible();
  await page.getByRole('button', { name: 'Use the team version' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.resolve', boardId: 'board', choice: 'team' });

  await page.goto(HARNESS + '?scenario=publishing&sharing=orphan');
  await expect(page.getByText('Removed by the team', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish as a new board' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishOrphan', boardId: 'board' });
});

test('applies a pending team removal and enables Get updates for a pending orphan', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=removal');
  await expect(page.getByText(/Removed by the team with no local work: Old board/)).toBeVisible();
  await page.getByRole('button', { name: 'Get updates (1)' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.getUpdates' });

  await page.goto(HARNESS + '?scenario=publishing&sharing=pending-orphan');
  await expect(page.getByRole('button', { name: 'Get updates (1)' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Publish as a new board' })).toHaveCount(0);
  await expect(page.getByText(/Get updates to keep it as an orphan/)).toBeVisible();
});

test('restores a board removed only here and explains an unavailable repository', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=published');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText(/Disconnecting stops automatic checks and removes the local copy/)).toBeVisible();
  await expect(page.getByText(/The team's published configuration is unchanged/)).toBeVisible();

  await page.goto(HARNESS + '?scenario=publishing&sharing=removed');
  await expect(page.getByText('Removed here', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.restore', boardId: 'old-board' });

  await page.goto(HARNESS + '?scenario=publishing&sharing=unavailable');
  await expect(page.getByText('The team repository could not be reached.')).toBeVisible();
  await expect(page.getByText('Updates unavailable', { exact: true }).first()).toBeVisible();
});

test('shows a board banner and publishing indicators on both tab rows', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=sharing&sharing=updates');
  await expect(page.getByText('Your team published changes to this Hub.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team updates available', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team updates available for this board' })).toBeVisible();
  await page.getByRole('button', { name: 'Review team changes' }).click();
  await expect(page.getByRole('tab', { name: 'Publishing' })).toHaveAttribute('aria-selected', 'true');

  await page.goto(HARNESS + '?scenario=sharing&sharing=draft');
  await expect(page.getByRole('img', { name: 'Unsent publishing changes' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Board changes not sent' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=review');
  await expect(page.getByText('Your team changed boards that also changed on this machine. Review the differences.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'This board needs a team review' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=orphan');
  await expect(page.getByRole('img', { name: 'Board removed by the team' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=preview');
  await expect(page.getByRole('img', { name: 'Publishing connection needs review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review team changes' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Board changes not sent' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Team updates available' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Unsent publishing changes' })).toHaveCount(0);
});

test('a name collision has no resolve action and a Hub shows drafts and updates together', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=collision');
  await expect(page.getByText('A local board already uses this name. Rename or publish it first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use the team version' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keep the local version' })).toHaveCount(0);

  await page.goto(HARNESS + '?scenario=sharing&sharing=mixed');
  await expect(page.getByRole('img', { name: 'Team updates available' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Unsent publishing changes' })).toBeVisible();
});

test('a refused update shows the blocking board, column, and task count', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=refuse-error');
  await page.getByRole('button', { name: 'Get updates (1)' }).click();
  await expect(page.getByText(/would leave 2 tasks in column "plan"/)).toBeVisible();
  await expect(page.getByText('SHARING_REFUSED')).toBeVisible();
});

test('Save and share publishes after the local save', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow&sharing=published');
  await expect(page.getByRole('button', { name: 'Save and share' })).toBeVisible();
  for (const blocked of ['updates', 'review', 'orphan']) {
    await page.goto(HARNESS + '?scenario=workflow&sharing=' + blocked);
    await expect(page.getByRole('button', { name: 'Save and share' })).toHaveCount(0);
  }
  await page.goto(HARNESS + '?scenario=workflow&sharing=published');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('name: Shared flow\ninitial_column: explore\ncolumns:\n  - id: explore\n    label: Explore');
  await page.getByRole('button', { name: 'Save and share' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await expect.poll(async () => (await sharingCommands(page)).length).toBe(1);
  expect((await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publish' });
  const commands = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; yaml?: string }> } }).__harness.commands());
  expect(commands.some(command => command.type === 'workflow.save' && command.yaml?.includes('Shared flow'))).toBe(true);
});

test('a failed share keeps the local save and reports the failure', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow&sharing=share-fail');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('name: Failed share\ninitial_column: explore\ncolumns:\n  - id: explore\n    label: Explore');
  await page.getByRole('button', { name: 'Save and share' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await expect(page.getByText('SHARING_FAILED')).toBeVisible();
});
