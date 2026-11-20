import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { createPlanFilePort } from '../../src/host/plan-files.js';
import { PLAN_TOOLS, presetGate, productToolDefinitions, PROJECT_PLANNER_PRESET, WORKFLOW_ARCHITECT_PRESET } from '../../src/host/tools.js';
import { fixture, taskWithConversation } from './helpers.js';

/** A newline built at runtime, so this file carries no escape a shell could rewrite. */
const NL = String.fromCharCode(10);

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

/** A private temporary workspace the adapter writes into for real. */
async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-plan-')));
  roots.push(root);
  return root;
}

/** One recorded mutation, kept so a test can read the policy it ran under. */
interface Recorded { readonly targetKey: string; readonly policy?: Record<string, unknown> }

/**
 * A filesystem stub that performs the real mutation and records the policy it
 * received, so the confinement assertions can observe what the adapter decided.
 */
function fileSystem() {
  const writes: Recorded[] = [];
  return {
    writes,
    sandboxMode: 'read-only' as string | undefined,
    /** No-follow metadata: a link must be reported as a link, never followed. */
    lstat: async (value: string) => {
      try {
        const info = await lstat(value);
        const type = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
        return { version: 'v1', type };
      } catch { return undefined; }
    },
    resolve: async (value: string) => ({ targetKey: value, displayPath: value }),
    stat: async (target: { targetKey: string }) => {
      try {
        const info = await stat(target.targetKey);
        return { version: 'v1', type: info.isDirectory() ? 'directory' : 'file' };
      } catch { return undefined; }
    },
    readText: async (target: { targetKey: string }) => readFile(target.targetKey, 'utf8'),
    writeText: async (target: { targetKey: string }, content: string, _expected?: unknown, _signal?: unknown, policy?: Record<string, unknown>) => {
      writes.push({ targetKey: target.targetKey, ...(policy === undefined ? {} : { policy }) });
      const exists = await stat(target.targetKey).then(() => true, () => false);
      await mkdir(path.dirname(target.targetKey), { recursive: true });
      await writeFile(target.targetKey, content, 'utf8');
      return { operation: exists ? 'update' : 'create', version: 'v2', before: null, after: content };
    },
  };
}

/** The host services the adapter reads, in the shape it resolves them. */
function host(directory: string, options: { fs?: boolean; policy?: boolean; workspace?: boolean; confining?: boolean } = {}) {
  const filesystem = fileSystem();
  if (options.confining === false) filesystem.sandboxMode = undefined;
  const context: Record<string, unknown> = {
    ...(options.fs === false ? {} : { fs: filesystem }),
    ...(options.policy === false ? {} : { sandboxPolicy: { resolve: () => { throw new Error('the session policy must not be read'); } } }),
    ...(options.workspace === false ? {} : { workingDirectory: { ensure: async () => directory } }),
  };
  return { context: context as never, filesystem };
}

/** One plan request, carrying the session and the origin the adapter anchors on. */
/** A write request: the shape the port requires, with the origin supplied by the test. */
function planWrite(directory: string, request: { relativePath: string; content: string }) {
  return { ...request, agent: { id: 's' }, session: { id: 's' }, origin: () => directory };
}

/** A patch request: same, but the edits are required so the port type is satisfied. */
function planPatch(directory: string, request: { relativePath: string; edits: readonly { old: string; new: string }[] }) {
  return { ...request, agent: { id: 's' }, session: { id: 's' }, origin: () => directory };
}

const exec = (sessionId = 'ordinary-session') => ({
  signal: new AbortController().signal,
  agent: { id: sessionId },
  deferContext: vi.fn(),
  concludeTurn: vi.fn(),
} as unknown as ToolRunContext);

function named(definitions: ToolDefinition[], name: string): ToolDefinition {
  const definition = definitions.find(value => value.name === name);
  if (!definition) throw new Error('Missing tool ' + name);
  return definition;
}

