import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('keeps Dismiss leading and wraps the confirmation in a narrow conversation panel', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=question');
  const footer = page.locator('.kq-footer');
  await expect(footer).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  const dismissBox = (await dismiss.boundingBox())!;
  const nextBox = (await next.boundingBox())!;
  expect(dismissBox.x).toBeLessThan(nextBox.x);

  await page.getByRole('textbox').first().fill('Draft answer');
  await dismiss.click();
  const confirmation = page.getByText(/Discard this and other unanswered rounds/);
  await expect(confirmation).toBeVisible();
  const keep = page.getByRole('button', { name: 'Keep answering' });
  await expect(keep).toBeVisible();
  const layout = await footer.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  await keep.click();
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
});
