import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  bundleSelected,
  hasComposedKanban,
  hasHostPackageCopies,
  missingEntryPoints,
  parseAllowBuildsKey,
  REQUIRED_ENTRY_POINTS,
  verifyInstall,
  withAllowBuilds,
} from '../../scripts/verify-install-from-git.mjs';

const BLOCKED_KEY = 'dsh-kanban@git+file:///tmp/source#adb5b846d4bff40822fe0c6c01f8ae297e976344';
const BLOCKED = [
  'dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed',
  'allowBuilds:',
  `  ${BLOCKED_KEY}: true`,
].join('\n');

const ok = (stdout = '') => Promise.resolve({ code: 0, stdout, stderr: '' });
const fail = (stderr: string) => Promise.resolve({ code: 1, stdout: '', stderr });

interface HarnessOptions {
  failFirstWithoutKey?: boolean;
  failRetry?: boolean;
  skipEntries?: readonly string[];
  bundles?: readonly string[];
  dump?: string;
  hostCopies?: boolean;
}

async function harness(options: HarnessOptions = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'verify-install-test-'));
  const repo = path.join(base, 'repo');
  await mkdir(repo);
  await writeFile(path.join(repo, 'package.json'), '{}');
  let installs = 0;
  const run = async (command: string, args: string[], runOptions?: { env?: NodeJS.ProcessEnv }) => {
    if (command === 'git') {
      return args.includes('ls-files') ? ok('package.json\0') : ok();
    }
    if (args.includes('--dump-config')) {
      return ok(options.dump ?? '- id: kanban\n  name: dsh-kanban\n');
    }
    if (command === '/fake/dsh' && args[0] === 'plugin') {
      installs += 1;
      if (installs === 1) {
        return options.failFirstWithoutKey ? fail('network failure') : fail(BLOCKED);
      }
      if (options.failRetry) return fail('still blocked');
      const home = runOptions?.env?.DSH_HOME;
      if (home === undefined) throw new Error('missing isolated home');
      const profile = path.join(home, 'profiles', 'p');
      const packageRoot = path.join(profile, 'node_modules', 'dsh-kanban');
      for (const entry of REQUIRED_ENTRY_POINTS.filter(value => !options.skipEntries?.includes(value))) {
        const file = path.join(packageRoot, entry);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, '');
      }
      await writeFile(path.join(profile, 'package.json'), JSON.stringify({
        dsh: { profile: { bundles: options.bundles ?? ['dsh-kanban'] } },
      }));
      if (options.hostCopies === true) await mkdir(path.join(profile, 'node_modules', '@deepseek-ai'), { recursive: true });
      return ok();
    }
    return ok();
  };
  return { base, repo, run, installs: () => installs };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function withHarness<T>(options: HarnessOptions, callback: (context: Harness) => Promise<T>): Promise<T> {
  const context = await harness(options);
  try {
    return await callback(context);
  } finally {
    await rm(context.base, { recursive: true, force: true });
  }
}

function verify(context: Harness, keep = false) {
  return verifyInstall({
    root: context.repo,
    dsh: '/fake/dsh',
    profile: 'p',
    temporaryRoot: context.base,
    run: context.run,
    keep,
  });
}

describe('install verification contract', () => {
  it('reads the exact allowBuilds key pnpm reports', () => {
    expect(parseAllowBuildsKey(BLOCKED)).toBe(BLOCKED_KEY);
    expect(parseAllowBuildsKey('dsh: nothing was installed.')).toBeUndefined();
  });

  it('adds the key without moving existing mappings', () => {
    const merged = withAllowBuilds('packages:\n  - .\nallowBuilds: {}\nnodeLinker: hoisted\n', BLOCKED_KEY);
    const document = parse(merged);
    expect(document.allowBuilds[BLOCKED_KEY]).toBe(true);
    expect(document.nodeLinker).toBe('hoisted');
    expect(document.packages).toEqual(['.']);
  });

  it('rejects a non-mapping allowBuilds value', () => {
    expect(() => withAllowBuilds('allowBuilds: nope\n', BLOCKED_KEY)).toThrow(/mapping/u);
  });

  it('reports every missing installed entry point', () => {
    expect(missingEntryPoints(REQUIRED_ENTRY_POINTS)).toEqual([]);
    expect(missingEntryPoints(['lib/index.js'])).toEqual(REQUIRED_ENTRY_POINTS.slice(1));
  });

  it('requires the exact enabled Kanban row', () => {
    expect(hasComposedKanban('- id: kanban\n  name: dsh-kanban')).toBe(true);
    expect(hasComposedKanban('- id: kanban-other\n  name: dsh-kanban-other')).toBe(false);
    expect(hasComposedKanban('- id: other\n  name: dsh-kanban')).toBe(false);
    expect(hasComposedKanban('- id: kanban\n  name: dsh-kanban\n  disabled: true')).toBe(false);
    expect(hasComposedKanban('not: a list')).toBe(false);
  });

  it('reads the saved bundle selection and host package copies', () => {
    expect(bundleSelected({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-kanban'] } } })).toBe(true);
    expect(bundleSelected({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })).toBe(false);
    expect(bundleSelected(null)).toBe(false);
    expect(hasHostPackageCopies(['dsh-kanban'])).toBe(false);
    expect(hasHostPackageCopies(['@deepseek-ai', 'dsh-kanban'])).toBe(true);
  });

  it('installs, resolves the blocked build, and verifies the committed snapshot', async () => {
    await withHarness({}, async context => {
      const result = await verify(context, true);
      expect(result.entries).toEqual(REQUIRED_ENTRY_POINTS);
      expect(context.installs()).toBe(2);
      if (result.home === undefined) throw new Error('expected a kept verification home');
      const workspace = await readFile(path.join(result.home, 'profiles', 'p', 'pnpm-workspace.yaml'), 'utf8');
      expect(parse(workspace).allowBuilds[BLOCKED_KEY]).toBe(true);
    });
  });

  it('cleans its isolated home after a successful run', async () => {
    await withHarness({}, async context => {
      await verify(context);
      expect(await readdir(context.base)).toEqual(['repo']);
    });
  });

  it('names the install stage when no allowBuilds key is reported', async () => {
    await withHarness({ failFirstWithoutKey: true }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'install' });
      expect(await readdir(context.base)).toEqual(['repo']);
    });
  });

  it('names the retry stage when the approved installation still fails', async () => {
    await withHarness({ failRetry: true }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'install-after-approval' });
    });
  });

  it('rejects an installation without the built entry points', async () => {
    await withHarness({ skipEntries: ['lib/client.js'] }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'installed-entry-points' });
    });
  });

  it('rejects a profile that does not select the bundle', async () => {
    await withHarness({ bundles: ['@deepseek-ai/dsh-base'] }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'bundle-selection' });
    });
  });

  it('rejects an installation that brings host package copies', async () => {
    await withHarness({ hostCopies: true }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'host-package-copies' });
    });
  });

  it('rejects a composition without the exact Kanban row', async () => {
    await withHarness({ dump: '- id: kanban-other\n  name: dsh-kanban-other\n' }, async context => {
      await expect(verify(context)).rejects.toMatchObject({ stage: 'composition' });
    });
  });
});
