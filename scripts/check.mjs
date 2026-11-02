import { execFileSync } from 'node:child_process';
import { typecheckCommands } from './build/plan.mjs';

const commands = [
  ...typecheckCommands(),
  ['node_modules/vitest/vitest.mjs', 'run'],
  ['scripts/build.mjs'],
];
for (const args of commands) execFileSync(process.execPath, args, { stdio: 'inherit' });
