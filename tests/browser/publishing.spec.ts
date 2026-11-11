import { expect, test, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

async function sharingCommands(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __harness: { sharingCommands(): Array<Record<string, unknown>> } }).__harness.sharingCommands());
}

test('connects an unpublished Hub through Team Settings', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Repository address')).toBeVisible();
  await page.getByLabel('Repository address').fill('https://example.test/team.git');
  await page.getByLabel('Check interval in minutes').fill('7');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.connect', hubId: 'hub', provider: 'git', settings: { repository: 'https://example.test/team.git' }, intervalMinutes: 7 });
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
  await expect(page.locator('[aria-label="Team settings"] .kb-share-meta').getByText('Git repository', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Publish the board list/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Get updates for every board (2)' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.getUpdates' });
  await expect(page.getByText(/New from the team: Team board/)).toBeVisible();
  const text = await page.locator('[aria-label="Team settings"]').innerText();
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
  await page.getByRole('button', { name: 'Get updates for every board (1)' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.getUpdates' });

  await page.goto(HARNESS + '?scenario=publishing&sharing=pending-orphan');
  await expect(page.getByRole('button', { name: 'Get updates for every board (1)' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Publish as a new board' })).toHaveCount(0);
  // The pending orphan is applied by the update action, which the panel offers.
  await expect(page.getByText('Removed by the team', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Your team published changes to this board.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team updates available', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team updates available for this board' })).toBeVisible();
  await page.getByRole('button', { name: 'Review team changes' }).click();
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');

  await page.goto(HARNESS + '?scenario=sharing&sharing=draft');
  await expect(page.getByRole('img', { name: 'Unsynced team changes' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Board changes not sent' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=review');
  await expect(page.getByText('Your team changed this board in a way that needs a choice.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'This board needs a team review' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=orphan');
  await expect(page.getByRole('img', { name: 'Board removed by the team' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=preview');
  await expect(page.getByRole('img', { name: 'Team storage connection needs review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review team changes' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Board changes not sent' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Team updates available' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Unsynced team changes' })).toHaveCount(0);
});

test('a name collision has no resolve action and a Hub shows drafts and updates together', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=collision');
  await expect(page.getByText('A local board already uses this name. Rename or publish it first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use the team version' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keep the local version' })).toHaveCount(0);

  await page.goto(HARNESS + '?scenario=sharing&sharing=mixed');
  await expect(page.getByRole('img', { name: 'Team updates available' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Unsynced team changes' })).toBeVisible();
});

test('a refused update shows the blocking board, column, and task count', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=refuse-error');
  await page.getByRole('button', { name: 'Get updates for every board (1)' }).click();
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
  await expect(page.locator('.cm-content')).toContainText('Shared flow');
  await page.waitForTimeout(300);
  await expect(page.getByText('Valid workflow')).toBeVisible();
  await page.getByRole('button', { name: 'Save and share' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await expect.poll(async () => (await sharingCommands(page)).length).toBe(1);
  expect((await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publish' });
  const commands = await page.evaluate(() => (window as unknown as { __harness: { commands(): Array<{ type: string; yaml?: string }> } }).__harness.commands());
  expect(commands.some(command => command.type === 'board.workflow.save' && command.yaml?.includes('Shared flow'))).toBe(true);
});

test('a failed share keeps the local save and reports the failure', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow&sharing=share-fail');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('name: Failed share\ninitial_column: explore\ncolumns:\n  - id: explore\n    label: Explore');
  await expect(page.locator('.cm-content')).toContainText('Failed share');
  await page.waitForTimeout(300);
  await expect(page.getByText('Valid workflow')).toBeVisible();
  await page.getByRole('button', { name: 'Save and share' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await expect(page.getByText('SHARING_FAILED')).toBeVisible();
});

test('switches the Team Settings surface to the selected storage', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: '.verification/team-settings.png', fullPage: true });
  await page.getByRole('radio', { name: 'Google Drive Cloud' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
  await expect(page.getByLabel('Repository address')).toHaveCount(0);
});

test('offers one card per storage with an icon and a description', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  const cards = page.getByRole('radiogroup', { name: 'Team storage' }).getByRole('radio');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('radio', { name: 'Google Drive Local' })).toContainText('Use a folder from the Google Drive app installed here.');
  await expect(page.getByRole('radio', { name: 'Google Drive Local' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('radio', { name: 'Git repository' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Google Drive Local' }).click();
  await expect(page.getByRole('radio', { name: 'Google Drive Local' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Git repository' })).toHaveAttribute('aria-checked', 'false');
});


test('renders a connected Google Drive surface and hides Git actions', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive');
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: 'Google Drive Cloud' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Google Drive Cloud' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get updates' })).toHaveCount(0);
  await expect(page.getByText('member@example.test')).toBeVisible();
});

test('resolves a Google Drive conflict and uses a single save action', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-review');
  await expect(page.getByText('Compare the workflow versions')).toBeVisible();
  await page.getByRole('button', { name: 'Use the team version' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.resolve', boardId: 'board', choice: 'team' });
  await page.goto(HARNESS + '?scenario=workflow&sharing=drive');
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeVisible();
  // Publishing is manual for every storage, so the share action is always available.
  await expect(page.getByRole('button', { name: 'Save and share' })).toBeVisible();
});

test('shows Google Drive preview differences and stages the replace action', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-preview');
  await expect(page.getByText(/already contains a published configuration/)).toBeVisible();
  await expect(page.getByText('Compare the workflow versions')).toBeVisible();
  await page.getByRole('button', { name: 'Publish this Hub instead' }).click();
  await expect(page.getByRole('button', { name: 'Replace the team configuration' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace the team configuration' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishInitial', confirmed: true });
});

test('offers the suggested local folder and connects a typed path', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await page.getByRole('radio', { name: 'Local folder' }).click();
  await expect(page.getByLabel('Team folder path')).toHaveValue('~/.dsh-kanban/hub');
  await expect(page.getByText('~/.dsh-kanban/hub', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Repository address')).toHaveCount(0);
  await page.getByLabel('Team folder path').fill('~/Drive/Team');
  await page.getByLabel('Check interval in minutes').fill('3');
  await page.screenshot({ path: '.verification/team-settings-local-folder.png', fullPage: true });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.connect', hubId: 'hub', provider: 'local-folder', settings: { path: '~/Drive/Team' }, intervalMinutes: 3 });
});

test('names the condition that refused a local folder connection', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&refuse=folder');
  await page.getByRole('radio', { name: 'Local folder' }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('The selected folder does not exist.')).toBeVisible();
  await expect(page.getByText('SHARING_FOLDER_MISSING')).toBeVisible();
});

test('renders a connected local folder surface and disconnects', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=folder');
  await expect(page.getByRole('radio', { name: 'Local folder' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Local folder' })).toBeDisabled();
  await expect(page.getByText('~/.dsh-kanban/hub')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get updates' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText(/Disconnecting stops automatic synchronization/)).toBeVisible();
  await expect(page.getByText(/The folder, its kanban-hub.yaml, and every other file remain/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.disconnect', hubId: 'hub' });
});

test('presents a synchronization conflict copy as a review', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=sharing&sharing=folder-review');
  await expect(page.getByText(/Another copy of the team document is in this folder: kanban-hub \(1\)\.yaml/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=publishing&sharing=folder-review');
  await expect(page.getByText('SHARING_CONFLICT_COPY')).toBeVisible();
  await expect(page.getByText(/Decide which version is current/)).toBeVisible();
});

test('renders the local folder surface with the host theme tokens in both appearances', async ({ page }) => {
  const primary = async (): Promise<{ fill: string; expectedFill: string; label: string; expectedLabel: string; contrast: number; dark: boolean }> => page.evaluate(() => {
    const channels = (value: string): [number, number, number] => {
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(value);
      if (srgb !== null) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) return [0, 0, 0];
      const parts = match[1]!.split(',').map(part => Number(part.trim()));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const luminance = (value: string): number => {
      const [red, green, blue] = channels(value).map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (left: string, right: string): number => {
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const probe = (property: string, style: 'color' | 'backgroundColor'): string => {
      const span = document.createElement('span');
      span.style[style] = `var(${property})`;
      document.body.appendChild(span);
      const value = getComputedStyle(span)[style];
      span.remove();
      return value;
    };
    const button = document.querySelector('[aria-label="Team settings"] .kb-button.kb-primary');
    const style = button === null ? null : getComputedStyle(button);
    return {
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      expectedFill: probe('--dsw-alias-button-primary-fill', 'backgroundColor'),
      expectedLabel: probe('--dsw-alias-label-primary-foreground', 'color'),
      fill: style?.backgroundColor ?? '',
      label: style?.color ?? '',
      contrast: style === null ? 0 : contrast(style.backgroundColor, style.color),
    };
  });

  await page.goto(HARNESS + '?scenario=publishing&sharing=folder-preview&theme=host');
  await expect(page.getByRole('button', { name: 'Get the team configuration' })).toBeVisible();
  const light = await primary();
  expect(light.dark).toBe(false);
  expect(light.expectedFill).not.toBe('');
  expect(light.fill).toBe(light.expectedFill);
  expect(light.label).toBe(light.expectedLabel);
  expect(light.contrast, 'the primary label is legible in light').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: '.verification/local-folder-light.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await primary();
  expect(dark.dark).toBe(true);
  expect(dark.expectedFill).not.toBe(light.expectedFill);
  expect(dark.fill).toBe(dark.expectedFill);
  expect(dark.label).toBe(dark.expectedLabel);
  expect(dark.contrast, 'the primary label is legible in dark').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: '.verification/local-folder-dark.png', fullPage: true });
});

test('keeps the review badge while the storage is unavailable', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=sharing&sharing=unavailable-conflict');
  await expect(page.getByRole('img', { name: 'Team updates unavailable' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=unavailable-folder-review');
  await expect(page.getByRole('img', { name: 'Team updates unavailable' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();
});

test('browses a Google Drive Local folder and connects it', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&drive=ready');
  await page.getByRole('radio', { name: 'Google Drive Local' }).click();
  await expect(page.getByText(/1 Google Drive location detected/)).toBeVisible();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a Google Drive folder' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a Google Drive folder' })).toBeVisible();
  await page.getByRole('button', { name: /member@example.test/ }).click();
  await expect(page.getByText('My Drive')).toBeVisible();
  await expect(page.getByText('Shared drives')).toBeVisible();
  await page.getByRole('button', { name: 'Meu Drive' }).click();
  await page.getByRole('button', { name: 'Projetos' }).click();
  await expect(page.getByText(/kanban-hub.yaml is already here/)).toBeVisible();
  await page.getByRole('button', { name: 'Select this folder' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.connect', provider: 'google-drive-local', settings: { path: '/Users/member/Library/CloudStorage/GoogleDrive-member@example.test/Meu Drive/Projetos' } });
  // The fake host adopts a folder that already holds the document and asks for the first-connection choice.
  await expect(page.getByText(/already contains a published configuration with 1 board/)).toBeVisible();
});

test('explains when Google Drive for desktop is not detected', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&drive=app-missing');
  await page.getByRole('radio', { name: 'Google Drive Local' }).click();
  await expect(page.getByText(/Google Drive for desktop was not detected on this computer/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeVisible();
  await page.getByRole('button', { name: /Rescan/ }).click();
  await expect(page.getByText(/Google Drive for desktop was not detected on this computer/)).toBeVisible();
});

test('renders a connected Drive Local surface and changes the folder', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-local&drive=ready');
  await expect(page.getByRole('radio', { name: 'Google Drive Local' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Google Drive Local' })).toBeDisabled();
  await expect(page.getByText('member@example.test / Projetos').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change folder' }).click();
  await expect(page.getByText(/Local boards, tasks, and notes stay on this machine/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue to folder browser' }).click();
  await page.getByRole('button', { name: /member@example.test/ }).click();
  await page.getByRole('button', { name: 'Meu Drive' }).click();
  await page.getByRole('button', { name: 'Time' }).click();
  await page.getByRole('button', { name: 'Select this folder' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.changeLocation', confirmed: true, hubId: 'hub' });
  await expect(page.getByText('member@example.test / Time').first()).toBeVisible();
});

test('explains the step that clears a Drive Local conflict copy', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-local-review');
  await expect(page.getByText('SHARING_CONFLICT_COPY')).toBeVisible();
  await expect(page.getByText(/Decide which version is current, then delete or rename the other copies/)).toBeVisible();
});

test('keeps recovery controls after the initial discovery request fails', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&drive=error');
  await page.getByRole('radio', { name: 'Google Drive Local' }).click();
  await expect(page.getByText('SHARING_DRIVE_DISCOVERY_FAILED')).toBeVisible();
  await expect(page.getByText(/Google Drive discovery could not be completed/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeVisible();
});

test('keeps the storage cards and picker on host surface tokens', async ({ page }) => {
  const probe = async (dark: boolean): Promise<{ dark: boolean; surface: string; folder: string }> => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.goto(HARNESS + '?scenario=publishing&theme=host&drive=ready');
    await page.getByRole('radio', { name: 'Google Drive Local' }).click();
    await page.getByRole('button', { name: 'Choose folder' }).click();
    await page.getByRole('dialog', { name: 'Choose a Google Drive folder' }).waitFor();
    return page.evaluate(() => {
      const card = document.querySelector('.kb-storage-card');
      const dialog = document.querySelector('.kb-picker')?.closest('.kb-dialog');
      return {
        dark: document.body.hasAttribute('data-ds-dark-theme'),
        surface: card ? getComputedStyle(card).backgroundColor : '',
        folder: dialog ? getComputedStyle(dialog).backgroundColor : '',
      };
    });
  };
  const light = await probe(false);
  const dark = await probe(true);
  expect(light.dark).toBe(false);
  expect(dark.dark).toBe(true);
  // Both surfaces are painted from the host tokens, so the theme changes their color.
  expect(light.surface).not.toBe(dark.surface);
  expect(light.folder).not.toBe(dark.folder);
  expect(light.surface).not.toBe('');
  expect(light.folder).not.toBe('');
});