describe('the plan-file port confinement', () => {
  it('writes a file under the plan segment with a policy rooted at that segment', async () => {
    const directory = await workspace();
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    const outcome = await port.write(planWrite(directory, { relativePath: 'plans/fix-login/plan.md', content: '# Plan' + NL }));
    expect(outcome.operation).toBe('create');
    expect(await readFile(path.join(directory, 'plans/fix-login/plan.md'), 'utf8')).toBe('# Plan' + NL);
    // The root is the segment directory: the narrowest directory holding the file.
    expect(filesystem.writes[0]!.policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: path.join(directory, 'plans/fix-login') });
  });

  it('replaces an existing plan on a second write', async () => {
    const directory = await workspace();
    const port = createPlanFilePort(host(directory).context);
    await port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'first' }));
    const outcome = await port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'second' }));
    expect(outcome.operation).toBe('update');
    expect(await readFile(path.join(directory, 'plans/p/plan.md'), 'utf8')).toBe('second');
  });

  it('refuses a traversal target and creates nothing', async () => {
    const directory = await workspace();
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/../escape.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    await expect(port.write(planWrite(directory, { relativePath: 'src/index.ts', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    expect(filesystem.writes).toEqual([]);
    await expect(stat(path.join(directory, 'escape.md'))).rejects.toThrow();
    await expect(stat(path.join(directory, 'plans'))).rejects.toThrow();
  });

  it('refuses a symlinked plan directory that leaves the workspace', async () => {
    const directory = await workspace();
    const outside = await workspace();
    await symlink(outside, path.join(directory, 'plans'));
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    expect(filesystem.writes).toEqual([]);
  });

  it('refuses a symlinked segment that leaves the plan directory', async () => {
    const directory = await workspace();
    const outside = await workspace();
    await mkdir(path.join(directory, 'plans'), { recursive: true });
    await symlink(outside, path.join(directory, 'plans/escape'));
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/escape/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    expect(filesystem.writes).toEqual([]);
    await expect(stat(path.join(outside, 'plan.md'))).rejects.toThrow();
  });

  it('refuses a symlinked leaf that redirects the write outside the segment', async () => {
    const directory = await workspace();
    const outside = await workspace();
    await mkdir(path.join(directory, 'plans/p'), { recursive: true });
    const victim = path.join(outside, 'victim.md');
    await writeFile(victim, 'original', 'utf8');
    await symlink(victim, path.join(directory, 'plans/p/plan.md'));
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    expect(filesystem.writes).toEqual([]);
    expect(await readFile(victim, 'utf8')).toBe('original');
  });

  it('refuses to write when the mounted backend does not confine', async () => {
    const directory = await workspace();
    const context = host(directory, { confining: false }).context;
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_FILES_UNAVAILABLE' });
    await expect(stat(path.join(directory, 'plans/p/plan.md'))).rejects.toThrow();
  });

  it('refuses the write when the session left its origin directory', async () => {
    const directory = await workspace();
    const elsewhere = await workspace();
    const { context } = host(elsewhere);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_WORKSPACE_CHANGED' });
    await expect(stat(path.join(directory, 'plans'))).rejects.toThrow();
  });

  it('reports an absent host capability instead of writing directly', async () => {
    const directory = await workspace();
    const withoutFs = createPlanFilePort(host(directory, { fs: false }).context);
    await expect(withoutFs.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_FILES_UNAVAILABLE' });
    const withoutPolicy = createPlanFilePort(host(directory, { policy: false }).context);
    await expect(withoutPolicy.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_FILES_UNAVAILABLE' });
  });
});

/** The plan tools over one fixture, with the real port bound to a temporary workspace. */
async function planTools(directory: string) {
  const f = await fixture();
  fixtures.push(f);
  const port = createPlanFilePort(host(directory).context);
  const tools = productToolDefinitions(f.app, f.app.boards, undefined, {
    plans: port,
    sessionOrigin: () => directory,
    sessionParent: () => undefined,
  });
  return { ...f, tools };
}

describe('the dangling and directory-creation cases', () => {
  it('refuses a dangling leaf link instead of replacing it', async () => {
    const directory = await workspace();
    const outside = await workspace();
    await mkdir(path.join(directory, 'plans/p'), { recursive: true });
    // The link points at a target that does not exist yet.
    await symlink(path.join(outside, 'later.md'), path.join(directory, 'plans/p/plan.md'));
    const { context, filesystem } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.write(planWrite(directory, { relativePath: 'plans/p/plan.md', content: 'x' })))
      .rejects.toMatchObject({ code: 'PLAN_PATH_REFUSED' });
    expect(filesystem.writes).toEqual([]);
    expect(await lstat(path.join(directory, 'plans/p/plan.md')).then(i => i.isSymbolicLink())).toBe(true);
    await expect(stat(path.join(outside, 'later.md'))).rejects.toThrow();
  });

  it('creates no plans directory when a patch targets an absent plan', async () => {
    const directory = await workspace();
    const { context } = host(directory);
    const port = createPlanFilePort(context);
    await expect(port.patch(planPatch(directory, { relativePath: 'plans/ghost/plan.md', edits: [{ old: 'a', new: 'b' }] })))
      .rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    await expect(stat(path.join(directory, 'plans'))).rejects.toThrow();
    await expect(stat(path.join(directory, 'plans/ghost'))).rejects.toThrow();
  });
});

describe('concurrent first writes', () => {
  it('lets two cooperating first writes in the same workspace both succeed', async () => {
    const directory = await workspace();
    const { context } = host(directory);
    const port = createPlanFilePort(context);
    const [first, second] = await Promise.all([
      port.write(planWrite(directory, { relativePath: 'plans/p/one.md', content: 'one' })),
      port.write(planWrite(directory, { relativePath: 'plans/p/two.md', content: 'two' })),
    ]);
    expect(first.path.endsWith('one.md')).toBe(true);
    expect(second.path.endsWith('two.md')).toBe(true);
    expect(await readFile(path.join(directory, 'plans/p/one.md'), 'utf8')).toBe('one');
    expect(await readFile(path.join(directory, 'plans/p/two.md'), 'utf8')).toBe('two');
  });
});

describe('the plan tools', () => {
  it('derives the segment from the card title in a task conversation', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Fix login bug', description: '' });
    const value = await named(f.tools, 'write_plan').execute({ file: 'plan.md', content: '# Plan' + NL }, exec(task.sessionIds[0]!)) as Record<string, unknown>;
    expect(value).toMatchObject({ segment: 'fix-login-bug', file: 'plan.md', operation: 'create' });
    expect(await readFile(path.join(directory, 'plans/fix-login-bug/plan.md'), 'utf8')).toBe('# Plan' + NL);
  });

  it('uses the declared project name in an ordinary chat and normalizes it', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    const value = await named(f.tools, 'write_plan').execute({ project: 'Checkout REDESIGN', file: 'plan.md', content: 'body' }, exec()) as Record<string, unknown>;
    expect(value).toMatchObject({ segment: 'checkout-redesign' });
    expect(await readFile(path.join(directory, 'plans/checkout-redesign/plan.md'), 'utf8')).toBe('body');
  });

  it('lands the same project in the same directory across two writes', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await named(f.tools, 'write_plan').execute({ project: 'Fix login bug', file: 'plan.md', content: 'one' }, exec());
    await named(f.tools, 'write_plan').execute({ project: 'fix login  BUG', file: 'design.md', content: 'two' }, exec());
    expect(await readFile(path.join(directory, 'plans/fix-login-bug/plan.md'), 'utf8')).toBe('one');
    expect(await readFile(path.join(directory, 'plans/fix-login-bug/design.md'), 'utf8')).toBe('two');
  });

  it('refuses a call that names no project and belongs to no card', async () => {
    const f = await planTools(await workspace());
    await expect(named(f.tools, 'write_plan').execute({ file: 'plan.md', content: 'x' }, exec()))
      .rejects.toMatchObject({ code: 'PLAN_SEGMENT_REQUIRED' });
  });

  it('refuses a file name that is a path or is not Markdown', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    const write = named(f.tools, 'write_plan');
    await expect(write.execute({ project: 'p', file: '../escape.md', content: 'x' }, exec())).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
    await expect(write.execute({ project: 'p', file: 'plan.txt', content: 'x' }, exec())).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
    await expect(stat(path.join(directory, 'plans'))).rejects.toThrow();
  });

  it('patches an existing plan and reports the file', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await named(f.tools, 'write_plan').execute({ project: 'p', file: 'plan.md', content: ['# Plan', '', 'Step one.', ''].join(NL) }, exec());
    const value = await named(f.tools, 'patch_plan').execute({ project: 'p', file: 'plan.md', edits: [{ old: 'Step one.', new: 'Step two.' }] }, exec()) as Record<string, unknown>;
    expect(value).toMatchObject({ segment: 'p', file: 'plan.md', edits: 1 });
    expect(await readFile(path.join(directory, 'plans/p/plan.md'), 'utf8')).toBe(['# Plan', '', 'Step two.', ''].join(NL));
  });

  it('applies several replacements in one call', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await named(f.tools, 'write_plan').execute({ project: 'p', file: 'plan.md', content: 'alpha beta gamma' }, exec());
    await named(f.tools, 'patch_plan').execute({ project: 'p', file: 'plan.md', edits: [{ old: 'alpha', new: 'one' }, { old: 'gamma', new: 'three' }] }, exec());
    expect(await readFile(path.join(directory, 'plans/p/plan.md'), 'utf8')).toBe('one beta three');
  });

  it('refuses a patch of an absent file and creates no directory', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await expect(named(f.tools, 'patch_plan').execute({ project: 'ghost', file: 'plan.md', edits: [{ old: 'a', new: 'b' }] }, exec()))
      .rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    await expect(stat(path.join(directory, 'plans/p/plan.md'))).rejects.toThrow();
  });

  it('leaves the file unchanged when a replacement of the batch does not match', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await named(f.tools, 'write_plan').execute({ project: 'p', file: 'plan.md', content: 'keep this' }, exec());
    await expect(named(f.tools, 'patch_plan').execute({ project: 'p', file: 'plan.md', edits: [{ old: 'keep this', new: 'changed' }, { old: 'absent', new: 'x' }] }, exec()))
      .rejects.toMatchObject({ code: 'PLAN_PATCH_MISS' });
    expect(await readFile(path.join(directory, 'plans/p/plan.md'), 'utf8')).toBe('keep this');
  });

  it('refuses an ambiguous replacement', async () => {
    const directory = await workspace();
    const f = await planTools(directory);
    await named(f.tools, 'write_plan').execute({ project: 'p', file: 'plan.md', content: 'step step' }, exec());
    await expect(named(f.tools, 'patch_plan').execute({ project: 'p', file: 'plan.md', edits: [{ old: 'step', new: 'x' }] }, exec()))
      .rejects.toMatchObject({ code: 'PLAN_PATCH_AMBIGUOUS' });
    expect(await readFile(path.join(directory, 'plans/p/plan.md'), 'utf8')).toBe('step step');
  });

  it('refuses an empty replacement collection', async () => {
    const f = await planTools(await workspace());
    await expect(named(f.tools, 'patch_plan').execute({ project: 'p', file: 'plan.md', edits: [] }, exec()))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('carries no escalation argument in either schema', async () => {
    const f = await planTools(await workspace());
    for (const name of PLAN_TOOLS) {
      const schema = JSON.stringify(named(f.tools, name).parameters);
      expect(schema, name).not.toContain('sandbox_permissions');
      expect(schema, name).not.toContain('justification');
    }
  });
});

