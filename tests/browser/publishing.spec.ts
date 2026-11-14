import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expectLegible } from './contrast.js';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

async function sharingCommands(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __harness: { sharingCommands(): Array<Record<string, unknown>> } }).__harness.sharingCommands());
}

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  await mkdir('.verification', { recursive: true });
  await page.screenshot({ path: path.join('.verification', name), fullPage });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test('shows a safe update-required board in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(HARNESS + '?scenario=publishing&sharing=update-required&theme=host');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    else await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme');
    const row = page.getByRole('list', { name: 'Published boards' }).getByRole('listitem').filter({ hasText: 'Harness board' });
    await expect(row.getByText('Plugin update required')).toBeVisible();
    await expect(row.getByRole('button', { name: /Publish|Use the team version|Keep the local version/ })).toHaveCount(0);
    await expect(page.getByText('Update the plugin', { exact: true })).toBeVisible();
    await expectLegible(page, '.kb-share-board-state');
    await shot(page, 'deterministic-team-update-required-' + colorScheme + '.png');
  });
}

test('connects an unpublished Hub through Team Settings', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Connection' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Changes' })).toHaveCount(0);
  await page.getByLabel('Repository address').fill('https://example.test/team.git');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.connect', hubId: 'hub', provider: 'git', settings: { repository: 'https://example.test/team.git' } });
  await shot(page, 'team-settings-connection.png');
});

