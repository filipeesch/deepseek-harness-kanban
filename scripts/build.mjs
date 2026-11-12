import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// A profile can hoist an older copy of the Typert protocol package that does not
// export "./remote-info", and Node resolves that profile copy before the host
// installation. Inline that package into both host entries; every other package
// stays external and is provided by the running host.
const INLINED_HOST_PACKAGE = '@deepseek-ai/dsh-typert-protocol';
/** Specifiers esbuild resolves itself: paths, package import maps, and URL schemes. */
const resolvesItself = (specifier) =>
 specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(specifier);
const hostExternals = {
 name: 'host-externals',
 setup(context) {
  context.onResolve({ filter: /.*/ }, (args) => {
   const { path } = args;
   if (resolvesItself(path)) return undefined;
   if (path === INLINED_HOST_PACKAGE || path.startsWith(`${INLINED_HOST_PACKAGE}/`)) return undefined;
   return { path, external: true };
  });
 },
};
await mkdir('lib', { recursive: true });
// The native lifetime guard is a real module in the execution world, so it is built
// before the host bundle that resolves its path.
await build({entryPoints:['src/host/deterministic/guard/cli.ts'],outfile:'lib/guard.mjs',bundle:true,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
await build({entryPoints:['src/index.ts','src/remote.ts'],outdir:'lib',bundle:true,format:'esm',platform:'node',target:'node24',plugins:[hostExternals],sourcemap:true});
const client=await build({entryPoints:['src/client.tsx'],bundle:true,format:'cjs',platform:'browser',target:'es2022',write:false,jsx:'automatic',loader:{'.css':'text'},external:['react','react/jsx-runtime','react-dom','@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-renderer/client','@deepseek-ai/dsh-client-ui-conversation/client','@deepseek-ai/dsh-api-gateway/client'],sourcemap:false});
const body=client.outputFiles[0].text;
const wrapper='window.__ModuleLoader__.load({id:'+JSON.stringify(manifest.name)+',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n'+body+'\nreturn module.exports;}});\n';
await writeFile('lib/client.js',wrapper);
for(const config of ['tsconfig.build.json','tsconfig.build.client.json'])execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p',config],{stdio:'inherit'});
console.log('Built host, lazy client module, and public declarations.');
