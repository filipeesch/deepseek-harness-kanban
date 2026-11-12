// Plugin-owned real-composition scenario for the manual DSH e2e lane.
// The runner copies this file into $DSH_CHECKOUT/apps/web/tests/ and removes it
// after the pinned web lane runs. It never calls a model.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const OUT = join(KANBAN_ROOT, '.verification');

const workflowYaml = [
  'name: Transit Flow',
  'initial_column: explore',
  'columns:',
  '  - id: explore',
  '    label: Explore',
  '    allowed_transitions: [propose]',
  '  - id: propose',
  '    label: Propose',
  '  - id: apply',
  '    label: Apply',
  '',
].join(String.fromCharCode(10));

/** A scaffold plus the page a scenario drives, torn down together. */
async function openLane(): Promise<{ page: Page; workspaceCwd: string }> {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  return { page, workspaceCwd: scaffold.workspaceCwd };
}

/** One project and the two-stage-plus-transit workflow this lane drives. */
async function seedBoard(page: Page, workspaceCwd: string): Promise<void> {
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Harness');
  await projectDialog.getByRole('textbox', { name: 'Project path' }).fill(workspaceCwd);
  await projectDialog.getByRole('textbox', { name: 'Project path' }).press('Tab');
  await expect(projectDialog.getByText('No Git repository found')).toBeVisible();
  await projectDialog.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Project saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Board' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(workflowYaml);
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText('Workflow saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Close Kanban configuration' }).click();
}

/** Creates one task in the initial stage and closes the drawer it opens. */
async function createTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New task' }).first().click();
  const create = page.getByRole('dialog', { name: 'New task' });
  await create.getByRole('textbox', { name: 'Title' }).fill(title);
  await create.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Harness' });
  await create.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('button', { name: 'Open task ' + title })).toBeVisible();
  if (await page.locator('.kb-drawer').count() > 0) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.kb-drawer')).toHaveCount(0);
  }
}

/** Opens the workflow presentation and waits for the diagram to settle. */
async function openDiagram(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(300);
}

/** Records whether a transit and an arrival pulse were ever presented, and how many flights mounted. */
async function watchMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __transitSeen?: boolean; __arrivalSeen?: boolean; __transitGroups?: number };
    scope.__transitSeen = false;
    scope.__arrivalSeen = false;
    scope.__transitGroups = 0;
    new MutationObserver(records => {
      for (const record of records) {
        for (const added of [...record.addedNodes]) {
          if (!(added instanceof Element)) continue;
          if (added.classList.contains('kb-flow-transit') || added.querySelector('.kb-flow-transit') !== null) scope.__transitGroups = (scope.__transitGroups ?? 0) + 1;
        }
      }
      if (document.querySelector('.kb-flow-transit') !== null) scope.__transitSeen = true;
      if (document.querySelector('.kb-card-arrival') !== null) scope.__arrivalSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

/** Drags a card from its own title to the card list of another stage. */
async function dragCardToStage(page: Page, title: string, stageLabel: string): Promise<void> {
  const card = page.locator('.kb-card', { hasText: title }).first().locator('.kb-card-open');
  const target = page.locator('.kb-flow-stage', { hasText: stageLabel }).locator('.kb-card-list');
  const cardBox = (await card.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
  await page.mouse.up();
}

it('presents a transit along the drawn connection and never a duplicate card', async () => {
  const { page, workspaceCwd } = await openLane();
  await seedBoard(page, workspaceCwd);
  await createTask(page, 'Transit task');
  await openDiagram(page);
  await watchMotion(page);
  // Freeze the particles so the flight can be photographed mid-connection.
  await page.addStyleTag({ content: '.kb-flow-transit-particle{animation-play-state:paused !important}' });
  await dragCardToStage(page, 'Transit task', 'Propose');
  await page.waitForFunction(() => document.querySelector('.kb-flow-transit') !== null, undefined, { timeout: 15_000 });
  const transit = page.locator('.kb-flow-transit');
  await expect(transit).toHaveCount(1);
  expect(await transit.getAttribute('data-transit-from')).toBe('explore');
  expect(await transit.getAttribute('data-transit-to')).toBe('propose');
  // The card is presented once, in the destination: the transit is its only other trace.
  expect(await page.locator('[data-task-id]', { hasText: 'Transit task' }).count()).toBe(1);
  await expect(page.getByRole('region', { name: 'Propose stage' }).getByRole('button', { name: 'Open task Transit task' })).toBeVisible();
  await page.evaluate(() => {
    for (const particle of document.querySelectorAll<HTMLElement>('.kb-flow-transit-particle')) {
      const animation = particle.getAnimations()[0];
      if (animation === undefined) continue;
      animation.currentTime = Number(animation.effect?.getTiming().duration ?? 0) * 0.55;
    }
  });
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, 'e2e-transit-flight.png') });

  // Let the flight finish: the arrival pulse is the only signal on the card itself.
  await page.evaluate(() => { for (const element of document.querySelectorAll('style')) if (element.textContent?.includes('kb-flow-transit-particle{animation-play-state:paused')) element.remove(); });
  await page.waitForFunction(() => (window as unknown as { __arrivalSeen?: boolean }).__arrivalSeen === true, undefined, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __transitGroups?: number }).__transitGroups)).toBe(1);
  await page.screenshot({ path: join(OUT, 'e2e-transit-arrival.png') });
}, 180000);

it('presents only the arrival pulse for a move the diagram draws no arrow for', async () => {
  const { page, workspaceCwd } = await openLane();
  await seedBoard(page, workspaceCwd);
  await createTask(page, 'Restricted task');
  await openDiagram(page);
  // Freeze the pulse so the arrival-only signal can be photographed.
  await page.addStyleTag({ content: '.kb-card-arrival{animation-play-state:paused !important}' });
  await watchMotion(page);
  // Explore only connects to Propose, so moving to Apply asks for the override.
  await dragCardToStage(page, 'Restricted task', 'Apply');
  const dialog = page.getByRole('dialog', { name: 'Move to Apply?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Move anyway' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await page.waitForFunction(() => (window as unknown as { __arrivalSeen?: boolean }).__arrivalSeen === true, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('.kb-card-arrival')) {
      const animation = element.getAnimations()[0];
      if (animation !== undefined) animation.currentTime = 150;
    }
  });
  await page.screenshot({ path: join(OUT, 'e2e-transit-arrival-only.png') });
  await page.evaluate(() => { for (const element of document.querySelectorAll('style')) if (element.textContent?.includes('kb-card-arrival{animation-play-state:paused')) element.remove(); });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __transitSeen?: boolean }).__transitSeen)).toBe(false);
  expect(await page.locator('[data-task-id]', { hasText: 'Restricted task' }).count()).toBe(1);
  await expect(page.getByRole('region', { name: 'Apply stage' }).getByRole('button', { name: 'Open task Restricted task' })).toBeVisible();
}, 180000);
