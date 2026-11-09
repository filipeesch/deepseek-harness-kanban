import { expect, test } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;

test('keeps the project label and attention dots hoverable while the card still activates', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const hits = await page.evaluate(() => {
    const at = (x: number, y: number) => String(document.elementFromPoint(x, y)?.className ?? document.elementFromPoint(x, y)?.tagName ?? '');
    const hit = (selector: string) => {
      const element = document.querySelector(selector)!;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return at(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    return {
      project: hit('[data-task-id="long-0"] .kb-card-project'),
      dot: hit('[data-task-id="long-3"] .kb-dot'),
    };
  });
  expect(hits.project).toContain('kb-card-project');
  expect(hits.dot).toContain('kb-dot');

  await page.locator('[data-task-id="long-0"] .kb-card-project').click();
  await expect(page.locator('.kb-drawer')).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(page.locator('.kb-drawer')).toHaveCount(0);
});

test('does not present a background indicator on the card', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  await expect(page.locator('[data-task-id="long-1"] .kb-background')).toHaveCount(0);
  await expect(page.locator('[data-task-id="long-1"] .kb-card-activity')).not.toContainText('1 job');
  // The task still opens from its title and exposes the background in the drawer.
  await page.getByRole('button', { name: 'Open task Long column task 1', exact: true }).click();
  const drawer = page.locator('.kb-drawer');
  await expect(drawer).toContainText('Long column task 1');
  await expect(drawer.getByRole('tab', { name: /Background activity: Run tests/ })).toBeVisible();
});

test('places the selection control inline in the context row', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  await page.getByRole('button', { name: 'Select cards to delete' }).click();
  const card = page.locator('[data-task-id="long-0"]');
  const checkbox = card.locator('.kb-card-select');
  await expect(checkbox).toBeVisible();
  const layout = await card.evaluate(element => {
    const box = element.querySelector('.kb-card-select')!.getBoundingClientRect();
    const title = element.querySelector('.kb-card-open')!.getBoundingClientRect();
    const project = element.querySelector('.kb-card-project')!.getBoundingClientRect();
    const checkboxElement = element.querySelector('.kb-card-select')!;
    return {
      position: getComputedStyle(checkboxElement).position,
      parent: checkboxElement.parentElement?.className ?? '',
      checkboxTop: box.top,
      titleBottom: title.bottom,
      checkboxLeft: box.left,
      projectLeft: project.left,
    };
  });
  expect(layout.parent).toContain('kb-card-context');
  expect(layout.position).not.toBe('absolute');
  expect(layout.checkboxTop).toBeGreaterThanOrEqual(layout.titleBottom);
  expect(layout.checkboxLeft).toBeLessThan(layout.projectLeft);
  const button = card.getByRole('button', { name: 'Select task Long column task 0' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await card.locator('.kb-card-open').click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('wraps a long title and truncates a long project name', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=activity');
  await page.waitForSelector('.kb-card');
  const card = page.locator('[data-task-id="long-title"]');
  const title = 'A very long task title that should wrap across multiple lines in the narrow card';
  const project = 'A very long project name that must truncate inside the card';
  const layout = await card.evaluate(element => {
    const strong = element.querySelector('.kb-card-open strong')!;
    const projectLabel = element.querySelector('.kb-card-project')!;
    return {
      titleText: strong.textContent,
      titleHeight: strong.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(strong).lineHeight),
      lineClamp: getComputedStyle(strong).webkitLineClamp,
      projectScroll: projectLabel.scrollWidth,
      projectClient: projectLabel.clientWidth,
      projectTitle: projectLabel.getAttribute('title'),
    };
  });
  expect(layout.titleText).toBe(title);
  expect(layout.titleHeight).toBeGreaterThan(layout.lineHeight * 1.5);
  expect(['none', '']).toContain(layout.lineClamp);
  expect(layout.projectScroll).toBeGreaterThan(layout.projectClient);
  expect(layout.projectTitle).toBe(project);
  await expect(card.getByRole('button', { name: 'Open task ' + title })).toBeVisible();
});
