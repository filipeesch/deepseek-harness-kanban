// Real native profile composition; local scripts and replay-only downstream turn.
// The runner stages this template outside the read-only DSH checkout.
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import './kanban-e2e-setup.ts';
import { launchWebScaffold } from './scaffold.ts';
import { newEnglishPage } from './support.ts';

const ROOT = process.env.KANBAN_ROOT!;
function unwrap(result: any): any {
  if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
  return result.value;
}

it('runs local Bash/TypeScript loops, repairs via Play, reloads captures, and hands off one replay turn', { timeout: 240000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'kanban-deterministic-composition-'));
  onTestFinished(async () => { await rm(fixture, { recursive: true, force: true }); });
  const overlay = join(fixture, 'native-test-policy.yaml');
  // Explicit deployment policy for this disposable world, not script escalation.
  await writeFile(overlay, '- id: sandbox-policy\n  config:\n    mode: danger-full-access\n    workspaceRoot: !!js process.cwd()\n- id: permission\n  config:\n    defaultPreset: danger-full-access\n');
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: ROOT, enabled: true }] }, extraOverlayPath: overlay,
    replayFixture: join(fixture, 'override-only.jsonl'),
    replayOverride: join(ROOT, 'tests/e2e-dsh/deterministic.replay.override.json'),
  });
  onTestFinished(async () => { await scaffold.close(); });
  const controller = () => {
    const service = scaffold.ctx.get('kanbanController') as any;
    if (!service) throw new Error('The built plugin did not activate its native controller.');
    return service;
  };
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: any) => unwrap(await controller().command(value));
  const first = await snapshot();
  const hubId = first.state.hubs[0].id;
  const boardId = first.state.hubs[0].boards[0].id;
  const task = async () => (await snapshot()).state.hubs.find((hub: any) => hub.id === hubId).tasks.find((value: any) => value.title === 'Local deterministic check');
  const summary = async () => { const state = await snapshot(); const value = await task(); return state.deterministic?.[value.id]; };
  const observe = async (name: string) => {
    try { return (await readFile(join(scaffold.workspaceCwd, name), 'utf8')).trim().split('\n').filter(Boolean); }
    catch { return []; }
  };
  const approve = async () => {
    const value = await task();
    try { await expect.poll(async () => (await summary())?.phase).toBe('awaiting-trust'); }
    catch (error) { throw new Error('Deterministic entry did not reach review: ' + JSON.stringify(await summary()), { cause: error }); }
    const review = unwrap(await controller().deterministicReview({ boardId, stageId: value.columnId, taskId: value.id }));
    await command({ type: 'board.deterministicApprove', boardId, stageId: value.columnId, fingerprint: review.version.fingerprint, stageGeneration: review.version.stageGeneration, taskId: value.id });
  };
  const reloadPlugin = async () => {
    const manager = scaffold.ctx.get('pluginManager') as any;
    expect(manager, 'Native profile must compose the public plugin manager.').toBeDefined();
    expect((await manager.setBundleEnabled('dsh-kanban', false)).application).toBe('applied');
    expect((await manager.setBundleEnabled('dsh-kanban', true)).application).toBe('applied');
    await expect.poll(() => Boolean(scaffold.ctx.get('kanbanController'))).toBe(true);
  };
  const project = { name: 'Local checks', projectPath: scaffold.workspaceCwd, projectKey: 'local-checks' };
  await command({ type: 'project.save', hubId, project });
  const projectId = (await snapshot()).state.hubs[0].projects[0].id;
  const originalBash = await readFile(join(ROOT, 'tests/e2e-dsh/deterministic/wait-ci.sh'), 'utf8');
  const originalTypeScript = 'if (input.handoff?.exit !== "passed" || input.handoff?.message !== "Local CI passed.") throw new Error("Missing source handoff.");\n' +
    'const fs = await import("node:fs/promises"); let localCounter = 0; await fs.appendFile(".fake-review-attempts", JSON.stringify({attempt:input.attempt, attemptId:input.attemptId, startedAt:input.startedAt, restartCount:input.restartCount, localCounter:++localCounter}) + "\\n");\n' +
    (await readFile(join(ROOT, 'tests/e2e-dsh/deterministic/wait-ci.ts'), 'utf8')).replaceAll('fake-ci.cjs', 'fake-review.cjs');
  await writeFile(join(scaffold.workspaceCwd, 'wait-ci.sh'), originalBash);
  await writeFile(join(scaffold.workspaceCwd, 'wait-review.ts'), originalTypeScript);
  await copyFile(join(ROOT, 'tests/e2e-dsh/deterministic/fake-ci.cjs'), join(scaffold.workspaceCwd, 'fake-ci.cjs'));
  const checker = await readFile(join(ROOT, 'tests/e2e-dsh/deterministic/fake-ci.cjs'), 'utf8');
  await writeFile(join(scaffold.workspaceCwd, 'fake-review.cjs'), checker.replaceAll('.fake-ci-', '.fake-review-'));
  await writeFile(join(scaffold.workspaceCwd, '.fake-ci-state'), 'pending');
  await writeFile(join(scaffold.workspaceCwd, '.fake-review-state'), 'pending');
  const workflow = [
    'name: Deterministic native lane', 'initial_column: wait_bash', 'columns:',
    '  - id: wait_bash', '    label: Wait Bash', '    deterministic:', '      language: bash', '      directory: task', '      file: wait-ci.sh',
    '      params:', '        - name: pipeline', '          description: Local CI pipeline identifier.',
    '      exits: { passed: wait_ts, rejected: fix, error: repair }',
    '  - id: wait_ts', '    label: Wait TypeScript', '    deterministic:', '      language: typescript', '      directory: task', '      file: wait-review.ts',
    '      exits: { passed: review, rejected: fix, error: repair }',
    '  - id: review', '    label: Review', '    on_enter_prompt: Review the deterministic result.', '    allowed_transitions: []',
    '  - id: fix', '    label: Fix', '  - id: repair', '    label: Repair', '',
  ].join('\n');
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: workflow });
  await command({ type: 'task.create', hubId, boardId, projectId, title: 'Local deterministic check', description: '', autoMode: false });
  const taskId = (await task()).id;
  expect((await task()).sessionIds).toEqual([]);
  // A parameterized initial stage refuses the value-less entry in place.
  await expect.poll(async () => (await summary())?.phase).toBe('failed');
  expect((await summary())?.error?.code).toBe('PARAMETERS_REQUIRED');
  const firstEntry = (await task()).stageEntry.id;
  await command({ type: 'task.deterministicParameters', taskId, entryId: firstEntry, values: { pipeline: 'local-ci' } });
  await command({ type: 'task.deterministicPlay', taskId });
  await approve();
  await expect.poll(async () => (await observe('.fake-ci-observations')).filter(value => value === 'pending').length, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  const firstExecution = await summary();
  await command({ type: 'task.deterministicStop', taskId, executionId: firstExecution.executionId });
  await expect.poll(async () => (await summary())?.phase).toBe('stopped');
  await reloadPlugin();
  expect(await summary()).toMatchObject({ phase: 'stopped', executionId: firstExecution.executionId, startedAt: firstExecution.startedAt });

  // Play captures edited primary bytes, requires new trust, and follows error.
  await writeFile(join(scaffold.workspaceCwd, 'wait-ci.sh'), 'printf "Broken local checker.\n" >&2; exit 3\n');
  await command({ type: 'task.deterministicPlay', taskId });
  expect((await task()).columnId).toBe('wait_bash');
  await expect.poll(async () => (await summary())?.executionId).not.toBe(firstExecution.executionId);
  await approve();
  await expect.poll(async () => (await task()).columnId).toBe('repair');
  expect((await task()).sessionIds).toEqual([]);
  const failures = (await task()).history.filter((row: any) => row.kind === 'deterministic-execution' && row.outcome === 'failed');
  expect(failures).toHaveLength(1);
  await writeFile(join(scaffold.workspaceCwd, 'wait-ci.sh'), originalBash);
  await command({ type: 'task.move', hubId, taskId, columnId: 'wait_bash' });
  await expect.poll(async () => (await summary())?.phase).toBe('failed');
  expect((await summary())?.error?.code).toBe('PARAMETERS_REQUIRED');
  const reentry = (await task()).stageEntry.id;
  await command({ type: 'task.deterministicParameters', taskId, entryId: reentry, values: { pipeline: 'local-ci' } });
  await command({ type: 'task.deterministicPlay', taskId });
  await expect.poll(async () => (await summary())?.phase).toBe('active');
  await writeFile(join(scaffold.workspaceCwd, '.fake-ci-state'), 'passed');
  await expect.poll(async () => (await task()).columnId).toBe('wait_ts');
  expect((await task()).sessionIds).toEqual([]);
  await approve();
  try { await expect.poll(async () => (await observe('.fake-review-observations')).filter(value => value === 'pending').length, { timeout: 10000 }).toBeGreaterThanOrEqual(2); }
  catch (error) { throw new Error('Review observations missing: ' + JSON.stringify({ summary: await summary(), task: await task() }), { cause: error }); }
  const beforeReload = await summary();
  await writeFile(join(scaffold.workspaceCwd, 'wait-review.ts'), 'throw new Error("Unapproved replacement must not run during recovery.");');
  await reloadPlugin();
  try { await expect.poll(async () => (await summary())?.phase).toBe('active'); }
  catch (error) { throw new Error('Active recovery failed: ' + JSON.stringify(await summary()), { cause: error }); }
  expect(await summary()).toMatchObject({ executionId: beforeReload.executionId, startedAt: beforeReload.startedAt });
  await expect.poll(async () => (await summary())?.restartCount ?? -1).toBeGreaterThan(beforeReload.restartCount);
  await expect.poll(async () => (await observe('.fake-review-attempts')).length).toBe(2);
  const attempts = (await observe('.fake-review-attempts')).map(value => JSON.parse(value));
  expect(attempts[0]).toMatchObject({ attempt: beforeReload.attempt, startedAt: beforeReload.startedAt, restartCount: beforeReload.restartCount, localCounter: 1 });
  expect(attempts[1]).toMatchObject({ attempt: beforeReload.attempt + 1, startedAt: beforeReload.startedAt, restartCount: beforeReload.restartCount + 1, localCounter: 1 });
  expect(attempts[1].attemptId).not.toBe(attempts[0].attemptId);
  const settledTurn = scaffold.whenTurnSettled(30000);
  // Interrupt the first native admission after placement. The reloaded plugin
  // must reuse the durable delivery identity while the old instance is stale.
  const priorApp = controller().app as any;
  const originalDeliver = priorApp.sessions.deliverStageInstruction.bind(priorApp.sessions);
  let entered!: () => void; let unblock!: () => void;
  const admissionEntered = new Promise<void>(resolve => { entered = resolve; });
  const blockedAdmission = new Promise<void>(resolve => { unblock = resolve; });
  priorApp.sessions.deliverStageInstruction = async (id: string, delivery: any) => { entered(); await blockedAdmission; return originalDeliver(id, delivery); };
  try {
    await writeFile(join(scaffold.workspaceCwd, '.fake-review-state'), 'passed');
    await admissionEntered;
    await reloadPlugin();
  } finally { unblock(); }
  const sessionId = await settledTurn;
  await expect.poll(async () => (await task()).columnId).toBe('review');
  expect((await task()).sessionIds).toEqual([String(sessionId)]);
  expect((await task()).autoMode?.enabled ?? false).toBe(false);
  const query = scaffold.ctx.get('sessionQuery') as any;
  const observation = await query.observeSession(SessionId(String(sessionId)), { projectionMode: 'none', signal: AbortSignal.timeout(10000) });
  let events: any[];
  try { events = [...observation.events]; } finally { observation[Symbol.dispose](); }
  const instructions = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'stage-instruction');
  expect(instructions).toHaveLength(1);
  const content = JSON.stringify(instructions[0].data.content);
  expect(content).toContain('Review the deterministic result.');
  expect(content).toContain('Local CI passed.');
  expect(content).toContain('passed');
  expect(events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')).toHaveLength(0);
  expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1);
  expect(events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'kanban-task')).toHaveLength(1);
  const safe = await snapshot();
  expect(JSON.stringify(safe)).not.toContain('sourceRef');
  expect(JSON.stringify(safe)).not.toContain('Unapproved replacement must not run');
  await mkdir(join(ROOT, '.verification'), { recursive: true });
  await writeFile(join(ROOT, '.verification/deterministic-e2e-report.json'), JSON.stringify({
    status: 'passed', nativeBundleActivated: true, bashLoop: true, typeScriptLoop: true,
    stoppedAcrossReload: true, activeRestartPreservedStart: true, changedPrimaryIgnored: true, interruptedNativeAdmissionRecovered: true,
    errorRoute: true, playInPlace: true, parameterRefusalRepairedInPlace: true, scriptChainWithoutConversation: true, downstreamReplayTurns: 1, handoffContexts: 1,
    boundary: 'Native profile/plugin reload; abrupt process loss is separately verified by deterministic-ownership.test.ts.',
  }, null, 2) + '\n');
});

