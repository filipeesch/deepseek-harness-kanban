import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { PRODUCT_TOOL_NAMES } from '../../src/host/tools/names.js';
import { WORKFLOW_DESIGN_TOOLS } from '../../src/host/tools.js';
import { DESCRIPTION_CEILING } from '../../src/domain/workflow-warnings.js';
import { AGENT_TRANSITION_REASON_LIMIT } from '../../src/domain/transition-reason.js';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const skillRoot = path.join(root, 'presets/skills');
interface Expression { __jsExpr: string }
interface Entry {
  id: string;
  name: string;
  group?: boolean;
  disabled?: Expression;
  isolate?: Record<string, boolean>;
  config?: Record<string, unknown>;
}
interface Patch { insert: Entry[] }

interface PresetRow {
  readonly rowId: string;
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly skill: string;
}

const PRESETS: readonly PresetRow[] = [
  { rowId: 'preset-kanban-workflow-architect', id: 'kanban-workflow-architect', name: 'Kanban Workflow Architect', order: 20, skill: 'kanban-workflow-design' },
  { rowId: 'preset-kanban-project-planner', id: 'kanban-project-planner', name: 'Kanban Project Planner', order: 21, skill: 'kanban-project-planning' },
  { rowId: 'preset-kanban-project-manager', id: 'kanban-project-manager', name: 'Kanban Project Manager', order: 22, skill: 'kanban-project-orchestration' },
  { rowId: 'preset-kanban-workflow-operator', id: 'kanban-workflow-operator', name: 'Kanban Workflow Operator', order: 23, skill: 'kanban-workflow-operation' },
];

// Preserve Loader expressions rather than quietly treating !!js as plain text.
// The real-composition lane also exercises the actual Host Loader and schemas.
function readPatch(text: string): Patch[] {
  const document = parseDocument(text, { customTags: [{
    tag: 'tag:yaml.org,2002:js',
    resolve: (source: string) => ({ __jsExpr: source }),
  }] });
  expect(document.errors).toEqual([]);
  expect(document.warnings).toEqual([]);
  return document.toJS() as Patch[];
}

async function composition() {
  const patch = readPatch(await readFile(path.join(root, 'cordis.patch.yml'), 'utf8'));
  const rows = patch.flatMap(layer => layer.insert);
  const presets = PRESETS.map(definition => {
    const row = rows.find(candidate => candidate.id === definition.rowId);
    expect(row, definition.rowId).toBeDefined();
    return { definition, row: row!, plugins: (row!.config!.plugins ?? []) as Entry[] };
  });
  return { rows, presets };
}

function evaluate(expression: Expression, baseUrl: string, platform = process.platform) {
  const context = { get: () => undefined };
  // Only evaluates the repository-owned patch, not user-supplied input.
  return new Function('process', 'baseUrl', 'ctx', `return (${expression.__jsExpr});`)(
    { platform, getBuiltinModule: process.getBuiltinModule }, baseUrl, context,
  );
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(target) : entry.name.endsWith('.md') ? [target] : [];
  }));
  return files.flat();
}

const temporaryRoots: Array<{ directory: string; canonical: string }> = [];
afterEach(async () => {
  for (const { directory, canonical } of temporaryRoots.splice(0)) {
    // Verify the exact owned temporary target before recursive cleanup.
    expect(path.basename(directory)).toMatch(/^dsh-kanban-preset-/);
    expect(await realpath(directory)).toBe(canonical);
    await rm(directory, { recursive: true });
  }
});

function allowed(preset: { plugins: Entry[] }): string[] {
  const row = preset.plugins.find(plugin => plugin.id === 'preset-tools');
  expect(row, 'preset-tools').toBeDefined();
  return row!.config!.allow as string[];
}

function plugin(preset: { plugins: Entry[] }, id: string): Entry | undefined {
  return preset.plugins.find(entry => entry.id === id);
}

