// Real native profile composition; local scripts and replay-only downstream turn.
// The runner stages this template outside the read-only DSH checkout.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import { launchWebScaffold } from './scaffold.ts';

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
    const review = unwrap(await controller().deterministicReview({ taskId: value.id }));
    await command({ type: 'task.deterministicApprove', taskId: value.id, executionId: review.executionId, fingerprint: review.fingerprint });
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
  await expect.poll(async () => (await observe('.fake-ci-observations')).filter(value => value === 'pending').length).toBeGreaterThanOrEqual(2);
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
  await expect.poll(async () => (await observe('.fake-review-observations')).filter(value => value === 'pending').length).toBeGreaterThanOrEqual(2);
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
  const review = unwrap(await controller().deterministicReview({ taskId })); expect(review.code).toBe(original);
  await command({ type: 'task.deterministicApprove', taskId, executionId: review.executionId, fingerprint: review.fingerprint });
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