it('recovers an entry before source capture and a held terminal result without re-running', { timeout: 120000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'kanban-deterministic-recovery-'));
  onTestFinished(async () => { await rm(fixture, { recursive: true, force: true }); });
  const overlay = join(fixture, 'native-test-policy.yaml');
  await writeFile(overlay, '- id: sandbox-policy\n  config:\n    mode: danger-full-access\n    workspaceRoot: !!js process.cwd()\n- id: permission\n  config:\n    defaultPreset: danger-full-access\n');
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: ROOT, enabled: true }] }, extraOverlayPath: overlay });
  onTestFinished(async () => { await scaffold.close(); });
  const controller = () => scaffold.ctx.get('kanbanController') as any;
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: any) => unwrap(await controller().command(value));
  const state = await snapshot(); const hubId = state.state.hubs[0].id; const boardId = state.state.hubs[0].boards[0].id;
  await command({ type: 'project.save', hubId, project: { name: 'Recovery fixture', projectPath: scaffold.workspaceCwd, projectKey: 'recovery' } });
  const projectId = (await snapshot()).state.hubs[0].projects[0].id;
  const original = `printf 'run\\n' >> .recovery-runs; while [ ! -f .recovery-ready ]; do sleep 0.05; done; printf '%s\\n' '{"exit":"done","message":"Recovered result"}'`;
  const yaml = (code: string) => 'name: Recovery\ninitial_column: wait\ncolumns:\n  - id: wait\n    label: Waiting\n    deterministic:\n      language: bash\n      code: ' + JSON.stringify(code) + '\n      exits: {done: done}\n  - {id: done, label: Done}\n';
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: yaml(original) });
  const app = controller().app as any;
  app.deterministicRuntime.dispose(); await app.deterministicRuntime.settle();
  await command({ type: 'task.create', hubId, boardId, projectId, title: 'Recover pending activation', description: '', autoMode: true });
  const task = async () => (await snapshot()).state.hubs[0].tasks.find((value: any) => value.title === 'Recover pending activation');
  const taskId = (await task()).id;
  expect((await snapshot()).deterministic[taskId].phase).toBe('capture-pending');
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: yaml('exit 99') });
  const manager = scaffold.ctx.get('pluginManager') as any;
  const reload = async () => {
    expect((await manager.setBundleEnabled('dsh-kanban', false)).application).toBe('applied');
    expect((await manager.setBundleEnabled('dsh-kanban', true)).application).toBe('applied');
    await expect.poll(() => Boolean(controller())).toBe(true);
  };
  await reload();
  await expect.poll(async () => (await snapshot()).deterministic?.[taskId]?.phase).toBe('awaiting-trust');
  const review = unwrap(await controller().deterministicReview({ boardId, stageId: (await task()).columnId, taskId })); expect(review.code).toBe(original);
  await command({ type: 'board.deterministicApprove', boardId, stageId: (await task()).columnId, fingerprint: review.version.fingerprint, stageGeneration: review.version.stageGeneration, taskId });
  await expect.poll(async () => { try { return (await readFile(join(scaffold.workspaceCwd, '.recovery-runs'), 'utf8')).trim(); } catch { return ''; } }).toBe('run');
  await command({ type: 'task.pause', taskId, reason: 'Hold the saved external result' });
  await writeFile(join(scaffold.workspaceCwd, '.recovery-ready'), 'ready');
  await expect.poll(async () => (await snapshot()).deterministic?.[taskId]?.phase).toBe('result-ready');
  const saved = (await snapshot()).deterministic[taskId];
  await reload();
  await expect.poll(async () => (await snapshot()).deterministic?.[taskId]?.phase).toBe('result-ready');
  expect((await snapshot()).deterministic[taskId].executionId).toBe(saved.executionId);
  expect((await readFile(join(scaffold.workspaceCwd, '.recovery-runs'), 'utf8')).trim()).toBe('run');
  await command({ type: 'task.resume', taskId });
  try { await expect.poll(async () => (await task()).columnId).toBe('done'); }
  catch (error) { throw new Error('Held result did not resume: ' + JSON.stringify({ task: await task(), execution: (await snapshot()).deterministic?.[taskId] }), { cause: error }); }
  expect((await task()).sessionIds).toEqual([]);
  expect((await readFile(join(scaffold.workspaceCwd, '.recovery-runs'), 'utf8')).trim()).toBe('run');
});