describe('shipped agent presets', () => {
  it('declares one independent preset per role without remounting the host', async () => {
    const { rows, presets } = await composition();
    expect(rows.filter(row => row.name === 'dsh-kanban')).toHaveLength(1);
    const declared = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset');
    expect(declared.map(row => row.id)).toEqual(PRESETS.map(definition => definition.rowId));
    for (const { definition, row, plugins } of presets) {
      expect(row.config).toMatchObject({ id: definition.id, name: definition.name, order: definition.order });
      expect(typeof row.config!.description).toBe('string');
      expect(new Set(plugins.map(entry => entry.id)).size).toBe(plugins.length);
      expect(plugins.some(entry => entry.name === 'dsh-kanban')).toBe(false);
      const persona = plugin({ plugins }, 'persona')!;
      const prefix = persona.config!.prefix as string;
      expect(prefix.length, definition.id).toBeLessThan(4000);
      expect(prefix).toContain(definition.skill);
      expect(persona.config!.complete).not.toBe(true);
      expect(plugin({ plugins }, 'kanban-skills')!.config).toMatchObject({ providerName: 'kanban-bundled', includeDefaultRoots: false });
      expect(plugin({ plugins }, 'tool-skill')).toBeDefined();
      // The two project roles declare a tool boundary; the architect keeps the gate it ships.
      expect(plugin({ plugins }, 'preset-tools') === undefined, definition.id).toBe(['kanban-workflow-architect', 'kanban-workflow-operator'].includes(definition.id));
      // A question to the person goes through decision_request in both project roles.
      expect(plugin({ plugins }, 'tool-ask-user') === undefined, definition.id).toBe(!['kanban-workflow-architect', 'kanban-workflow-operator'].includes(definition.id));
    }
  });

  it('preserves the complete pinned PTC plugin composition without remounting the host', async () => {
    // Fixture: dsh-v0.2.2-rc.1, commit 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db,
    // packages/bundle/web-app/presets/ptc.patch.yml. Update intentionally when the host pin changes.
    const pinned = readPatch(await readFile(path.join(root, 'tests/fixtures/pinned-ptc-preset.yml'), 'utf8'));
    const original = pinned[0]!.insert[0]!.config!.plugins as Entry[];
    const { presets } = await composition();
    const operator = presets[3]!;
    const entries = operator.plugins.filter(entry => entry.id !== 'kanban-skills');
    expect(entries.map(entry => entry.id)).toEqual(original.map(entry => entry.id));
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]!.id === 'persona') {
        expect(entries[i]!.name).toBe(original[i]!.name);
        continue;
      }
      expect(entries[i], entries[i]!.id).toEqual(original[i]);
    }
    expect(plugin(operator, 'tool-executor-ptc')?.name).toBe('@deepseek-ai/dsh-tool-executor-ptc');
    expect(plugin(operator, 'preset-tools')).toBeUndefined();
    expect(plugin(operator, 'planning')).toBeDefined();
  });

  it('asks for self-contained question pages in the operator guidance', async () => {
    const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain('Ask each question as a self-contained page');
    expect(patch).toContain('never announce, preview, or summarize the pages that follow');
    expect(patch).toContain('the form already shows the round');
    expect(patch).toContain('Never ask again what the conversation already settled');
  });

  it('keeps workflow operation and authoring guidance within their roles', async () => {
    const operator = await readFile(path.join(skillRoot, 'kanban-workflow-operation/SKILL.md'), 'utf8');
    for (const phrase of [
      'current stage', 'scripted stage', 'without a script or instruction', 'list_allowed_transitions', 'current stage instruction', 'user directly requests', 'automatic mode', 'explicit direct user request', 'not proof of user intent',
      'Stage orientation (facts from the active workflow):', 'Stage notice:', 'get_workflow_summary', 'set_next_transition', 'every stage is a valid place', 'forced jump', 'exception flag',
      'at most ' + AGENT_TRANSITION_REASON_LIMIT + ' characters',
    ]) {
      expect(operator).toContain(phrase);
    }
    const architect = await readFile(path.join(skillRoot, 'kanban-workflow-design/SKILL.md'), 'utf8');
    expect(architect).toContain('at most ' + DESCRIPTION_CEILING + ' characters');
    expect(architect).not.toContain('150 characters');
    expect(architect).toContain('not other authors');
    expect(architect).toContain('(references/stage-contracts.md)');
  });

  it('states the operator standing rule in its persona and keeps both operator texts generic', async () => {
    const { presets } = await composition();
    const persona = plugin(presets[3]!, 'persona')!.config!.prefix as string;
    expect(persona).toContain('kanban-workflow-operation');
    expect(persona).toContain('The current stage is your scope');
    expect(persona).toContain('Do not perform in the current stage work that another stage owns');
    expect(persona).toContain('When no stage owns the work, do it in the current stage');
    expect(persona).toContain("A stage's own instruction takes precedence");
    expect(persona).toContain('latest stage orientation or stage notice');
    expect(persona).toContain('get_workflow_summary');
    const skill = await readFile(path.join(skillRoot, 'kanban-workflow-operation/SKILL.md'), 'utf8');
    for (const text of [persona, skill]) expect(text).not.toMatch(/\b(deploy|merge|pull request|openspec|migration)s?\b/i);
  });

  it('ships the stage-contract reference the design skill links', async () => {
    const reference = await readFile(path.join(skillRoot, 'kanban-workflow-design/references/stage-contracts.md'), 'utf8');
    expect(reference.length).toBeLessThan(7000);
    for (const phrase of ['Description (at most ' + DESCRIPTION_CEILING + ' characters)', 'Transition ', 'Entry instruction', 'at most ' + AGENT_TRANSITION_REASON_LIMIT + ' characters', 'operator\'s standing rule', 'exactly one owning stage']) {
      expect(reference).toContain(phrase);
    }
    expect(reference).not.toMatch(/\b(deploy|merge|pull request|openspec|migration)s?\b/i);
  });

  it('teaches the architect to review a coupled change and to report configuration apart from execution', async () => {
    const { presets } = await composition();
    const persona = plugin(presets[0]!, 'persona')!.config!.prefix as string;
    for (const phrase of [
      'an interview answer is not approval to write',
      'review the exact candidate and its identifiable impacts',
      'what you inspected, what you validated, and what you exercised',
      'engine-enforced rules, card configuration, and agent instructions',
      'not proof that a stage runs',
    ]) expect(persona, phrase).toContain(phrase);

    const skill = await readFile(path.join(skillRoot, 'kanban-workflow-design/SKILL.md'), 'utf8');
    for (const phrase of [
      'preview_workflow_batch', 'apply_workflow_batch', '(references/batch-authoring.md)',
      'discovery, never approval to write', 'what you inspected, validated, or exercised',
      'A validation pass or a measurement never proves',
    ]) expect(skill, phrase).toContain(phrase);

    const reference = await readFile(path.join(skillRoot, 'kanban-workflow-design/references/batch-authoring.md'), 'utf8');
    expect(reference.length).toBeLessThan(7000);
    for (const phrase of [
      'route-stale', 'admitted-advance', 'Engine-enforced', 'Card configuration', 'Agent instructions',
      'A preview handle is not approval', 'verified: true', 'Publishing stays a separate manual action',
      'stale preview', 'Do not widen a preset',
    ]) expect(reference, phrase).toContain(phrase);

    // The batch tools stay behind the architect gate; a role mask never grows to hold them.
    for (const name of ['preview_workflow_batch', 'apply_workflow_batch']) {
      expect(WORKFLOW_DESIGN_TOOLS).toContain(name);
      for (const preset of [presets[1]!, presets[2]!]) expect(allowed(preset), name).not.toContain(name);
    }
  });

  it('keeps the architect able to inspect and validate a workflow', async () => {
    const { presets } = await composition();
    const architect = presets[0]!;
    const names = architect.plugins.map(entry => entry.name);
    for (const name of [
      'agent-instructions', 'time-context', 'tool-bash', 'tool-pwsh', 'tool-fs',
      'tool-fs-search', 'tool-jobs', 'tool-schedule', 'skill-filesystem', 'tool-skill',
      'tool-cordis', 'tool-goal', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-present',
    ]) expect(names).toContain('@deepseek-ai/dsh-' + name);
    const compaction = plugin(architect, 'compaction')!;
    expect(compaction.group).toBe(true);
    expect(compaction.isolate).toEqual({ compaction: true, toolResultPruner: true });
    const delegation = plugin(architect, 'delegation')!;
    expect(delegation.group).toBe(true);
    expect(delegation.isolate).toEqual({ workflowEngine: true });
    expect((delegation.config as unknown as Entry[]).map(entry => entry.name)).toContain('@deepseek-ai/dsh-tool-subagent');
  });

  it('gives the planner repository reads and shell but no way to write a file', async () => {
    const { presets } = await composition();
    const planner = presets[1]!;
    const names = planner.plugins.map(entry => entry.name);
    expect(names).toContain('@deepseek-ai/dsh-tool-bash');
    expect(names).toContain('@deepseek-ai/dsh-tool-fs');
    expect(names).toContain('@deepseek-ai/dsh-tool-fs-search');
    expect(names).toContain('@deepseek-ai/dsh-tool-web');
    expect(names).toContain('@deepseek-ai/dsh-tool-subagent');
    expect(plugin(planner, 'tool-subagent-fork')!.config).toMatchObject({ provider: 'fork', toolName: 'subagent_fork' });
    // The planner mounts no job tools, so a command must not become a job it cannot read.
    for (const id of ['tool-bash', 'tool-pwsh']) {
      expect(plugin(planner, id)!.config).toMatchObject({ enableRunInBackground: false, promoteOnTimeout: false });
    }
    const fileTools = plugin(planner, 'tool-fs')!;
    expect(fileTools.config).toMatchObject({ write: false, edit: false });
    const gate = plugin(planner, 'preset-tools')!;
    expect(gate.config).toMatchObject({ denyMcp: false });
  });

  it('gives the planner the plan tools as its only write capability', async () => {
    const { presets } = await composition();
    const planner = presets[1]!;
    const entries = allowed(planner);
    for (const name of ['write_plan', 'patch_plan']) expect(entries, name).toContain(name);
    // The plan tools are the only write path: no general file write is mounted.
    expect(plugin(planner, 'tool-fs')!.config).toMatchObject({ write: false, edit: false });
    // Neither plan tool carries an escalation field in the composition either.
    const names = planner.plugins.map(entry => entry.name);
    expect(names).not.toContain('@deepseek-ai/dsh-tool-str-replace-editor');
  });

  it('withholds the plan tools from every other role', async () => {
    const { presets } = await composition();
    for (const preset of [presets[0]!, presets[2]!, presets[3]!]) {
      const entries = preset.plugins.find(entry => entry.id === 'preset-tools');
      const list = (entries?.config?.allow ?? []) as string[];
      expect(list, preset.definition.id).not.toContain('write_plan');
      expect(list, preset.definition.id).not.toContain('patch_plan');
    }
  });

  it('lets the planner plan and write cards but never administer a board', async () => {
    const { presets } = await composition();
    const entries = allowed(presets[1]!);
    for (const name of ['create_card', 'edit_card', 'delete_card', 'create_relation', 'send_task_message', 'set_next_transition', 'decision_request', 'create_note', 'delete_team_file']) {
      expect(entries, name).toContain(name);
    }
    for (const name of ['create_board', 'update_board', 'edit_board_yaml', 'add_stage', 'validate_workflow', 'revert_board']) {
      expect(entries, name).not.toContain(name);
    }
    // Every allowlisted name is a product tool, so a typo cannot silently allow nothing.
    expect(entries.every(name => PRODUCT_TOOL_NAMES.includes(name))).toBe(true);
  });

  it('declares card deletion for every role that may write a card, and not for the manager', async () => {
    const { presets } = await composition();
    // The catalog is what makes the tool reachable at all, and the role masks are what
    // narrow it; asserting both keeps the test from passing on composition alone.
    expect(PRODUCT_TOOL_NAMES).toContain('delete_card');
    // A preset without a role mask receives every registered product tool.
    const masked = presets.filter(preset => plugin(preset, 'preset-tools') !== undefined).map(preset => preset.definition.id);
    expect(masked.sort()).toEqual(['kanban-project-manager', 'kanban-project-planner']);
    const surface = (preset: (typeof presets)[number]): string[] => plugin(preset, 'preset-tools') === undefined
      ? [...PRODUCT_TOOL_NAMES]
      : PRODUCT_TOOL_NAMES.filter(name => allowed(preset).includes(name));
    const byId = new Map(presets.map(preset => [preset.definition.id, preset] as const));
    for (const id of ['kanban-workflow-operator', 'kanban-workflow-architect', 'kanban-project-planner']) {
      expect(surface(byId.get(id)!), id).toContain('delete_card');
    }
    expect(surface(byId.get('kanban-project-manager')!)).not.toContain('delete_card');
    // The manager keeps no card write at all, not just the deletion.
    for (const name of ['create_card', 'edit_card', 'create_relation', 'delete_relation']) {
      expect(allowed(byId.get('kanban-project-manager')!), name).not.toContain(name);
    }
  });
  it('masks card deletion out of the manager surface through the shipped allowlist', async () => {
    const { presets } = await composition();
    const manager = presets.find(preset => preset.definition.id === 'kanban-project-manager')!;
    // The mask is what the host applies, so denying the name there is the real guarantee.
    const denied = PRODUCT_TOOL_NAMES.filter(name => !allowed(manager).includes(name));
    expect(denied).toContain('delete_card');
    expect(allowed(manager)).not.toContain('delete_card');
  });
  it('gives the manager no repository, web, delegation, or MCP capability', async () => {
    const { presets } = await composition();
    const manager = presets[2]!;
    const names = manager.plugins.map(entry => entry.name);
    for (const forbidden of [
      '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-tool-subagent',
      '@deepseek-ai/dsh-tool-subagent-fork', '@deepseek-ai/dsh-agent-instructions',
    ]) expect(names).not.toContain(forbidden);
    expect(plugin(manager, 'preset-tools')!.config).toMatchObject({ denyMcp: true });
    expect(manager.plugins.map(entry => entry.id).sort()).toEqual(['compaction', 'kanban-skills', 'persona', 'preset-tools', 'skill-filesystem', 'time-context', 'tool-skill']);
  });

  it('lets the manager read, note, message, and route without writing a card', async () => {
    const { presets } = await composition();
    const entries = allowed(presets[2]!);
    for (const name of ['get_card', 'get_cards', 'list_cards', 'get_workflow_summary', 'create_note', 'update_note', 'send_task_message', 'list_allowed_transitions', 'set_next_transition', 'pause_task', 'resume_task', 'decision_request']) {
      expect(entries, name).toContain(name);
    }
    for (const name of ['create_card', 'edit_card', 'delete_card', 'create_relation', 'delete_relation', 'create_team_file', 'read_team_file', 'create_board', 'update_board']) {
      expect(entries, name).not.toContain(name);
    }
    expect(entries.every(name => PRODUCT_TOOL_NAMES.includes(name))).toBe(true);
  });

  it('resolves each preset skill after relocation without depending on a checkout or cwd', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('presets');
    expect(manifest.exports['./package.json']).toBe('./package.json');
    expect(manifest.exports['./preset-tools']).toBeDefined();
    const directory = await mkdtemp(path.join(tmpdir(), 'dsh-kanban-preset-'));
    temporaryRoots.push({ directory, canonical: await realpath(directory) });
    for (const entry of ['package.json', 'cordis.patch.yml', 'presets']) {
      await cp(path.join(root, entry), path.join(directory, entry), { recursive: true });
    }
    const baseUrl = pathToFileURL(path.join(directory, 'cordis.patch.yml')).href;
    const { presets } = await composition();
    for (const { definition, plugins } of presets) {
      const provider = plugin({ plugins }, 'kanban-skills')!;
      const expression = provider.config!.bundledSkillDir as Expression;
      expect(expression.__jsExpr).not.toContain(root);
      const resolved = evaluate(expression, baseUrl);
      expect(await realpath(resolved)).toBe(await realpath(path.join(directory, 'presets/skills')));
      const skill = await readFile(path.join(resolved, definition.skill, 'SKILL.md'), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
      expect(frontmatter, definition.skill).not.toBeNull();
      const metadata = parseDocument(frontmatter![1]!).toJS();
      expect(metadata.name).toBe(definition.skill);
      expect(metadata.description.length).toBeGreaterThan(20);
    }
  });

  it('keeps progressive resources bounded and all local links inside the shipped package', async () => {
    const files = await markdownFiles(skillRoot);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content.length, path.relative(root, file)).toBeLessThan(7000);
      expect(content).not.toMatch(/\/Users\/|private-dsh|projects\/worktrees/);
      for (const match of content.matchAll(/\]\(<?([^\s)>]+)>?\)/g)) {
        const link = match[1]!;
        if (/^[a-z]+:/.test(link) || link.startsWith('#')) continue;
        const target = path.resolve(path.dirname(file), link.split('#')[0]!);
        expect(target.startsWith(root + path.sep), link).toBe(true);
        await readFile(target, 'utf8');
      }
    }
  });

  it('validates complete reference examples with the real workflow parser', async () => {
    let examples = 0;
    for (const file of await markdownFiles(skillRoot)) {
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(/```ya?ml\n([\s\S]*?)\n```/g)) {
        const yaml = match[1]!;
        if (!/^columns:/m.test(yaml)) continue;
        const workflow = parseWorkflow(yaml);
        expect(workflow.columns.length).toBeGreaterThan(0);
        examples++;
      }
    }
    expect(examples).toBeGreaterThan(0);
  });
});
