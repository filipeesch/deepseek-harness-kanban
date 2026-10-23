import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('drawer plays entrance and exit animations and does not replay when switching cards', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Long column task 0' }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toHaveAttribute('data-entering', 'true');
  expect(await drawer.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Open task Long column task 1', exact: true }).click();
  await expect(drawer).not.toHaveAttribute('data-entering', 'true');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(drawer).toHaveAttribute('data-closing', 'true');
  await expect(drawer).toHaveAttribute('inert', '');
  await expect(drawer).toBeHidden({ timeout: 1000 });
  await expect(page.getByRole('button', { name: 'Open task Long column task 1', exact: true })).toBeFocused();
});

test('reduced motion removes the drawer animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HARNESS + '?scenario=board');
  await page.getByRole('button', { name: 'Open task Long column task 0' }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).not.toHaveAttribute('data-entering', 'true');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(drawer).toBeHidden({ timeout: 500 });
});
