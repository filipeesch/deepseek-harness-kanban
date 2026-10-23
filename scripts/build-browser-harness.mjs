import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('tests/browser/.tmp', { recursive: true });
await build({
  entryPoints: ['tests/browser/harness.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: 'tests/browser/.tmp/harness.js',
  logLevel: 'info',
});
await writeFile('tests/browser/.tmp/index.html', '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;min-height:800px}body{font:13px system-ui,sans-serif}</style></head><body><div id="root"></div><script src="./harness.js"></script></body></html>');
