import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const lock = parse(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
const range = '>=0.2.2-rc.1 <0.3.0-0';
const versions = [
  ['0.2.1-rc.2', false], ['0.2.2-rc.0', false], ['0.2.2-rc.1', true],
  ['0.2.2-rc.2', true], ['0.2.2', true], ['0.2.3', true],
  ['0.3.0-0', false], ['0.3.0-rc.1', false], ['0.3.0', false],
] as const;

describe('DSH 0.2.2 artifact compatibility', () => {
  it('declares the installed artifact and tested host/Node floors', () => {
    expect(manifest.version).toBe('0.32.0');
    expect(manifest.engines).toEqual({ node: '>=24.9.0', dsh: range });
    expect(manifest.packageManager).toBe('pnpm@10.15.1');
    expect(manifest.scripts.prepare).toBe('node scripts/build.mjs');
    expect(semver.satisfies('24.8.0', manifest.engines.node)).toBe(false);
    expect(semver.satisfies('24.9.0', manifest.engines.node)).toBe(true);
  });

  it.each(versions)('admits host %s as %s with native prerelease semantics', (version, expected) => {
    // DSH evaluates engines.dsh with includePrerelease, not npm's default.
    expect(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true })).toBe(expected);
  });

  it('bounds every direct SDK contract and locks the tested rc.1 graph', () => {
    for (const group of ['peerDependencies', 'devDependencies'] as const) {
      for (const [name, declared] of Object.entries(manifest[group])) {
        if (!name.startsWith('@deepseek-ai/dsh-')) continue;
        expect(declared, name).toBe(range);
        if (group === 'devDependencies') {
          const resolved = lock.importers['.'].devDependencies[name];
          expect(resolved.specifier, name).toBe(range);
          expect(resolved.version, name).toMatch(/^0\.2\.2-rc\.1(?:\(|$)/);
        }
      }
    }
    for (const name of Object.keys(lock.packages)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(name).toMatch(/@0\.2\.2-rc\.1$/);
    }
  });

  it('requires only public native execution peers and inlines the protocol helper', () => {
    for (const name of ['@deepseek-ai/dsh-ptc-runtime', '@deepseek-ai/dsh-shell']) {
      expect(manifest.peerDependencies[name]).toBe(range);
      expect(manifest.devDependencies[name]).toBe(range);
    }
    expect(manifest.dependencies['@deepseek-ai/dsh-typert-protocol']).toBeUndefined();
    expect(manifest.peerDependencies['@deepseek-ai/dsh-typert-protocol']).toBeUndefined();
    expect(manifest.devDependencies['@deepseek-ai/dsh-typert-protocol']).toBe(range);
    for (const group of ['dependencies', 'peerDependencies', 'devDependencies']) {
      expect(Object.keys(manifest[group]).some(name => name.includes('tool-executor-ptc'))).toBe(false);
    }
    // Concrete providers are test-only; deployments keep their native selection.
    expect(manifest.peerDependencies['@deepseek-ai/dsh-ptc-runtime-node']).toBeUndefined();
    expect(manifest.dependencies['@deepseek-ai/dsh-ptc-runtime-node']).toBeUndefined();
    expect(readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8')).toContain("target:'node24'");
  });
});

// This opt-in check imports the actual host evaluator read-only, without booting
// a host or touching a profile, GUI, credential, or model.
const checkout = process.env.DSH_CHECKOUT;
describe.skipIf(!checkout)('native DSH admission contract', () => {
  it('uses the host evaluator for below-floor, floor, and next-minor cases', () => {
    const module = pathToFileURL(join(checkout!, 'packages/boot/app-boot/src/plugin-compatibility.ts')).href;
    const program = [
      'import { evaluatePluginCompatibility } from ' + JSON.stringify(module) + ';',
      'const manifest = ' + JSON.stringify(manifest) + ';',
      'const cases = ' + JSON.stringify(versions) + ';',
      'console.log(JSON.stringify(cases.map(([version]) => evaluatePluginCompatibility(manifest, {}, version) ?? null)));',
    ].join('\n');
    const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' }));
    versions.forEach(([version, accepted], index) => {
      if (accepted) expect(results[index]).toBeNull();
      else expect(results[index]).toMatchObject({ runtimeVersion: version, requirements: { 'engines.dsh': range }, exempted: false });
    });
  });
});
