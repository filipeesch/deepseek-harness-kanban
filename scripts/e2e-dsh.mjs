import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import semver from 'semver';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const checkoutArg = option('--checkout') ?? process.env.DSH_CHECKOUT;
const checkOnly = args.includes('--check');
const only = option('--only');
if (args.includes('--only') && only === undefined) {
  console.error('e2e-dsh: --only requires a value');
  process.exit(2);
}
if (!checkoutArg) {
  console.error('Usage: node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness [--check] [--only background-delete|board|conversation|decision|deletion|hubs|schedules|override|native-drawer|sidebar|auto-run|auto-mode|declared|create-start|prepare|board-model|project|messages|history|workflow-architect|scripted|transit] [--skip-build]');
  process.exit(2);
}
const checkout = resolve(checkoutArg);
function fail(message) { console.error('e2e-dsh: ' + message); process.exit(1); }
function describeCheckout() {
  try { return execFileSync('git', ['describe', '--tags', '--always', '--dirty'], { cwd: checkout, encoding: 'utf8' }).trim(); }
  catch { return 'not a git checkout'; }
}
function pluginDshVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return manifest.engines?.dsh;
  } catch { return undefined; }
}
function verify() {
  const manifestPath = join(checkout, 'package.json');
  if (!existsSync(manifestPath)) fail('DSH checkout not found at ' + checkout);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (error) { fail('DSH checkout package.json is not valid JSON: ' + String(error)); }
  const version = typeof manifest.version === 'string' ? manifest.version : 'unknown';
  const tag = describeCheckout();
  for (const path of ['apps/web/dist/index.html', 'packages/bundle/web-app/lib']) if (!existsSync(join(checkout, path))) fail('missing built DSH artifact ' + path + '; install and run `pnpm run build` in the DSH checkout');
  if (!existsSync(join(root, 'tests/e2e-dsh/question-round.jsonl'))) fail('missing question fixture');
  if (!existsSync(join(root, 'tests/e2e-dsh/task-context.jsonl'))) fail('missing task-context fixture');
  if (!existsSync(join(root, 'tests/e2e-dsh/ordinary-chat.jsonl'))) fail('missing ordinary-chat fixture');
  if (!existsSync(join(root, 'tests/e2e-dsh/auto-run.replay.override.json'))) fail('missing auto-run replay override');
  if (!existsSync(join(root, 'tests/e2e-dsh/auto-mode.replay.override.json'))) fail('missing auto-mode replay override');
  if (!existsSync(join(root, 'tests/e2e-dsh/declared-transition.replay.override.json'))) fail('missing declared-transition replay override');
  if (!existsSync(join(root, 'tests/e2e-dsh/create-start.replay.override.json'))) fail('missing create-start replay override');
  if (!existsSync(join(root, 'tests/e2e-dsh/native-drawer.replay.override.json'))) fail('missing native-drawer replay override');
  if (!existsSync(join(root, 'tests/e2e-dsh/decision.replay.override.json'))) fail('missing decision replay override');
  const pinned = pluginDshVersion();
  if (pinned !== undefined && version !== 'unknown' && !semver.satisfies(version, pinned, { includePrerelease: true })) {
    console.warn('e2e-dsh: the plugin expects DSH ' + pinned + ' but the checkout reports ' + version + '; continuing with the checkout as requested.');
  }
  console.log('e2e-dsh prerequisites: ' + checkout + ' (' + tag + '; version ' + version + ')');
}
verify();
if (checkOnly) process.exit(0);
if (!args.includes('--skip-build')) execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
// Templates belong to this plugin, so resolve their browser from the plugin's
// installed test dependency rather than assuming a hoisted host dependency.
const localRequire = createRequire(import.meta.url);
const playwright = createRequire(localRequire.resolve('@playwright/test/package.json')).resolve('playwright');
const scenarioTemplates = new Map([
  ['board', ['kanban-board-ux.e2e.template.ts', 'kanban-board-ux.e2e.ts']],
  ['conversation', ['kanban-conversation-ux.e2e.template.ts', 'kanban-conversation-ux.e2e.ts']],
  ['deletion', ['kanban-deletion.e2e.template.ts', 'kanban-deletion.e2e.ts']],
  ['background-delete', ['kanban-background-delete.e2e.template.ts', 'kanban-background-delete.e2e.ts']],
  ['hubs', ['kanban-hubs.e2e.template.ts', 'kanban-hubs.e2e.ts']],
  ['schedules', ['kanban-schedules.e2e.template.ts', 'kanban-schedules.e2e.ts']],
  ['override', ['kanban-move-override.e2e.template.ts', 'kanban-move-override.e2e.ts']],
  ['native-drawer', ['kanban-native-drawer.e2e.template.ts', 'kanban-native-drawer.e2e.ts']],
  ['sidebar', ['kanban-sidebar.e2e.template.ts', 'kanban-sidebar.e2e.ts']],
  ['auto-run', ['kanban-auto-run.e2e.template.ts', 'kanban-auto-run.e2e.ts']],
  ['auto-mode', ['kanban-auto-mode.e2e.template.ts', 'kanban-auto-mode.e2e.ts']],
  ['declared', ['kanban-declared-transition.e2e.template.ts', 'kanban-declared-transition.e2e.ts']],
  ['create-start', ['kanban-create-start.e2e.template.ts', 'kanban-create-start.e2e.ts']],
  ['prepare', ['kanban-prepare.e2e.template.ts', 'kanban-prepare.e2e.ts', 'kanban-board-model.e2e.template.ts', 'kanban-board-model.e2e.ts']],
  ['board-model', ['kanban-board-model.e2e.template.ts', 'kanban-board-model.e2e.ts']],
  ['project', ['kanban-project-management.e2e.template.ts', 'kanban-project-management.e2e.ts']],
  ['messages', ['kanban-messages.e2e.template.ts', 'kanban-messages.e2e.ts']],
  ['history', ['kanban-history.e2e.template.ts', 'kanban-history.e2e.ts']],
  ['workflow-architect', ['kanban-workflow-architect.e2e.template.ts', 'kanban-workflow-architect.e2e.ts']],
  ['scripted', ['kanban-scripted.e2e.template.ts', 'kanban-scripted.e2e.ts']],
  ['transit', ['kanban-transit.e2e.template.ts', 'kanban-transit.e2e.ts']],
  ['decision', ['kanban-decision.e2e.template.ts', 'kanban-decision.e2e.ts']],
]);
if (only !== undefined && !scenarioTemplates.has(only)) fail('unknown --only value: ' + only);
// A group is one [template, target] pair or a list of them, so one selector can
// cover several scenarios that belong to the same flow.
const asPairs = (group) => (Array.isArray(group[0]) ? group : group.map((_, index) => index % 2 === 0 ? group.slice(index, index + 2) : null).filter(Boolean));
const requested = (only === undefined ? [...scenarioTemplates.values()] : [scenarioTemplates.get(only)]).flatMap(asPairs);
// A scenario can belong to a group and still have its own selector — `prepare` runs
// the board-model flow, `--only board-model` runs it alone — and the default run
// flattens every group. One destination is copied exactly once, or the second copy
// trips the refusal to overwrite and the whole suite dies before it starts.
const scenarios = [...new Map(requested.map(pair => [pair[1], pair])).values()];
// Stage plugin-owned files outside the native checkout. Import its helpers by
// absolute path so their built-artifact anchors remain correct, without writing
// source files into a shared DSH checkout or loading its personal .env.
const stage = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-kanban-e2e-')));
const home = join(stage, 'home');
const config = join(stage, 'vitest.config.mts');
const testFiles = [];
try {
  mkdirSync(home);
  symlinkSync(join(checkout, 'node_modules'), join(stage, 'node_modules'), 'dir');
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // Alias discovery is importer-ancestor scoped; give staged tests a local
  // facade that inherits the native source contract without copying it.
  writeFileSync(join(stage, 'tsconfig.json'), JSON.stringify({ extends: join(checkout, 'tsconfig.base.json'), include: ['**/*.ts'] }));
  writeFileSync(join(stage, 'kanban-e2e-setup.ts'), readFileSync(join(root, 'tests/e2e-dsh/kanban-e2e-setup.ts')));
  for (const [template, target] of scenarios) {
    const destination = join(stage, target);
    const source = readFileSync(join(root, 'tests/e2e-dsh', template), 'utf8')
      .replaceAll("'./scaffold.ts'", JSON.stringify(join(checkout, 'apps/web/tests/scaffold.ts')))
      .replaceAll("'./support.ts'", JSON.stringify(join(checkout, 'apps/web/tests/support.ts')))
      .replaceAll("new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url)",
        'new URL(' + JSON.stringify(new URL('snapshots/web/live-interactions/session.v3.jsonl', 'file://' + checkout + '/').href) + ')');
    writeFileSync(destination, source);
    testFiles.push(destination);
  }
  // The staged tests import the checkout's own scaffold, whose workspace
  // packages live behind per-package links that the isolated stage cannot walk.
  // Alias every workspace package (and its explicit subpath exports) to a real
  // file in the checkout, so the same source the checkout built is used.
  const workspaceAliases = {};
  const packageDirs = [];
  const directories = list => list.filter(dir => { try { return statSync(dir).isDirectory(); } catch { return false; } });
  for (const [base, depth] of [['vendor', 1], ['packages', 2], ['apps', 1], ['native/system/packages', 1]]) {
    const root = join(checkout, base);
    if (!existsSync(root)) continue;
    let dirs = directories(readdirSync(root).map(name => join(root, name)));
    if (depth === 2) dirs = dirs.flatMap(group => directories(readdirSync(group).map(name => join(group, name))));
    packageDirs.push(...dirs);
  }
  for (const dir of packageDirs) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof manifest.name !== 'string') continue;
      const targets = [];
      const rootExport = manifest.exports?.['.'] ?? manifest.module ?? manifest.main;
      const value = typeof rootExport === 'string' ? rootExport : rootExport?.default ?? rootExport?.import;
      if (typeof value === 'string') targets.push([manifest.name, join(dir, value)]);
      for (const [key, entry] of Object.entries(manifest.exports ?? {})) {
        if (!key.startsWith('./') || key.includes('*')) continue;
        const path = typeof entry === 'string' ? entry : entry?.default ?? entry?.import;
        if (typeof path === 'string' && !path.includes('*')) targets.push([manifest.name + key.slice(1), join(dir, path)]);
      }
      for (const [name, file] of targets) if (existsSync(file) && workspaceAliases[name] === undefined) workspaceAliases[name] = file;
      if (workspaceAliases[manifest.name] === undefined) {
        for (const fallback of ['lib/index.js', 'src/index.ts', 'src/index.tsx']) {
          if (existsSync(join(dir, fallback))) { workspaceAliases[manifest.name] = join(dir, fallback); break; }
        }
      }
    } catch { /* a directory without a usable manifest is not a package */ }
  }
  writeFileSync(config, [
    "import { defineConfig } from 'vitest/config';",
    "import tsconfigPaths from 'vite-tsconfig-paths';",
    'import { standardDecoratorPlugin, vitestExecArgv } from ' + JSON.stringify(join(checkout, 'vitest.shared.ts')) + ';',
    'export default defineConfig({',
    'root:' + JSON.stringify(stage) + ', cacheDir:' + JSON.stringify(join(stage, 'cache')) + ',',
    'resolve:{alias:[' + [{ find: 'playwright', replacement: playwright }, ...Object.entries(workspaceAliases).map(([name, file]) => ({ find: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$'), replacement: file }))].map(entry => `{find:${entry.find instanceof RegExp ? `new RegExp(${JSON.stringify(entry.find.source)})` : JSON.stringify(entry.find)},replacement:${JSON.stringify(entry.replacement)}}`).join(',') + ']},',
    'plugins:[tsconfigPaths({projects:[' + JSON.stringify(join(stage, 'tsconfig.json')) + ',' + JSON.stringify(join(checkout, 'tsconfig.base.json')) + ']}),standardDecoratorPlugin()],',
    'test:{execArgv:vitestExecArgv,include:["*.e2e.ts"],testTimeout:180000,hookTimeout:120000,fileParallelism:false}',
    '});',
  ].join('\n'));
  const environment = Object.fromEntries(['PATH', 'TMPDIR', 'SystemRoot', 'LANG', 'LC_ALL', 'TERM']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  execFileSync(process.execPath, [join(checkout, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, ...testFiles], {
    cwd: stage, stdio: 'inherit',
    env: { ...environment, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, '.verification/playwright-browsers'), DSH_SNAPSHOT: 'replay', KANBAN_ROOT: root,
      KANBAN_QUESTION_FIXTURE: join(root, 'tests/e2e-dsh/question-round.jsonl'), KANBAN_TASK_CONTEXT_FIXTURE: join(root, 'tests/e2e-dsh/task-context.jsonl'),
      KANBAN_ORDINARY_CHAT_FIXTURE: join(root, 'tests/e2e-dsh/ordinary-chat.jsonl'),
      KANBAN_AUTORUN_OVERRIDE: join(root, 'tests/e2e-dsh/auto-run.replay.override.json'), KANBAN_AUTOMODE_OVERRIDE: join(root, 'tests/e2e-dsh/auto-mode.replay.override.json'),
      KANBAN_DECLARED_OVERRIDE: join(root, 'tests/e2e-dsh/declared-transition.replay.override.json'), KANBAN_CREATESTART_OVERRIDE: join(root, 'tests/e2e-dsh/create-start.replay.override.json'),
      KANBAN_NATIVE_OVERRIDE: join(root, 'tests/e2e-dsh/native-drawer.replay.override.json'), KANBAN_DECISION_OVERRIDE: join(root, 'tests/e2e-dsh/decision.replay.override.json') },
  });
} finally {
  // stage is the verified, test-owned mkdtemp result, never a computed checkout path.
  rmSync(stage, { recursive: true, force: true });
}