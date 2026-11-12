import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/host/deterministic/guard/cli.ts', import.meta.url));

/** Build the real guard bundle at one exact path. */
export async function buildGuard(outfile: string): Promise<string> {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' });
  return outfile;
}

let artifact: Promise<string> | undefined;

/** One guard bundle per test process, for suites that construct the runtime directly. */
export function guardArtifact(): Promise<string> {
  artifact ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kanban-guard-'));
    return buildGuard(join(directory, 'guard.mjs'));
  })();
  return artifact;
}
