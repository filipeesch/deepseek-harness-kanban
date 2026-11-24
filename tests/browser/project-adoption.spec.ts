import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await mkdir('.verification', { recursive: true });
  await page.screenshot({ path: path.join('.verification', name), fullPage: true });
}

test('presents the projects a team board names and cannot answer', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(HARNESS + '?scenario=project-adoption&theme=host');
    await expect(page.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/One project awaits adoption/)).toBeVisible();
    await expect(page.getByText(/Named by: Harness board/).first()).toBeVisible();
    await expect(page.getByText('Awaiting adoption')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ignored project identities' })).toBeVisible();
    await expect(page.getByText(/Team key: team-api/)).toBeVisible();
    await shot(page, 'project-adoption-projects-' + colorScheme + '.png');
  }
});

test('links a received identity to a project the Hub already has', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=project-adoption&theme=host');
  await page.getByRole('button', { name: 'Link Team planning to a project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link Team planning to a project' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Project to link' }).selectOption('p2');
  await expect(dialog.getByText(/keeps its name, its local key/)).toBeVisible();
  await shot(page, 'project-adoption-link.png');
});

test('points from Team Settings to the Projects section', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=project-adoption&theme=host');
  await page.getByRole('tablist', { name: 'Configuration sections' }).getByRole('tab', { name: 'Team Settings' }).click();
  await expect(page.getByText(/awaits adoption/)).toBeVisible();
  await shot(page, 'project-adoption-team-settings.png');
  await page.getByRole('button', { name: 'Open Projects' }).click();
  await expect(page.getByRole('button', { name: 'Adopt Team planning' })).toBeVisible();
});
