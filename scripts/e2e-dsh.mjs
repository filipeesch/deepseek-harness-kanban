import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const checkoutArg = option('--checkout') ?? process.env.DSH_CHECKOUT;
const checkOnly = args.includes('--check');
const only = option('--only');
if (!checkoutArg) {
  console.error('Usage: node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness [--check] [--only board|conversation|deletion|hubs]');
  process.exit(2);
}
const checkout = resolve(checkoutArg);
function fail(message) { console.error('e2e-dsh: ' + message); process.exit(1); }
function verify() {
  if (!existsSync(join(checkout, 'package.json'))) fail('DSH checkout not found at ' + checkout);
  const tag = execFileSync('git', ['describe', '--tags', '--exact-match'], { cwd: checkout, encoding: 'utf8' }).trim();
  if (tag !== 'dsh-v0.2.1-rc.2') fail('expected DSH dsh-v0.2.1-rc.2, found ' + tag);
  for (const path of ['apps/web/dist/index.html', 'packages/bundle/web-app/lib']) if (!existsSync(join(checkout, path))) fail('missing built DSH artifact ' + path + '; install and run `pnpm run build` in the DSH checkout');
  if (!existsSync(join(root, 'tests/e2e-dsh/question-round.jsonl'))) fail('missing question fixture');
  console.log('e2e-dsh prerequisites: ' + checkout + ' (' + tag + ')');
}
verify();
if (checkOnly) process.exit(0);
execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const scenarios = only === 'board' ? [['kanban-board-ux.e2e.template.ts', 'kanban-board-ux.e2e.ts']] : only === 'conversation' ? [['kanban-conversation-ux.e2e.template.ts', 'kanban-conversation-ux.e2e.ts']] : only === 'deletion' ? [['kanban-deletion.e2e.template.ts', 'kanban-deletion.e2e.ts']] : only === 'hubs' ? [['kanban-hubs.e2e.template.ts', 'kanban-hubs.e2e.ts']] : [['kanban-board-ux.e2e.template.ts', 'kanban-board-ux.e2e.ts'], ['kanban-conversation-ux.e2e.template.ts', 'kanban-conversation-ux.e2e.ts'], ['kanban-deletion.e2e.template.ts', 'kanban-deletion.e2e.ts'], ['kanban-hubs.e2e.template.ts', 'kanban-hubs.e2e.ts']];
const copied = [];
try {
  for (const [template, target] of scenarios) {
    const destination = join(checkout, 'apps/web/tests', target);
    if (existsSync(destination)) throw new Error('Refusing to overwrite existing DSH test file: ' + destination);
    copyFileSync(join(root, 'tests/e2e-dsh', template), destination);
    copied.push(destination);
  }
  execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.web.config.ts', ...copied.map(file => file.slice(checkout.length + 1))], {
    cwd: checkout, stdio: 'inherit',
    env: { ...process.env, DSH_SNAPSHOT: 'replay', KANBAN_ROOT: root, KANBAN_QUESTION_FIXTURE: join(root, 'tests/e2e-dsh/question-round.jsonl') },
  });
} finally {
  for (const file of copied) rmSync(file, { force: true });
}