test('offers one card per storage and switches the connection surface', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  const cards = page.getByRole('radiogroup', { name: 'Team storage' }).getByRole('radio');
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole('radio', { name: 'Git repository' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Google Drive Cloud' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
  await expect(page.getByLabel('Repository address')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Local folder' }).click();
  await expect(page.getByLabel('Team folder path')).toHaveValue('~/.dsh-kanban/hub');
});

test('previews existing team boards and offers both first-connection choices', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=folder-preview');
  await expect(page.getByText(/already has 2 published boards/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Published boards' })).toContainText('Team board');
  await expect(page.getByRole('list', { name: 'Published boards' })).toContainText('In both');
  await page.getByRole('button', { name: 'Get the team boards' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.receive' });
  await page.getByRole('button', { name: 'Publish these boards instead' }).click();
  await page.getByRole('button', { name: 'Replace the published boards' }).click();
  await expect.poll(async () => (await sharingCommands(page))[1]).toMatchObject({ type: 'sharing.publishInitial', confirmed: true });
  await shot(page, 'team-settings-preview.png');
});

test('shows the connection and changes areas with connection details once', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=folder');
  const connection = page.getByRole('region', { name: 'Connection' });
  const changes = page.getByRole('region', { name: 'Changes' });
  await expect(connection).toBeVisible();
  await expect(changes).toBeVisible();
  await expect(connection).toContainText('Local folder');
  await expect(connection).toContainText('~/.dsh-kanban/hub');
  await expect(connection.getByRole('radiogroup', { name: 'Team storage' })).toHaveCount(0);
  const changesText = await changes.innerText();
  expect(changesText).not.toContain('~/.dsh-kanban/hub');
  expect(changesText).not.toContain('Check every');
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await shot(page, 'team-settings-two-areas.png');
});

test('publishes one board from its row', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=draft');
  const row = page.getByRole('list', { name: 'Published boards' }).getByRole('listitem').filter({ hasText: 'Harness board' });
  await expect(row.getByText('Changes not sent')).toBeVisible();
  await row.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishBoard', hubId: 'hub', boardId: 'board' });
});

test('publishes every pending board', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=draft');
  await page.getByRole('button', { name: 'Publish all' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishAll', hubId: 'hub' });
});

test('gets one board updates from its row and every update from the Hub', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=updates');
  await expect(page.getByText(/New from the team: Team board/)).toBeVisible();
  const row = page.getByRole('list', { name: 'Published boards' }).getByRole('listitem').filter({ hasText: 'Harness board' });
  await row.getByRole('button', { name: 'Get updates', exact: true }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.updateBoard', boardId: 'board' });
  await page.getByRole('button', { name: 'Get updates', exact: true }).first().click();
  await expect.poll(async () => (await sharingCommands(page))[1]).toMatchObject({ type: 'sharing.getUpdates' });
});

test('shows the semantic change summary and resolves a board conflict', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=review');
  await expect(page.getByText('Needs a choice', { exact: true })).toBeVisible();
  await expect(page.getByText('Stage “explore” renamed to “discover”')).toBeVisible();
  await page.getByRole('button', { name: 'Use the team version' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.resolve', boardId: 'board', choice: 'team' });
  await page.getByRole('button', { name: 'Keep the local version' }).click();
  await expect.poll(async () => (await sharingCommands(page))[1]).toMatchObject({ type: 'sharing.resolve', boardId: 'board', choice: 'local' });
  await shot(page, 'team-settings-review.png');
});

test('publishes an orphan and restores a board removed only here', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=orphan');
  await expect(page.getByText('Removed by the team')).toBeVisible();
  await page.getByRole('button', { name: 'Publish as a new board' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishOrphan', boardId: 'board' });

  await page.goto(HARNESS + '?scenario=publishing&sharing=removed');
  await expect(page.getByText('Removed here')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.restore', boardId: 'old-board' });
});

test('explains an unavailable repository', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=unavailable');
  await expect(page.getByText('The team repository could not be reached.')).toBeVisible();
  await expect(page.getByText('Updates unavailable', { exact: true }).first()).toBeVisible();
  await expectLegible(page, '.kb-share-meta');
});

test('shows both banner directions and a count on both tab rows', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=sharing&sharing=updates');
  await expect(page.getByText('Your team published changes to this board.')).toBeVisible();
  await expect(page.getByRole('img', { name: /boards? to get/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team updates available for this board (2)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get updates' })).toBeVisible();
  await page.getByRole('button', { name: 'Review team changes' }).click();
  await expect(page.getByRole('tab', { name: 'Team Settings' })).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'sharing-banner-updates.png', false);

  await page.goto(HARNESS + '?scenario=sharing&sharing=draft');
  await expect(page.getByText('You have changes to send for this board.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish board' })).toBeVisible();
  await expect(page.getByRole('img', { name: '1 board to publish' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Board changes not sent (2)' })).toBeVisible();
  // Captured before the click: the print must show the draft banner itself.
  await shot(page, 'sharing-banner-draft.png', false);
  await page.getByRole('button', { name: 'Publish board' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishBoard', boardId: 'board' });

  await page.goto(HARNESS + '?scenario=sharing&sharing=review');
  await expect(page.getByText('Your team changed this board in a way that needs a choice.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'This board needs a team review' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=orphan');
  await expect(page.getByRole('img', { name: 'Board removed by the team' })).toBeVisible();

  await page.goto(HARNESS + '?scenario=sharing&sharing=preview');
  await expect(page.getByRole('img', { name: 'Team storage connection needs review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review team changes' })).toHaveCount(0);
});

test('Save and share publishes the board after the local save', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow&sharing=published');
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Workflow' }).click();
  await expect(page.getByRole('button', { name: 'Save and share' })).toBeVisible();
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
  expect((await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.publishBoard', boardId: 'board' });
});

test('a failed share keeps the local save and reports the failure', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=workflow&sharing=share-fail');
  await page.getByRole('tablist', { name: 'Board configuration sections' }).getByRole('tab', { name: 'Workflow' }).click();
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

test('renders the Google Drive Cloud connect surface', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing');
  await page.getByRole('radio', { name: 'Google Drive Cloud' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.auth.start' });
});

test('renders the connected Google Drive surface with its account', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive');
  await expect(page.getByRole('region', { name: 'Connection' })).toContainText('Google Drive');
  await expect(page.getByRole('button', { name: 'Switch account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
});

test('renders the Google Drive Local surface and its unavailable state', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-local');
  await expect(page.getByRole('button', { name: 'Change folder' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Connection' })).toContainText('member@example.test / Projetos');

  await page.goto(HARNESS + '?scenario=publishing&sharing=drive-local-unavailable');
  await expect(page.getByText('The Google Drive location is no longer mounted on this machine.')).toBeVisible();
  await shot(page, 'team-settings-drive-local-unavailable.png');
});

test('presents a conflict copy as a review', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=folder-review');
  await expect(page.getByText(/Another copy of the team configuration is in this folder/).first()).toBeVisible();
  await expect(page.getByText('SHARING_CONFLICT_COPY').first()).toBeVisible();
  await page.goto(HARNESS + '?scenario=sharing&sharing=folder-review');
  await expect(page.getByRole('img', { name: 'Team review needed' })).toBeVisible();
});

test('disconnects a connected local folder', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=publishing&sharing=folder');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText(/Disconnecting stops automatic checks and removes the binding/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect.poll(async () => (await sharingCommands(page))[0]).toMatchObject({ type: 'sharing.disconnect', hubId: 'hub' });
});

test('renders the connection surface with the host theme tokens in both appearances', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Get the team boards' })).toBeVisible();
  const light = await primary();
  expect(light.dark).toBe(false);
  expect(light.expectedFill).not.toBe('');
  expect(light.fill).toBe(light.expectedFill);
  expect(light.label).toBe(light.expectedLabel);
  expect(light.contrast, 'the primary label is legible in light').toBeGreaterThanOrEqual(4.5);
  await shot(page, 'local-folder-light.png');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
  const dark = await primary();
  expect(dark.dark).toBe(true);
  expect(dark.expectedFill).not.toBe(light.expectedFill);
  expect(dark.fill).toBe(dark.expectedFill);
  expect(dark.label).toBe(dark.expectedLabel);
  expect(dark.contrast, 'the primary label is legible in dark').toBeGreaterThanOrEqual(4.5);
  await shot(page, 'local-folder-dark.png');
});
