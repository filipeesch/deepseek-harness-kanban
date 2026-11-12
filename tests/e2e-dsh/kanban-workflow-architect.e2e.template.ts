// Plugin-owned real-composition contract check, copied into the DSH test tree.
// No replay fixture or model calls: this proves mounting and executable contracts,
// not whether a model follows the interview, approval, or language instructions.
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { launchWebScaffold, type WebScaffold } from './scaffold.ts';

const KANBAN_ROOT = process.env.KANBAN_ROOT!;
const PRESET = 'kanban-workflow-architect';
const SKILL = 'kanban-workflow-design';

/** Use the real native executor, including scope selection and tool validation.
 * No log is supplied because these calls are not part of a model response.
 */
async function runTool(scaffold: WebScaffold, agent: Agent, name: string, args: Record<string, unknown>) {
  const batch = await scaffold.ctx.tools.execute({
    agent,
    signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: ToolCallId('architect-' + name), name, arguments: JSON.stringify(args) }],
  });
  expect(batch.results).toHaveLength(1);
  const result = batch.results[0]!.result;
  expect(result.isError, JSON.stringify(result)).toBe(false);
  if (result.isError) throw new Error('native tool execution failed: ' + name);
  return result.value;
}

it('mounts the installed architect preset, scopes its persona and skill, and reuses product tools', { timeout: 120_000 }, async () => {
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: KANBAN_ROOT, enabled: true }] },
    developerTools: true,
  });
  onTestFinished(async () => { await scaffold.close(); });
  expect(scaffold.mode).toBe('replay');
  expect(await realpath(scaffold.harnessHome)).not.toBe(process.env.HOME + '/.dsh');

  // The bundle row alone is not proof: failed declarations remain in the roster.
  const resolved = await scaffold.ctx.agentPresets.resolve(PRESET);
  expect(resolved).toEqual({ id: PRESET });
  const roster = await scaffold.ctx.agentPresets.remoteExportList();
  expect(roster.presets.find(row => row.id === PRESET)).toMatchObject({
    name: 'Kanban Workflow Architect', isDefault: false,
  });
  expect(roster.presets.find(row => row.isDefault)?.id).toBe('standard');

  // Select each composition through the ordinary new-session API, not a mock scope.
  const created = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd, agentPreset: PRESET });
  const baseline = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd, agentPreset: 'standard' });
  expect(created.agentPreset).toBe(PRESET);
  expect(baseline.agentPreset).toBe('standard');
  expect(created.sessionId).not.toBe(baseline.sessionId);
  const architect = scaffold.ctx.agents.get(created.sessionId)!;
  const standard = scaffold.ctx.agents.get(baseline.sessionId)!;
  expect(architect).toBeDefined();
  expect(standard).toBeDefined();
  expect(scaffold.ctx.agentPresets.presetForSession(architect.session)).toBe(PRESET);
  expect(scaffold.ctx.agentPresets.presetForSession(standard.session)).toBe('standard');
  const inspection = scaffold.ctx.agentPresets.inspectCompositions(architect.ctx);
  expect(inspection).toHaveLength(1);
  expect(inspection[0]).toMatchObject({ id: PRESET, leakedServices: [] });
  const modules = inspection[0]!.modules.map(row => row.moduleName);
  expect(modules).toContain('@deepseek-ai/dsh-persona');
  expect(modules).toContain('@deepseek-ai/dsh-skill-filesystem');
  expect(modules).not.toContain('dsh-kanban');

  const architectTools = scaffold.ctx.tools.schemas(architect).map(tool => tool.name);
  const standardTools = scaffold.ctx.tools.schemas(standard).map(tool => tool.name);
  expect(new Set(architectTools).size).toBe(architectTools.length);
  expect(architectTools).toEqual(expect.arrayContaining([
    'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_kill',
    'schedule_create', 'create_goal', 'subagent', 'subagent_fork', 'workflow',
    'ask_user_question', 'todo_write', 'web_fetch', 'present', 'plugin_manager',
    'skill', 'cordis_inspect_list', 'cordis_inspect_query',
    'decision_request', 'list_hubs', 'list_boards', 'get_board_summary', 'create_board', 'edit_board_yaml',
  ]));
  expect(architectTools).toContain(process.platform === 'win32' ? 'pwsh' : 'bash');
  // Plan mode intentionally does not compete with the Architect's approval interview.
  expect(architectTools).not.toContain('exit_plan_mode');
  expect(standardTools).toContain('exit_plan_mode');
  expect(standardTools.filter(name => name !== 'exit_plan_mode').every(name => architectTools.includes(name))).toBe(true);
  for (const name of ['decision_request', 'create_board', 'edit_board_yaml', 'list_hubs']) {
    const global = scaffold.ctx.tools.get(name);
    expect(global).toBeDefined();
    expect(scaffold.ctx.tools.get(name, architect)).toBe(global);
    expect(scaffold.ctx.tools.get(name, standard)).toBe(global);
  }

  const architectPrompt = await scaffold.ctx.systemPrompt.assemble(assembleContextFor(architect));
  const standardPrompt = await scaffold.ctx.systemPrompt.assemble(assembleContextFor(standard));
  const persona = (assembly: typeof architectPrompt) => assembly.sections.find(row => row.name === 'deployment:persona-prefix')?.text ?? '';
  expect(persona(architectPrompt)).toContain('You are Kanban Workflow Architect.');
  expect(persona(architectPrompt)).toContain('decision_request');
  expect(persona(standardPrompt)).not.toContain('Kanban Workflow Architect');
  expect(architectPrompt.sections.length).toBeGreaterThan(1);

  // Resolve exactly as an installed profile does, with no source-tree path in YAML.
  const require = createRequire(join(scaffold.harnessHome, 'profiles/scaffold/package.json'));
  const installedRoot = dirname(require.resolve('dsh-kanban/package.json'));
  const skillDirectory = join(installedRoot, 'presets/skills', SKILL);
  const catalog = await scaffold.ctx.skills.list({ cwd: scaffold.workspaceCwd, scope: architect });
  const summary = catalog.find(skill => skill.name === SKILL);
  expect(summary).toBeDefined();
  expect(await realpath(summary!.path!)).toBe(await realpath(join(skillDirectory, 'SKILL.md')));
  expect(summary!.resourceBase).toEqual({ kind: 'directory', path: skillDirectory });
  // Catalog discovery is metadata-only; the native tool must separately load the body.
  expect(summary).not.toHaveProperty('content');
  const loaded = await runTool(scaffold, architect, 'skill', { name: SKILL }) as {
    name: string; content: string; resourceBase: { kind: string; path: string };
  };
  expect(loaded.name).toBe(SKILL);
  expect(loaded.content).toContain('# Kanban Workflow Design');
  expect(loaded.resourceBase).toEqual({ kind: 'directory', path: skillDirectory });
  expect(await readFile(join(loaded.resourceBase.path, 'references/workflow-yaml.md'), 'utf8')).not.toHaveLength(0);
  const baselineCatalog = await scaffold.ctx.skills.list({ cwd: scaffold.workspaceCwd, scope: standard });
  expect(baselineCatalog.some(skill => skill.name === SKILL)).toBe(false);

  // Exercise the actual shared interview tool's schema/output, without pretending
  // an out-of-turn call renders a question round or evaluates model behavior.
  const question = await runTool(scaffold, architect, 'decision_request', {
    question: 'Who approves the review stage?', type: 'exclusive',
    options: [
      { title: 'Human reviewer', description: 'Require a human approval before delivery.' },
      { title: 'Agent reviewer', description: 'Let the reviewing agent choose a supported route using evidence.' },
    ],
  });
  expect(question).toMatchObject({
    kind: 'kanban.question-page', version: 1,
    page: { question: 'Who approves the review stage?', type: 'exclusive' },
  });
  expect(await scaffold.ctx.agentPresets.resolve('standard')).toEqual({ id: 'standard' });
});
