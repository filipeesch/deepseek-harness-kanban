import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, isMap, parse, parseDocument, YAMLMap } from 'yaml';

/** Entry points a Git installation must produce for DSH to load the bundle. */
export const REQUIRED_ENTRY_POINTS = [
  'lib/index.js',
  'lib/client.js',
  'lib/remote.js',
  'lib/types/host/index.d.ts',
  'lib/types/client/client.d.ts',
];
const DEFAULT_PROFILE = 'install-verify';
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const defaultIo = { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile };

/** The profile manifest selects the installed bundle by package name. */
export function bundleSelected(profile) {
  const bundles = profile?.dsh?.profile?.bundles;
  return Array.isArray(bundles) && bundles.includes('dsh-kanban');
}

/** `--dump-config` composes the installed bundle's Kanban row. */
export function hasComposedKanban(dump) {
  let entries;
  try {
    entries = parse(dump, { logLevel: 'silent' });
  } catch {
    return false;
  }
  if (!Array.isArray(entries)) return false;
  return entries.some(entry => entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && entry.id === 'kanban'
    && entry.name === 'dsh-kanban'
    && entry.disabled !== true);
}

/** pnpm prints the exact allowBuilds key when a Git-hosted prepare script is blocked. */
export function parseAllowBuildsKey(output) {
  return /^[ \t]+(\S+@\S+): true[ \t]*$/m.exec(output)?.[1];
}

/**
 * Merge the exact key into the profile allowlist with a YAML document, so an
 * existing mapping order, `{}` value, or trailing key cannot move or corrupt it.
 */
export function withAllowBuilds(text, key) {
  const document = text.trim().length === 0 ? new Document({}) : parseDocument(text);
  const current = document.get('allowBuilds');
  if (current === undefined) {
    document.setIn(['allowBuilds', key], true);
  } else {
    if (current === null) document.set('allowBuilds', new YAMLMap());
    else if (!isMap(current)) throw new Error('The profile allowBuilds value must be a mapping.');
    document.setIn(['allowBuilds', key], true);
  }
  return document.toString();
}

export function missingEntryPoints(present) {
  const found = new Set(present);
  return REQUIRED_ENTRY_POINTS.filter(entry => !found.has(entry));
}

export function hasHostPackageCopies(names) {
  return names.includes('@deepseek-ai');
}

class VerificationError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

function execute(command, args, { env = process.env, cwd } = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd,
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const numeric = typeof error?.code === 'number';
      resolve({
        code: error === null ? 0 : numeric ? error.code : 1,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        failure: error !== null && !numeric ? error.message : undefined,
      });
    });
  });
}

function detail(result) {
  return [result.stdout.trim(), result.stderr.trim(), result.failure].filter(Boolean).join('\n');
}