describe('a delegated child resolves the task that owns it', () => {
  it('uses the card segment for a child rather than a declared name', async () => {
    const directory = await workspace();
    const f = await fixture();
    fixtures.push(f);
    const task = await taskWithConversation(f.app, { projectId: f.project.id, title: 'Fix login bug', description: '' });
    const parentId = task.sessionIds[0]!;
    const childId = 'child-session';
    f.sessions.seedSubagent(parentId, childId, directory);
    const port = createPlanFilePort(host(directory).context);
    const tools = productToolDefinitions(f.app, f.app.boards, undefined, {
      plans: port,
      sessionOrigin: () => directory,
      sessionParent: session => (session as { id: string }).id === childId ? parentId : undefined,
    });
    const value = await named(tools, 'write_plan')
      .execute({ project: 'a sibling segment', file: 'plan.md', content: 'x' }, { ...exec(childId), agent: { id: childId, session: { id: childId } } } as unknown as ToolRunContext) as Record<string, unknown>;
    expect(value.segment).toBe('fix-login-bug');
    expect(await readFile(path.join(directory, 'plans/fix-login-bug/plan.md'), 'utf8')).toBe('x');
    await expect(stat(path.join(directory, 'plans/a-sibling-segment'))).rejects.toThrow();
  });
});