it('fans approval out, approves before the first entry, accepts a team update, and reports a directory-dependent source', { timeout: 180000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'kanban-deterministic-approval-'));
  onTestFinished(async () => { await rm(fixture, { recursive: true, force: true }); });
  const overlay = join(fixture, 'native-test-policy.yaml');
  await writeFile(overlay, '- id: sandbox-policy\n  config:\n    mode: danger-full-access\n    workspaceRoot: !!js process.cwd()\n- id: permission\n  config:\n    defaultPreset: danger-full-access\n');
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: ROOT, enabled: true }] }, extraOverlayPath: overlay });
  onTestFinished(async () => { await scaffold.close(); });
  const controller = () => scaffold.ctx.get('kanbanController') as any;
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: any) => unwrap(await controller().command(value));
  const first = await snapshot(); const hubId = first.state.hubs[0].id; const boardId = first.state.hubs[0].boards[0].id;
  await command({ type: 'project.save', hubId, project: { name: 'Approval lane', projectPath: scaffold.workspaceCwd, projectKey: 'approval-lane' } });
  const projectId = (await snapshot()).state.hubs[0].projects[0].id;
  const waiting = (message: string) => 'sleep 10; printf \'%s\\n\' \'{"exit":"done","message":"' + message + '"}\'';
  const yaml = (waitMessage = 'wait ok') => [
    'name: Approval lane', 'initial_column: pre', 'columns:',
    '  - id: pre', '    label: Pre', '    deterministic:', '      language: bash', '      directory: task', '      code: ' + JSON.stringify(waiting('pre ok')), '      exits: {done: done}',
    '  - id: wait', '    label: Wait', '    deterministic:', '      language: bash', '      directory: task', '      code: ' + JSON.stringify(waiting(waitMessage)), '      exits: {done: done}',
    '  - id: relative', '    label: Relative', '    deterministic:', '      language: bash', '      directory: task', '      file: relative.sh', '      exits: {done: done}',
    '  - id: done', '    label: Done', '',
  ].join('\n');
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: yaml() });
  await writeFile(join(scaffold.workspaceCwd, 'relative.sh'), 'printf \'%s\\n\' \'{"exit":"done","message":"relative"}\'');
  const byTitle = async (title: string) => (await snapshot()).state.hubs[0].tasks.find((value: any) => value.title === title);
  const phase = async (title: string) => { const value = await byTitle(title); return value === undefined ? undefined : (await snapshot()).deterministic?.[value.id]?.phase; };
  const create = async (title: string) => { await command({ type: 'task.create', hubId, boardId, projectId, title, description: '', autoMode: false }); return byTitle(title); };

  // Approve the authored initial version from the stage editor before any card exists.
  const browser = await chromium.launch();
  onTestFinished(async () => { await browser.close(); });
  const page = await newEnglishPage(browser);
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stage Pre' }).click();
  const stageEditor = page.getByRole('dialog', { name: 'Edit stage' });
  await stageEditor.getByRole('button', { name: 'Review and approve script' }).click();
  const authoredReview = page.getByRole('dialog', { name: 'Review deterministic script' });
  await authoredReview.getByRole('button', { name: 'Approve this version' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toHaveCount(0);
  const authored = unwrap(await controller().deterministicReview({ boardId, stageId: 'pre' }));
  expect(authored.version.captured).toBe(false);
  expect(authored.approval).toBe('approved');
  await page.close();
  const preapproved = await create('Preapproved');
  await expect.poll(() => phase('Preapproved')).toBe('active');
  const preSummary = (await snapshot()).deterministic[preapproved.id];
  await command({ type: 'task.deterministicStop', taskId: preapproved.id, executionId: preSummary.executionId });
  await expect.poll(() => phase('Preapproved')).toBe('stopped');

  // Cards in different projects waiting for one version start from one approval.
  const a = await create('Fan A'); const b = await create('Fan B');
  const secondProjectPath = join(scaffold.workspaceCwd, 'second-project'); await mkdir(secondProjectPath);
  await command({ type: 'project.save', hubId, project: { name: 'Second card project', projectPath: secondProjectPath, projectKey: 'second-card' } });
  const secondProjectId = (await snapshot()).state.hubs[0].projects.find((value: any) => value.projectKey === 'second-card').id;
  await command({ type: 'task.create', hubId, boardId, projectId: secondProjectId, title: 'Fan C', description: '', autoMode: false });
  const c = await byTitle('Fan C');
  await command({ type: 'task.move', hubId, taskId: a.id, columnId: 'wait', overrideTransition: true });
  await command({ type: 'task.move', hubId, taskId: b.id, columnId: 'wait', overrideTransition: true });
  await command({ type: 'task.move', hubId, taskId: c.id, columnId: 'wait', overrideTransition: true });
  await expect.poll(async () => [await phase('Fan A'), await phase('Fan B'), await phase('Fan C')]).toEqual(['awaiting-trust', 'awaiting-trust', 'awaiting-trust']);
  const fan = unwrap(await controller().deterministicReview({ boardId, stageId: 'wait', taskId: a.id }));
  expect(fan.version.captured).toBe(true);
  expect(fan.waitingCards).toBe(3);
  await command({ type: 'board.deterministicApprove', boardId, stageId: 'wait', fingerprint: fan.version.fingerprint, stageGeneration: fan.version.stageGeneration, taskId: a.id });
  await expect.poll(async () => [await phase('Fan A'), await phase('Fan B'), await phase('Fan C')]).toEqual(['active', 'active', 'active']);
  for (const title of ['Fan A', 'Fan B', 'Fan C']) {
    const value = await byTitle(title); const summary = (await snapshot()).deterministic[value.id];
    await command({ type: 'task.deterministicStop', taskId: value.id, executionId: summary.executionId });
  }

  // A team-folder update creates a new version; the next card must wait for approval.
  const teamDir = join(fixture, 'team'); await mkdir(teamDir);
  await unwrap(await controller().sharing({ type: 'sharing.connect', hubId, provider: 'local-folder', settings: { path: teamDir } }));
  const boardLog = async () => {
    try { const entries = await readdir(teamDir, { recursive: true }); const file = entries.find(entry => entry.endsWith('.jsonl')); return file === undefined ? undefined : join(teamDir, file); }
    catch { return undefined; }
  };
  await expect.poll(boardLog).toBeTruthy();
  const logPath = await boardLog();
  if (logPath === undefined) throw new Error('The team folder has no board log.');
  const logText = await readFile(logPath, 'utf8');
  const lastEvent = JSON.parse(logText.trimEnd().split(String.fromCharCode(10)).pop()!) as { seq: number };
  await writeFile(logPath, logText.trimEnd() + String.fromCharCode(10)
    + JSON.stringify({ kind: 'workflow.replaced', text: yaml('team wait'), seq: lastEvent.seq + 1, at: new Date().toISOString(), v: 3 }) + String.fromCharCode(10));
  await unwrap(await controller().sharing({ type: 'sharing.getUpdates', hubId }));
  await expect.poll(async () => (await snapshot()).state.hubs[0].boards[0].workflowYaml.includes('team wait')).toBe(true);
  const updated = await create('Updated');
  await command({ type: 'task.move', hubId, taskId: updated.id, columnId: 'wait', overrideTransition: true });
  await expect.poll(() => phase('Updated')).toBe('awaiting-trust');
  const updatedReview = unwrap(await controller().deterministicReview({ boardId, stageId: 'wait', taskId: updated.id }));
  expect(updatedReview.approval).toBe('required');
  expect(updatedReview.version.fingerprint).not.toBe(fan.version.fingerprint);
  await command({ type: 'board.deterministicApprove', boardId, stageId: 'wait', fingerprint: updatedReview.version.fingerprint, stageGeneration: updatedReview.version.stageGeneration, taskId: updated.id });
  await expect.poll(() => phase('Updated')).toBe('active');
  const updatedSummary = (await snapshot()).deterministic[updated.id];
  await command({ type: 'task.deterministicStop', taskId: updated.id, executionId: updatedSummary.executionId });

  // A relative primary file is reported as directory-dependent before approval.
  const relative = unwrap(await controller().deterministicReview({ boardId, stageId: 'relative' }));
  expect(relative.version.directoryDependent).toBe(true);
  expect(relative.source).toMatchObject({ kind: 'file', reference: 'relative.sh' });
  expect(relative.approval).toBe('required');

  await mkdir(join(ROOT, '.verification'), { recursive: true });
  await writeFile(join(ROOT, '.verification/deterministic-approval-e2e-report.json'), JSON.stringify({
    status: 'passed', authoredApprovalBeforeFirstEntry: true, twoCardApprovalFanout: true, crossProjectApprovalFanout: true, teamUpdateNeedsNewApproval: true, directoryDependentSourceReported: true,
  }, null, 2) + '\n');
});

