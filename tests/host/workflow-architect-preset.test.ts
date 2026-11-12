import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { parseWorkflow } from '../../src/domain/workflow.js';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const skillRoot = path.join(root, 'presets/skills/kanban-workflow-design');
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
  const preset = rows.find(row => row.id === 'preset-kanban-workflow-architect')!;
  expect(preset).toBeDefined();
  return { rows, preset, plugins: preset.config!.plugins as Entry[] };
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

describe('shipped Kanban Workflow Architect preset', () => {
  it('adds an independent scoped declaration without remounting Host services or Kanban', async () => {
    const { rows, preset, plugins } = await composition();
    expect(rows.map(row => row.name)).toEqual(['dsh-kanban', '@deepseek-ai/dsh-agent-preset']);
    expect(preset.config).toMatchObject({
      id: 'kanban-workflow-architect', name: 'Kanban Workflow Architect', order: 20,
    });
    expect(new Set(plugins.map(row => row.id)).size).toBe(plugins.length);
    const persona = plugins.find(row => row.name === '@deepseek-ai/dsh-persona')!;
    const prefix = persona.config!.prefix as string;
    expect(prefix.length).toBeLessThan(4000);
    expect(prefix).toContain('kanban-workflow-design');
    expect(prefix).toContain('decision_request');
    expect(persona.config!.complete).not.toBe(true);
    expect(persona.config!.includeRuntimeContext).not.toBe(false);
    expect(plugins.some(row => row.name === 'dsh-kanban')).toBe(false);
  });

  it('retains development tools and keeps service-providing groups isolated', async () => {
    const { plugins } = await composition();
    const names = plugins.map(row => row.name);
    for (const name of [
      'agent-instructions', 'time-context', 'tool-bash', 'tool-pwsh', 'tool-fs',
      'tool-fs-search', 'tool-jobs', 'tool-schedule', 'skill-filesystem', 'tool-skill',
      'tool-cordis', 'tool-goal', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-present',
    ]) expect(names).toContain('@deepseek-ai/dsh-' + name);
    const compaction = plugins.find(row => row.id === 'compaction')!;
    expect(compaction.group).toBe(true);
    expect(compaction.isolate).toEqual({ compaction: true, toolResultPruner: true });
    const delegation = plugins.find(row => row.id === 'delegation')!;
    expect(delegation.group).toBe(true);
    expect(delegation.isolate).toEqual({ workflowEngine: true });
    expect((delegation.config as unknown as Entry[]).map(row => row.name)).toContain('@deepseek-ai/dsh-tool-subagent');
    const base = pathToFileURL(path.join(root, 'cordis.patch.yml')).href;
    const bash = plugins.find(row => row.id === 'tool-bash')!.disabled!;
    const pwsh = plugins.find(row => row.id === 'tool-pwsh')!.disabled!;
    expect(evaluate(bash, base, 'win32')).toBe(true);
    expect(evaluate(pwsh, base, 'win32')).toBe(false);
    expect(evaluate(bash, base, 'linux')).toBe(false);
    expect(evaluate(pwsh, base, 'linux')).toBe(true);
  });

  it('resolves packaged resources after relocation without depending on a checkout or cwd', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('presets');
    expect(manifest.exports['./package.json']).toBe('./package.json');
    const directory = await mkdtemp(path.join(tmpdir(), 'dsh-kanban-preset-'));
    temporaryRoots.push({ directory, canonical: await realpath(directory) });
    for (const entry of ['package.json', 'cordis.patch.yml', 'presets']) {
      await cp(path.join(root, entry), path.join(directory, entry), { recursive: true });
    }
    const { plugins } = await composition();
    expect(plugins.find(row => row.id === 'skill-filesystem')!.config).toBeUndefined();
    const provider = plugins.find(row => row.id === 'kanban-skills')!;
    expect(provider.config).toMatchObject({ providerName: 'kanban-bundled', includeDefaultRoots: false });
    const expression = provider.config!.bundledSkillDir as Expression;
    expect(expression.__jsExpr).not.toContain(root);
    const resolved = evaluate(expression, pathToFileURL(path.join(directory, 'cordis.patch.yml')).href);
    expect(await realpath(resolved)).toBe(await realpath(path.join(directory, 'presets/skills')));
    const skill = await readFile(path.join(resolved, 'kanban-workflow-design/SKILL.md'), 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    expect(frontmatter).not.toBeNull();
    const metadata = parseDocument(frontmatter![1]!).toJS();
    expect(metadata.name).toBe('kanban-workflow-design');
    expect(metadata.description.length).toBeGreaterThan(20);
  });

  it('keeps progressive resources bounded and all local links inside the shipped package', async () => {
    const files = await markdownFiles(skillRoot);
    expect(files.length).toBeGreaterThan(1);
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