describe('an unverified delegated lineage fails closed', () => {
  it('refuses a child whose owning card cannot be resolved', async () => {
    const directory = await workspace();
    const f = await fixture();
    fixtures.push(f);
    const port = createPlanFilePort(host(directory).context);
    const tools = productToolDefinitions(f.app, f.app.boards, undefined, {
      plans: port,
      sessionOrigin: () => directory,
      // The header names a parent, but no task owns that identifier.
      sessionParent: () => 'unknown-parent',
    });
    await expect(named(tools, 'write_plan')
      .execute({ project: 'a declared segment', file: 'plan.md', content: 'x' }, exec('child-session')))
      .rejects.toMatchObject({ code: 'PLAN_OWNER_UNVERIFIED' });
    await expect(stat(path.join(directory, 'plans'))).rejects.toThrow();
  });
});

describe('the plan tool preset gate', () => {
  it('declares both plan tools only for the planner preset', () => {
    const context = {
      get: (name: string) => name === 'agentPresets' ? { presetForSession: (session: { preset: string }) => session.preset } : undefined,
    } as unknown as never;
    const gate = presetGate(context, PROJECT_PLANNER_PRESET);
    const activation = (preset: string | null) => ({ agent: { session: { preset } }, modelSelection: {}, signal: new AbortController().signal }) as never;
    expect(gate(activation(PROJECT_PLANNER_PRESET))).toBe(true);
    for (const other of [WORKFLOW_ARCHITECT_PRESET, 'kanban-project-manager', 'kanban-workflow-operator', 'standard', null]) {
      expect(gate(activation(other)), String(other)).toBe(false);
    }
  });

  it('withholds the plan tools when the preset projection is unavailable', () => {
    const missing = presetGate({ get: () => undefined } as unknown as never, PROJECT_PLANNER_PRESET);
    const activation = { agent: { session: { preset: PROJECT_PLANNER_PRESET } }, modelSelection: {}, signal: new AbortController().signal } as never;
    expect(missing(activation)).toBe(false);
    const failing = presetGate({ get: () => ({ presetForSession: () => { throw new Error('unavailable'); } }) } as unknown as never, PROJECT_PLANNER_PRESET);
    expect(failing(activation)).toBe(false);
  });

  it('withholds the tools when reading the preset projection itself throws', () => {
    const throwing = presetGate({ get: () => { throw new Error('service unavailable'); } } as unknown as never, PROJECT_PLANNER_PRESET);
    const activation = { agent: { session: { preset: PROJECT_PLANNER_PRESET } }, modelSelection: {}, signal: new AbortController().signal } as never;
    expect(throwing(activation)).toBe(false);
  });
});