// Plugin-owned real-composition scenario for the planner plan-file boundary.
// It proves the composition, the confinement, and the tool gate; no model call is made.
// The runner copies this file into the staged test tree and removes it afterwards.
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { launchWebScaffold, type WebScaffold } from './scaffold.ts';
import type { Agent } from '@deepseek-ai/dsh-agent';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const PLANNER = 'kanban-project-planner';
/** A newline built at runtime, so the fixture text carries no shell-consumed escape. */
const NL = String.fromCharCode(10);

/** The tools one agent is actually offered on a step, after every activation gate. */
async function admitted(scaffold: WebScaffold, agent: Agent): Promise<string[]> {
  const set = await scaffold.ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'test', model: 'test' },
    signal: new AbortController().signal,
  });
  const names = [...set.view(agent).keys()];
  set.dispose();
  return names;
}

/**
 * Run one tool the way a model step does: the step resolves its admitted set
 * first, and the call carries that set, which is what lets a gated tool execute
 * or be reported as unknown.
 */
async function run(scaffold: WebScaffold, agent: Agent, name: string, args: Record<string, unknown>) {
  const toolSet = await scaffold.ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'test', model: 'test' },
    signal: new AbortController().signal,
  });
  try {
    const batch = await scaffold.ctx.tools.execute({
      agent,
      signal: new AbortController().signal,
      toolSet,
      calls: [{ type: 'tool-call', id: ('planner-' + name) as never, name, arguments: JSON.stringify(args) }],
    });
    expect(batch.results).toHaveLength(1);
    return batch.results[0]!.result;
  } finally { toolSet.dispose(); }
}

it('lets the planner write and patch a plan under confinement and denies every other write', { timeout: 120_000 }, async () => {
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] } });
  onTestFinished(async () => { await scaffold.close(); });
  expect(scaffold.mode).toBe('replay');
  const workspace = scaffold.workspaceCwd;

  // The role is offered by the roster.
  const roster = await scaffold.ctx.agentPresets.remoteExportList();
  expect(roster.presets.find(row => row.id === PLANNER)).toMatchObject({ name: 'Kanban Project Planner' });
  const created = await scaffold.ctx.sessionController.create({ cwd: workspace, agentPreset: PLANNER });
  const baseline = await scaffold.ctx.sessionController.create({ cwd: workspace });
  const planner = scaffold.ctx.agents.get(created.sessionId)!;
  const ordinary = scaffold.ctx.agents.get(baseline.sessionId)!;
  expect(planner).toBeDefined();
  expect(ordinary).toBeDefined();
  expect(scaffold.ctx.agentPresets.presetForSession(planner.session)).toBe(PLANNER);

  // The plan tools are declared for the planner and for nobody else.
  const plannerTools = await admitted(scaffold, planner);
  const ordinaryTools = await admitted(scaffold, ordinary);
  expect(plannerTools).toContain('write_plan');
  expect(plannerTools).toContain('patch_plan');
  expect(ordinaryTools).not.toContain('write_plan');
  expect(ordinaryTools).not.toContain('patch_plan');
  // The read-only boundary survives: no general write or edit tool is offered.
  expect(plannerTools).not.toContain('write');
  expect(plannerTools).not.toContain('edit');
  expect(plannerTools).toContain('read');

  // A plan write lands where the rule says it does.
  const written = await run(scaffold, planner, 'write_plan', { project: 'Fix login bug', file: 'plan.md', content: '# Plan' + NL + NL + 'Step one.' + NL });
  expect(written.isError).toBe(false);
  const planPath = path.join(workspace, 'plans/fix-login-bug/plan.md');
  expect(await readFile(planPath, 'utf8')).toBe('# Plan' + NL + NL + 'Step one.' + NL);

  // A patch corrects it in place.
  const patched = await run(scaffold, planner, 'patch_plan', { project: 'Fix login bug', file: 'plan.md', edits: [{ old: 'Step one.', new: 'Step two.' }] });
  expect(patched.isError).toBe(false);
  expect(await readFile(planPath, 'utf8')).toContain('Step two.');

  // A path outside the plan directory is refused and writes nothing.
  const refused = await run(scaffold, planner, 'write_plan', { project: '../..', file: 'plan.md', content: 'x' });
  expect(refused.isError).toBe(true);
  await expect(stat(path.join(workspace, 'plan.md'))).rejects.toThrow();

  // A session that leaves its origin cannot write elsewhere: the working-directory
  // tool is available to a planner, so the authority must not follow it.
  const elsewhere = path.join(workspace, 'elsewhere');
  await mkdir(elsewhere, { recursive: true });
  const moved = await run(scaffold, planner, 'working_directory', { cd: elsewhere });
  expect(moved.isError).toBe(false);
  const strayWrite = await run(scaffold, planner, 'write_plan', { project: 'Fix login bug', file: 'plan.md', content: 'x' });
  expect(strayWrite.isError).toBe(true);
  expect(JSON.stringify(strayWrite)).toContain('left the directory it was created in');
  await expect(stat(path.join(elsewhere, 'plans'))).rejects.toThrow();
  // Return to the origin so the confinement checks below run where the plan lives.
  await run(scaffold, planner, 'working_directory', { cd: workspace });

  // The shell cannot write, which is the boundary the plan tools exist to avoid widening.
  const shell = await run(scaffold, planner, process.platform === 'win32' ? 'pwsh' : 'bash', { command: 'printf blocked > shell-write.txt', description: 'attempt a shell write' });
  // The sandbox denies the write and reports it; the shell surfaces the denial in
  // its own output rather than as a tool failure, so the denial text is the evidence.
  expect(JSON.stringify(shell)).toContain('[sandbox: file access denied under read-only mode]');
  expect(scaffold.ctx.sandboxPolicy.resolve({ session: planner.session }).mode).toBe('read-only');
  await expect(stat(path.join(workspace, 'shell-write.txt'))).rejects.toThrow();
  await expect(stat(path.join(workspace, 'shell-write.txt'))).rejects.toThrow();

  // A non-planner agent cannot reach a plan tool even by name.
  const foreign = await run(scaffold, ordinary, 'write_plan', { project: 'p', file: 'plan.md', content: 'x' });
  expect(foreign.isError).toBe(true);
});