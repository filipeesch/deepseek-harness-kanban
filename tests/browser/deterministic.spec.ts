import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectLegible } from './contrast.js';
const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');
for (const colorScheme of ['light', 'dark'] as const) {
  test('deterministic script controls, review and credentials in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=awaiting-trust');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    else await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme');
    const card = page.locator('[data-task-id="long-0"]');
    await expect(card.locator('.kb-script-card-label')).toHaveText('Script: awaiting local trust');
    await expect(card.locator('.kb-card-activity')).toHaveCount(1);
    expect(await card.locator('.kb-card-activity').evaluate(element => element.getBoundingClientRect().height)).toBe(26);
    await expectLegible(page, '[data-task-id="long-0"] .kb-script-card-label');
    await card.getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    await drawer.getByRole('tab', { name: 'Info', exact: true }).click();
    await expect(drawer.getByRole('button', { name: 'Stop deterministic script' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Review deterministic script and local settings' }).click();
    const review = page.getByRole('dialog', { name: 'Review deterministic script' });
    await expect(review.getByLabel('Exact captured code')).toContainText('await tools.bash');
    await expect(review.getByText('CI_TOKEN — Missing')).toBeVisible();
    const replacement = review.getByLabel('Replacement value for CI_TOKEN');
    await expect(replacement).toHaveAttribute('type', 'password'); await expect(replacement).toHaveValue('');
    await expectLegible(page, '.kb-script-source');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-review-' + colorScheme + '.png') });
    await review.getByRole('button', { name: 'Approve this captured version' }).click();
    await expect(review).toBeHidden();
    await expect(drawer.getByText('Script running', { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Stop deterministic script' }).click();
    await expect(drawer.getByRole('button', { name: 'Play deterministic script' })).toBeVisible();
    await expect(drawer.getByText('Script stopped', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, 'deterministic-stopped-' + colorScheme + '.png') });
    await drawer.getByRole('button', { name: 'Play deterministic script' }).click();
    await expect(drawer.getByText('Script running', { exact: true })).toBeVisible();
    const commands = await page.evaluate(() => (window as unknown as { __harnessCommands(): Array<{ type: string }> }).__harnessCommands());
    expect(commands.map(command => command.type)).toEqual(['task.deterministicApprove', 'task.deterministicStop', 'task.deterministicPlay']);
    expect(await card.getAttribute('data-working')).toBe('true');
    expect(await card.evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none');
    await expect(drawer.locator('[data-native]')).toHaveCount(0);
  });

  test('edits entry parameters from the script panel in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=failed&refusal=parameters');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    else await expect(page.locator('body')).not.toHaveAttribute('data-ds-dark-theme');
    await page.locator('[data-task-id="long-0"]').getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    await drawer.getByRole('tab', { name: 'Info', exact: true }).click();
    await expect(drawer.getByText('Script: parameters required')).toBeVisible();
    await expect(drawer.getByText('Missing required parameter: pipeline')).toBeVisible();
    await expect(drawer.getByText('Parameters: pipeline=ci-main')).toBeVisible();
    await expectLegible(page, '.kb-script-panel');
    await drawer.getByRole('button', { name: 'Edit deterministic script parameters' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit script parameters' });
    await expect(dialog.getByText('CI workflow')).toBeVisible();
    const input = dialog.getByLabel('Parameter pipeline');
    await expect(input).toHaveValue('ci-main');
    await input.fill('ci-other');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-parameters-' + colorScheme + '.png') });
    await dialog.getByRole('button', { name: 'Save values' }).click();
    await expect(dialog).toBeHidden();
    await expect(drawer.getByText('Parameters: pipeline=ci-other')).toBeVisible();
    await drawer.getByRole('button', { name: 'Play deterministic script' }).click();
    await expect(drawer.getByText('Script running', { exact: true })).toBeVisible();
    const commands = await page.evaluate(() => (window as unknown as { __harnessCommands(): Array<{ type: string }> }).__harnessCommands());
    expect(commands.map(command => command.type)).toEqual(['task.deterministicParameters', 'task.deterministicPlay']);
    expect(commands[0]).toMatchObject({ entryId: 'script-entry', values: { pipeline: 'ci-other' } });
  });

  test('delivers a failed saved result from the primary action in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=failed&delivery=failed');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    await page.locator('[data-task-id="long-0"]').getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    await drawer.getByRole('tab', { name: 'Info', exact: true }).click();
    await expect(drawer.getByText(/Deliver retries the saved result and its identities/)).toBeVisible();
    const deliver = drawer.getByRole('button', { name: 'Deliver saved result — deterministic script' });
    await expect(deliver).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Run again — deterministic script' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Retry delivery — deterministic result' })).toHaveCount(0);
    await expectLegible(page, '.kb-script-panel');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-delivery-failed-' + colorScheme + '.png') });
    await deliver.click();
    await expect(drawer.getByText('Script result awaiting delivery', { exact: true })).toBeVisible();
    const commands = await page.evaluate(() => (window as unknown as { __harnessCommands(): Array<{ type: string }> }).__harnessCommands());
    expect(commands.map(command => command.type)).toEqual(['task.deterministicPlay']);
  });

  test('explains a held result and cancels the blocking job in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=result-ready&hold=job');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    const card = page.locator('[data-task-id="long-0"]');
    await expect(card.locator('.kb-script-card-label')).toHaveAttribute('data-held', 'true');
    await card.getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    const notice = drawer.locator('.kb-hold');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Waiting for background work to finish.');
    await expect(notice).toContainText('Job: find the home directory');
    await expect(drawer.getByRole('button', { name: 'Deliver saved result — deterministic script' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Run again — deterministic script' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Play deterministic script' })).toHaveCount(0);
    await expectLegible(page, '.kb-hold');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-hold-job-' + colorScheme + '.png') });
    await notice.getByRole('button', { name: 'Cancel job bash-1' }).click();
    await expect(notice).toHaveCount(0);
    const commands = await page.evaluate(() => (window as unknown as { __harnessCommands(): Array<{ type: string }> }).__harnessCommands());
    expect(commands.map(command => command.type)).toEqual(['task.deterministicCancelJob']);
    expect(commands[0]).toMatchObject({ taskId: 'long-0', jobId: 'bash-1' });
  });

  test('explains pending work behind a held result in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=result-ready&hold=pending');
    if (colorScheme === 'dark') await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '');
    await page.locator('[data-task-id="long-0"]').getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    const notice = drawer.locator('.kb-hold');
    await expect(notice).toContainText('Waiting for your answer in the task conversation.');
    await expect(notice).toContainText('Waiting for: An approval request');
    await expect(notice.getByRole('button', { name: /Cancel job/ })).toHaveCount(0);
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-hold-pending-' + colorScheme + '.png') });
  });
  test('standalone manual handoff context in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(HARNESS + '?scenario=handoff&theme=host');
    await page.getByText('CI → Manual review', { exact: true }).click();
    await expect(page.locator('.kb-handoff-context-fallback-body')).toContainText('Execution synthetic-run · Exit passed');
    await expect(page.locator('.kb-handoff-context-fallback-body')).toContainText('[REDACTED]');
    await expectLegible(page, '.kb-handoff-context-fallback');
    await mkdir(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, 'deterministic-handoff-' + colorScheme + '.png') });
  });
}
test('draws one edge for the deterministic exits without an exit label', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=deterministic&theme=host');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Named exits passed, cached', exact: true })).toHaveCount(0);
  // Exit names live in the stage editor, so the arrow carries no label and no
  // condition mark either.
  const group = page.locator('.kb-flow-edge-group[data-connection-id^="explore->propose"]');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.kb-flow-condition-mark')).toHaveCount(0);
  await expect(group.locator('button')).toHaveCount(0);
  // Nothing the diagram publishes still announces the retired exit label.
  const announced = await page.evaluate(() => [...document.querySelectorAll('.kb-flow-shell [aria-label], .kb-flow-shell [title]')]
    .map(element => (element.getAttribute('aria-label') ?? '') + ' ' + (element.getAttribute('title') ?? ''))
    .filter(name => /named exits|exit name/i.test(name)));
  expect(announced).toEqual([]);
});

