/**
 * The packaging plan shared by the build entry, the `prepare` lifecycle, and the
 * check script: entry points, externals, and command lines live here once.
 */
export const HOST_ENTRIES = ['src/index.ts', 'src/remote.ts'];
export const CLIENT_ENTRY = 'src/client.tsx';
export const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-api-gateway/client',
];
export const DECLARATION_PROJECTS = ['tsconfig.build.json', 'tsconfig.build.client.json'];
export const TYPECHECK_PROJECTS = ['tsconfig.host.json', 'tsconfig.client.json'];
export const BUILD_DIRECTORY = 'lib';
export const CLIENT_OUTPUT = 'lib/client.js';

/** Host bundles stay external to packages so the profile supplies the SDK at runtime. */
export function hostBuildOptions(root) {
  return {
    absWorkingDir: root,
    entryPoints: HOST_ENTRIES,
    outdir: BUILD_DIRECTORY,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    packages: 'external',
    sourcemap: true,
  };
}

/** The browser entry is bundled in memory so it can be wrapped for the DSH module loader. */
export function clientBuildOptions(root) {
  return {
    absWorkingDir: root,
    entryPoints: [CLIENT_ENTRY],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    write: false,
    jsx: 'automatic',
    external: CLIENT_EXTERNALS,
    sourcemap: false,
  };
}

export function clientWrapper(moduleName, body) {
  return 'window.__ModuleLoader__.load({id:' + JSON.stringify(moduleName)
    + ',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' + body
    + '\nreturn module.exports;}});\n';
}

export function tscArgs(project, { noEmit = false } = {}) {
  return ['node_modules/typescript/bin/tsc', '-p', project, ...(noEmit ? ['--noEmit'] : [])];
}

export function declarationCommands() {
  return DECLARATION_PROJECTS.map(project => tscArgs(project));
}

export function typecheckCommands() {
  return TYPECHECK_PROJECTS.map(project => tscArgs(project, { noEmit: true }));
}