it('holds a real saved result for a running background job and delivers it after the job is cancelled from the drawer', { timeout: 180000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'kanban-deterministic-hold-'));
  onTestFinished(async () => { await rm(fixture, { recursive: true, force: true }); });
  const overlay = join(fixture, 'native-test-policy.yaml');
  await writeFile(overlay, '- id: sandbox-policy\n  config:\n    mode: danger-full-access\n    workspaceRoot: !!js process.cwd()\n- id: permission\n  config:\n    defaultPreset: danger-full-access\n');
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: ROOT, enabled: true }] }, extraOverlayPath: overlay });
  onTestFinished(async () => { await scaffold.close(); });
  const controller = () => scaffold.ctx.get('kanbanController') as any;
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: any) => unwrap(await controller().command(value));
  const state = await snapshot(); const hubId = state.state.hubs[0].id; const boardId = state.state.hubs[0].boards[0].id;
  await command({ type: 'project.save', hubId, project: { name: 'Held delivery', projectPath: scaffold.workspaceCwd, projectKey: 'held-delivery' } });
  const projectId = (await snapshot()).state.hubs[0].projects[0].id;
  const code = 'printf "run\\n" >> .held-runs; while [ ! -f .held-ready ]; do sleep 0.05; done; printf \'%s\\n\' \'{"exit":"done","message":"Held result"}\'';
  const yaml = 'name: Held delivery\ninitial_column: wait\ncolumns:\n  - id: wait\n    label: Waiting\n    deterministic:\n      language: bash\n      code: ' + JSON.stringify(code) + '\n      exits: {done: done}\n  - {id: done, label: Done}\n';
  await command({ type: 'board.workflow.save', hubId, boardId, yaml });
  await command({ type: 'task.create', hubId, boardId, projectId, title: 'Held result check', description: '', autoMode: false });
  const task = async () => (await snapshot()).state.hubs[0].tasks.find((value: any) => value.title === 'Held result check');
  const summary = async () => { const value = await task(); return (await snapshot()).deterministic?.[value.id]; };
  const taskId = (await task()).id;
  await expect.poll(async () => (await summary())?.phase).toBe('awaiting-trust');
  const review = unwrap(await controller().deterministicReview({ taskId }));
  await command({ type: 'task.deterministicApprove', taskId, executionId: (await summary()).executionId, fingerprint: review.version.fingerprint });
  await expect.poll(async () => { try { return (await readFile(join(scaffold.workspaceCwd, '.held-runs'), 'utf8')).trim(); } catch { return ''; } }).toBe('run');
  const created = await command({ type: 'conversation.create', taskId });
  const sessionId = String(created.commandReceipt.id);
  const jobs = scaffold.ctx.get('jobs') as any;
  expect(jobs, 'The isolated composition must expose the public job registry.').toBeDefined();
  let settle!: (outcome: { status: 'killed'; detail?: string }) => void;
  const done = new Promise<{ status: 'killed'; detail?: string }>(resolve => { settle = resolve; });
  const jobId = jobs.start({ kind: 'bash', label: 'find the home directory hold fixture', owner: SessionId(sessionId), run: () => ({ cancel: () => settle({ status: 'killed', detail: 'cancelled by the Kanban hold test' }), done }) });
  await writeFile(join(scaffold.workspaceCwd, '.held-ready'), 'ready');
  await expect.poll(async () => (await summary())?.hold?.code).toBe('background-work');
  const held = await summary();
  expect(held.phase).toBe('result-ready');
  expect(held.hold.background).toEqual([expect.objectContaining({ kind: 'job', id: jobId, label: 'find the home directory hold fixture' })]);
  expect((await task()).columnId).toBe('wait');
  expect((await readFile(join(scaffold.workspaceCwd, '.held-runs'), 'utf8')).trim()).toBe('run');
  const browser = await chromium.launch();
  try {
    const page = await newEnglishPage(browser);
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Kanban', exact: true }).click();
    await page.getByRole('button', { name: 'Open task Held result check' }).click();
    const notice = page.locator('.kb-drawer .kb-hold');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Waiting for background work to finish.');
    await expect(notice).toContainText('find the home directory hold fixture');
    await mkdir(join(ROOT, '.verification'), { recursive: true });
    await page.screenshot({ path: join(ROOT, '.verification/deterministic-hold-e2e.png') });
  } finally { await browser.close(); }
  await command({ type: 'task.deterministicCancelJob', taskId, jobId });
  expect(jobs.get(jobId, SessionId(sessionId)).status).toBe('killed');
  await expect.poll(async () => (await task()).columnId).toBe('done');
  expect((await summary())).toBeUndefined();
  expect((await readFile(join(scaffold.workspaceCwd, '.held-runs'), 'utf8')).trim()).toBe('run');
});