test('opens the deterministic stage editor from its connection, only while unlocked', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=deterministic&theme=host');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.locator('.kb-flow-canvas')).toHaveAttribute('data-ready', 'true');
  const edge = page.locator('.kb-flow-edge-group[data-connection-id^="explore->propose"]');
  await expect(edge).toHaveCount(1);
  // The double press is delivered to the connection itself here, so this test covers the
  // surface's contract; the line's own hit target is covered by the connection tests.
  await edge.dispatchEvent('dblclick');
  await page.waitForTimeout(200);
  // The layout lock gates the edit: a locked diagram opens nothing, presents no
  // condition editor, and stores nothing.
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toHaveCount(0);
  await expect(page.locator('.kb-condition-popover')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __harnessCommands(): Array<{ type: string }> }).__harnessCommands())).toEqual([]);
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
  await edge.dispatchEvent('dblclick');
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toBeVisible();
  await expect(page.getByLabel('Execution mode')).toHaveValue('deterministic');
  // The routing is edited in the stage editor, never through a condition.
  await expect(page.locator('.kb-condition-popover')).toHaveCount(0);
});
test('visual deterministic configuration keeps named exits and no prompt/countdown coexistence', async ({ page }) => {
  await page.goto(HARNESS + '?scenario=deterministic&theme=host');
  await page.getByRole('button', { name: 'Edit stage Explore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit stage' });
  await expect(dialog.getByLabel('Execution mode')).toHaveValue('deterministic');
  await expect(dialog.getByLabel('Inline code')).toContainText('return');
  await expect(dialog.getByRole('button', { name: 'Save stage' })).toBeDisabled();
  await expect(dialog.getByLabel('Exit destination 1')).toHaveValue('propose');
  await expect(dialog.getByLabel('Exit destination 2')).toHaveValue('propose');
  await expect(dialog.getByText('Allowed destinations', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Stage id', exact: true })).not.toBeEditable();
  await dialog.getByLabel('Execution directory').selectOption('project');
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-task-id="long-0"]')).toContainText('Script running');
  await expect(page.locator('.kb-card-countdown')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test('presents an infrastructure failure with its origin, attempts and guard facts in ' + colorScheme, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=failed&failure=infrastructure');
    await page.locator('[data-task-id="long-0"]').getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    await drawer.getByRole('tab', { name: 'Info', exact: true }).click();
    await expect(drawer.getByText('Script: infrastructure failure', { exact: true })).toBeVisible();
    const problem = drawer.locator('.kb-script-panel .kb-problem');
    await expect(problem).toContainText('Infrastructure failure');
    await expect(problem).toContainText('3 attempts');
    expect(await problem.textContent()).not.toMatch(/\n\s+at /);
    const facts = drawer.locator('.kb-script-panel .kb-script-facts');
    await expect(facts).toContainText('Failure origin');
    await expect(facts).toContainText('infrastructure');
    await expect(facts).toContainText('BASH_PROTOCOL');
    await expect(facts).toContainText('command not admitted');
    await expectLegible(page, '.kb-script-panel .kb-script-facts');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-infrastructure-' + colorScheme + '.png') });
    await drawer.getByRole('tab', { name: 'History', exact: true }).click();
    const table = page.getByRole('table', { name: 'Task history' });
    await expect(table).toContainText('infrastructure failure · BASH_PROTOCOL · 3 attempts · command not admitted · exit 125');
    expect(await table.textContent()).not.toMatch(/\n\s+at /);
    await page.screenshot({ path: path.join(OUT, 'deterministic-infrastructure-history-' + colorScheme + '.png') });
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test('shows a layered failure and its expandable evidence in a narrow drawer in ' + colorScheme, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(HARNESS + '?scenario=deterministic&theme=host&phase=failed&failure=diagnostic');
    await page.locator('[data-task-id="long-0"]').getByRole('button', { name: 'Open task Long column task 0' }).click();
    const drawer = page.locator('.kb-drawer');
    await drawer.getByRole('tab', { name: 'Info', exact: true }).click();
    await expect(drawer.getByText('Script: infrastructure failure', { exact: true })).toBeVisible();
    const facts = drawer.locator('.kb-script-panel .kb-script-facts');
    await expect(facts).toContainText('Cause');
    await expect(facts).toContainText('TYPESCRIPT_EXCEPTION');
    await expect(facts).toContainText('Guard diagnostic');
    await expect(facts).toContainText('NATIVE_LIFETIME_UNCLEAN');
    await expectLegible(page, '.kb-script-panel .kb-script-facts');
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'deterministic-diagnostic-narrow-' + colorScheme + '.png') });
    await drawer.getByRole('tab', { name: 'History', exact: true }).click();
    const evidence = page.locator('.kb-history-evidence').first();
    await expect(evidence).toBeVisible();
    await evidence.locator('summary').click();
    await expect(evidence).toContainText('stderr: NATIVE_LIFETIME_UNCLEAN');
    await expect(evidence).toContainText('Cause: TYPESCRIPT_EXCEPTION');
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(OUT, 'deterministic-diagnostic-history-' + colorScheme + '.png') });
  });
}