/** Snapshot the working tree, including untracked non-ignored files, as a Git repository. */
async function snapshotWorkingTree(root, target, run, io) {
  const listed = await run('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.code !== 0) throw new VerificationError('snapshot', detail(listed));
  await io.mkdir(target, { recursive: true });
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    const destination = path.join(target, file);
    await io.mkdir(path.dirname(destination), { recursive: true });
    try {
      await io.copyFile(path.join(root, file), destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const args of [
    ['-C', target, 'init', '-q'],
    ['-C', target, 'add', '-A'],
    ['-C', target, '-c', 'user.name=Install Verification', '-c', 'user.email=install@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'install verification snapshot'],
  ]) {
    const result = await run('git', args);
    if (result.code !== 0) throw new VerificationError('snapshot', detail(result));
  }
}

async function approveBuildScripts(profileDirectory, key, io) {
  await io.mkdir(profileDirectory, { recursive: true });
  const workspace = path.join(profileDirectory, 'pnpm-workspace.yaml');
  let text = '';
  try {
    text = await io.readFile(workspace, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await io.writeFile(workspace, withAllowBuilds(text, key));
}

async function installedEntryPoints(packageRoot, io) {
  const present = [];
  for (const entry of REQUIRED_ENTRY_POINTS) {
    try {
      await io.stat(path.join(packageRoot, entry));
      present.push(entry);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return present;
}

/**
 * Install the current working tree from a temporary Git repository into an
 * isolated DSH home and assert the built bundle, its selection, and its row.
 * Runner, filesystem, environment, and temporary-root effects are injectable.
 */
export async function verifyInstall({
  root = process.cwd(),
  env = process.env,
  run = execute,
  io = defaultIo,
  dsh,
  profile = DEFAULT_PROFILE,
  temporaryRoot = tmpdir(),
  keep = false,
} = {}) {
  const dshBin = dsh ?? env.DSH_BIN;
  if (dshBin === undefined || dshBin === '') {
    throw new VerificationError('resolve-dsh', 'Set DSH_BIN to the dsh executable, for example the path under the DSH application resources.');
  }
  const temporary = await io.mkdtemp(path.join(temporaryRoot, 'dsh-kanban-install-'));
  const home = path.join(temporary, 'home');
  const source = path.join(temporary, 'source');
  const profileDirectory = path.join(home, 'profiles', profile);
  const childEnv = { ...env, DSH_HOME: home, GIT_TERMINAL_PROMPT: '0' };
  delete childEnv.DSH_PROFILE;
  try {
    await snapshotWorkingTree(root, source, run, io);
    const spec = `git+file://${source}`;
    const install = () => run(dshBin, ['plugin', '--profile', profile, 'add', spec], { env: childEnv });

    const first = await install();
    if (first.code !== 0) {
      const key = parseAllowBuildsKey(`${first.stdout}\n${first.stderr}`);
      if (key === undefined) throw new VerificationError('install', detail(first));
      try {
        await approveBuildScripts(profileDirectory, key, io);
      } catch (error) {
        throw new VerificationError('approve-build-scripts', error.message);
      }
      const retry = await install();
      if (retry.code !== 0) throw new VerificationError('install-after-approval', detail(retry));
    }

    const packageRoot = path.join(profileDirectory, 'node_modules', 'dsh-kanban');
    const missing = missingEntryPoints(await installedEntryPoints(packageRoot, io));
    if (missing.length > 0) throw new VerificationError('installed-entry-points', `Missing ${missing.join(', ')} in ${packageRoot}.`);

    let installedNames = [];
    try {
      installedNames = await io.readdir(path.join(profileDirectory, 'node_modules'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (hasHostPackageCopies(installedNames)) {
      throw new VerificationError('host-package-copies', 'The profile installed its own @deepseek-ai packages.');
    }

    const manifest = JSON.parse(await io.readFile(path.join(profileDirectory, 'package.json'), 'utf8'));
    if (!bundleSelected(manifest)) throw new VerificationError('bundle-selection', 'The profile does not select dsh-kanban.');

    const dump = await run(dshBin, ['--profile', profile, '--dump-config'], { env: childEnv });
    if (dump.code !== 0) throw new VerificationError('composition', detail(dump));
    if (!hasComposedKanban(dump.stdout)) throw new VerificationError('composition', 'The composed configuration has no enabled kanban row.');

    return { spec, profile, packageRoot, entries: REQUIRED_ENTRY_POINTS, home: keep ? home : undefined };
  } finally {
    if (!keep) await io.rm(temporary, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const keep = process.argv.includes('--keep');
  verifyInstall({ keep })
    .then(result => {
      process.stdout.write(`Verified install from ${result.spec}\n`);
      process.stdout.write(`  profile: ${result.profile}\n`);
      process.stdout.write(`  entries: ${result.entries.join(', ')}\n`);
      if (result.home !== undefined) process.stdout.write(`  kept home: ${result.home}\n`);
    })
    .catch(error => {
      process.stderr.write(`verify-install failed at ${error.stage ?? 'unknown'}: ${error.message}\n`);
      process.exitCode = 1;
    });
}