it('draws the deterministic routing without an exit label and opens its stage editor only while unlocked', { timeout: 120000 }, async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: ROOT, enabled: true }] } });
  const browserPromise = chromium.launch();
  onTestFinished(async () => { try { await (await browserPromise).close(); } finally { await scaffold.close(); } });
  const browser = await browserPromise;
  const page = await newEnglishPage(browser);
  const controller = () => scaffold.ctx.get('kanbanController') as any;
  const snapshot = async () => unwrap(await controller().snapshot({}));
  const command = async (value: any) => unwrap(await controller().command(value));
  const state = await snapshot();
  const hubId = state.state.hubs[0].id;
  const boardId = state.state.hubs[0].boards[0].id;
  await command({ type: 'project.save', hubId, project: { name: 'Deterministic arrows', projectPath: scaffold.workspaceCwd, projectKey: 'det-arrows' } });
  const workflow = [
    'name: Deterministic arrows',
    'initial_column: start',
    'columns:',
    '  - id: start',
    '    label: Start',
    '    deterministic:',
    '      language: typescript',
    '      code: "return { exit: \'done\', message: \'ok\' };"',
    '      exits: { done: finish }',
    '  - id: finish',
    '    label: Finish',
    '',
  ].join('\n');
  await command({ type: 'board.workflow.save', hubId, boardId, yaml: workflow });
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.kb-flow-canvas')?.getAttribute('data-ready') === 'true');
  await page.waitForTimeout(300);
  const group = page.locator('.kb-flow-edge-group[data-connection-id^="start->finish"]');
  await expect(group).toHaveCount(1);
  // The names live in the stage editor: no label, no condition mark, no control.
  await expect(group.locator('.kb-flow-exit-label')).toHaveCount(0);
  await expect(group.locator('button')).toHaveCount(0);
  await expect(group.locator('.kb-flow-condition-mark')).toHaveCount(0);
  // The unobscured diagram: one arrow, no label, no mark.
  await mkdir(join(ROOT, '.verification'), { recursive: true });
  await page.screenshot({ path: join(ROOT, '.verification', 'e2e-deterministic-arrow.png') });
  // A locked diagram stores nothing and opens nothing.
  await group.dispatchEvent('dblclick');
  await page.waitForTimeout(250);
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Unlock layout editing', exact: true }).click();
  await group.dispatchEvent('dblclick');
  await expect(page.getByRole('dialog', { name: 'Edit stage' })).toBeVisible();
  expect(await page.getByLabel('Execution mode').inputValue()).toBe('deterministic');
});
