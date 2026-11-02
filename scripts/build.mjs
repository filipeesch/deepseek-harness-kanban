import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { buildPackage } from './build/run.mjs';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
await buildPackage({
  root,
  manifest,
  build,
  mkdir,
  writeFile,
  exec: (args, cwd) => execFileSync(process.execPath, args, { stdio: 'inherit', cwd }),
});
console.log('Built host, lazy client module, and public declarations.');
