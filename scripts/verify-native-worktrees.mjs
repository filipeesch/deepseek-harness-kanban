#!/usr/bin/env node
import { mkdir, lstat, realpath, writeFile, readFile, stat, rename } from "node:fs/promises";
import { installFixtureToolGuard } from "./verify-native-conversations.mjs";
import { resolve, relative, join, dirname, basename, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connectInspector, callHost } from "./dsh-inspect.mjs";
import { GUI_URL, INSPECTOR_URL, isCleanRoot, assertOfficialLaunchUrl, acknowledgePreviewNotice } from "./live-verify.mjs";
const execute = promisify(execFile);
const STAGES = /* @__PURE__ */ new Set(["arguments", "authorization", "debug-guard", "dependency", "inspector", "browser", "owner-login", "clean-root", "preview", "native-preflight", "fixture-path", "fixture-git", "projects", "root-fresh", "read-only", "outside-root", "root-new", "os-confinement", "shared-target", "shared-target-create", "shared-target-capture", "shared-target-policy", "shared-target-directory", "shared-target-command", "shared-target-result", "shared-target-return", "shared-target-foreign-return", "shared-target-reattach", "dirty-decline", "dirty-discard", "no-tree", "existing-branch", "partial-retry", "partial-return", "attach", "monorepo", "archive-resume", "boundary-prompt", "cleanup", "artifact"]);
const CHECKS = /* @__PURE__ */ new Set(["freshDistinctNoTurns", "sameNativeIds", "nativeHistoryPreserved", "readOnlyDenied", "outsideRootDenied", "newBranch", "existingBranch", "attachExisting", "monorepoCwd", "osConfinement", "sharedTargetProtected", "dirtyDecline", "dirtyDiscard", "branchPreserved", "noTreeBasePreserved", "notesDeleted", "allRetainedBaseBeforeRemoval", "nativeArchived", "nativeUnarchiveBase", "partialGitRetry", "returnPreservesTree", "partialCwdReturn", "returnFailurePreservesTree", "globalDefaultsUnchanged", "optionalPreStepBoundary"]);
const CODES = /* @__PURE__ */ new Set(["not-authorized", "not-exercised", "native-busy-wait-not-exercised", "partial-cwd-not-reproduced", "partial-cwd-not-exercised", "pre-step-boundary-not-exercised", "native-confinement-unavailable", "pre-removal-window-not-observed", "native-operation-uncertain", "fixture-cleanup-blocked", "native-archive-failed", "resource-close-failed", "fixture-policy-restore-failed", "owned-base-restore-required", "pending-journal-recovery-not-exercised"]);
class NativeWorktreeFailure extends Error {
  constructor(stage) {
    super("Native G3/G5 verification failed at stage: " + (STAGES.has(stage) ? stage : "arguments"));
    this.name = "NativeWorktreeFailure";
    this.stage = STAGES.has(stage) ? stage : "arguments";
  }
}
const HELP = "Usage: node scripts/verify-native-worktrees.mjs --allow-owner-test --allow-fixture-data --allow-fixture-policy-changes [--allow-model-requests] [--timeout-ms 30000]\nParent READY is required. Existing backend 51781 / inspector 9230 only. Uses normal owner-cookie login in an ephemeral browser. Leaves fixture bases and registered projects under .verification/native-fixtures/g3/run-<nonce> for archived conversation cwd validity. No existing data/default settings, core or profile-file edits. No raw credentials, errors, traces, HAR, storageState, or replacement server. Default makes no model request; optional flag permits at most one fixed no-tool boundary prompt. ok means implemented cases passed, NOT full live G3/G5 closure. fullGatePass remains false while native busy-wait, mid-cwd, and pending-journal recovery remain. Native-job/reload cases are not enabled by this core helper yet.";
function assertAuthorizations(options) {
  if (options?.allowOwnerTest !== true || options?.allowFixtureData !== true || options?.allowFixturePolicyChanges !== true) throw new NativeWorktreeFailure("authorization");
  if (!Number.isSafeInteger(options.timeoutMs ?? 3e4) || (options.timeoutMs ?? 3e4) < 1e3 || (options.timeoutMs ?? 3e4) > 12e4) throw new NativeWorktreeFailure("arguments");
  if (options.allowModelRequests !== void 0 && typeof options.allowModelRequests !== "boolean") throw new NativeWorktreeFailure("arguments");
}
function parseArgs(argv) {
  const result = { allowOwnerTest: false, allowFixtureData: false, allowFixturePolicyChanges: false, allowModelRequests: false, timeoutMs: 3e4, help: false }, seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new NativeWorktreeFailure("arguments");
    seen.add(flag);
    if (flag === "--help") {
      result.help = true;
      continue;
    }
    if (flag === "--allow-owner-test") {
      result.allowOwnerTest = true;
      continue;
    }
    if (flag === "--allow-fixture-data") {
      result.allowFixtureData = true;
      continue;
    }
    if (flag === "--allow-fixture-policy-changes") {
      result.allowFixturePolicyChanges = true;
      continue;
    }
    if (flag === "--allow-model-requests") {
      result.allowModelRequests = true;
      continue;
    }
    if (flag === "--timeout-ms") {
      const value = argv[++i];
      if (!/^[0-9]+$/.test(value ?? "")) throw new NativeWorktreeFailure("arguments");
      result.timeoutMs = Number(value);
      continue;
    }
    throw new NativeWorktreeFailure("arguments");
  }
  if (!result.help) assertAuthorizations(result);
  return result;
}
function assertQuietEnvironment(env) {
  if (["DEBUG", "DEBUG_FILE", "PWDEBUG", "PLAYWRIGHT_TRACE_DIR", "NODE_DEBUG", "NODE_DEBUG_NATIVE", "PW_TEST_DEBUG_LOG"].some((key) => !!env[key])) throw new NativeWorktreeFailure("debug-guard");
}
function modelBudget() {
  let attempted = 0;
  return { reserve(allowed) {
    if (allowed !== true || attempted !== 0) throw new NativeWorktreeFailure("authorization");
    attempted++;
  }, snapshot: () => attempted };
}
function isEntityId(value) {return typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);}
function isNativeSessionId(value) {return typeof value==="string"&&/^session-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);}
function assertOwnedIds(ids, owned, kind="session") {
  const valid=kind==="session"?isNativeSessionId:kind==="entity"?isEntityId:undefined;
  if (!valid || !Array.isArray(ids) || ids.length===0 || new Set(ids).size!==ids.length || ids.some(id=>!valid(id)||!owned.has(id)))throw new NativeWorktreeFailure("cleanup");
}
function fixturePaths(workspace, nonce) {
  if (!isAbsolute(workspace) || /[\0\r\n]/.test(workspace) || !/^[a-f0-9]{12}$/.test(nonce)) throw new NativeWorktreeFailure("fixture-path");
  const base = resolve(workspace, ".verification", "native-fixtures", "g3"), run = join(base, "run-" + nonce), root = join(run, "root-project"), mono = join(run, "monorepo");
  if (relative(base, run).includes(sep) || !relative(workspace, run).startsWith(".verification" + sep + "native-fixtures" + sep + "g3" + sep)) throw new NativeWorktreeFailure("fixture-path");
  return { base, run, root, mono, monoProject: join(mono, "apps", "api"), evidence: join(run, "evidence"), report: join(run, "evidence", "g3-g5.json"), sentinel: join(run, "outside-workspace-sentinel.txt"), control: join(root, ".native-g3", "control"), attempt: join(root, ".native-g3", "attempt"), complete: join(root, ".native-g3", "complete"), sleepMarker: join(root, ".native-g3", "sleep-start"), rootNew: join(root, ".qa-worktrees", "new"), rootExisting: join(root, ".qa-worktrees", "existing"), external: join(root, ".qa-worktrees", "external"), denied: join(run, "outside-root-tree"), monoTree: join(run, "monorepo-tree") };
}
function inside(root, value) {
  const part = relative(root, value);
  return part === "" || !isAbsolute(part) && part !== ".." && !part.startsWith(".." + sep);
}
function assertOwnedPath(paths, value) {
  if (!isAbsolute(value) || /[\0\r\n]/.test(value) || !inside(paths.run, resolve(value))) throw new NativeWorktreeFailure("fixture-path");
  return resolve(value);
}
function shellQuote(value) {
  if (/[\0\r\n]/.test(value)) throw new NativeWorktreeFailure("fixture-path");
  return "'" + value.replaceAll("'", `'"'"'`) + "'";
}
function fixtureHook(paths) {
  for(const value of [paths.root,paths.control,paths.attempt,paths.complete,paths.sentinel,paths.sleepMarker])assertOwnedPath(paths,value);
  return ["#!/bin/sh", "mode=none", "IFS= read -r mode < " + shellQuote(paths.control) + " || :", 'if [ "$mode" = deny ]; then', "  printf attempted > " + shellQuote(paths.attempt), "  { printf ESCAPED > " + shellQuote(paths.sentinel) + "; } 2>/dev/null || :", "  printf completed > " + shellQuote(paths.complete), "fi", 'if [ "$mode" = sleep ]; then', "  printf started > " + shellQuote(paths.sleepMarker), "  /bin/sleep 3", "fi", "exit 0", ""].join("\n");
}
async function canonicalOwned(paths, value, io = { lstat, realpath }) {
  const target = assertOwnedPath(paths, value);
  let parent = target;
  while (true) {
    try {
      const info = await io.lstat(parent);
      if (info.isSymbolicLink() || await io.realpath(parent) !== parent) throw new NativeWorktreeFailure("fixture-path");
      break;
    } catch (error) {
      if (error instanceof NativeWorktreeFailure) throw error;
      if (error?.code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw new NativeWorktreeFailure("fixture-path");
      parent = next;
    }
  }
  return target;
}
async function checkedDirectory(value, io) {
  await io.mkdir(value, { recursive: true });
  const info = await io.lstat(value);
  if (info.isSymbolicLink() || !info.isDirectory() || await io.realpath(value) !== value) throw new NativeWorktreeFailure("fixture-path");
}
async function prepareFixture(options, workspace, nonce, io = { mkdir, lstat, realpath, writeFile }, run = execute) {
  assertAuthorizations(options);
  const root = await io.realpath(workspace), paths = fixturePaths(root, nonce);
  for (const parts of [[".verification"], [".verification", "native-fixtures"], [".verification", "native-fixtures", "g3"]]) await checkedDirectory(join(root, ...parts), io);
  await io.mkdir(paths.run);
  for (const value of [paths.evidence, paths.root, paths.monoProject]) await checkedDirectory(value, io);
  if (await io.realpath(paths.run) !== paths.run) throw new NativeWorktreeFailure("fixture-path");
  const env = Object.fromEntries(["PATH", "SystemRoot", "SYSTEMROOT", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"].filter((key) => typeof process.env[key] === "string").map((key) => [key, process.env[key]]));
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" });
  for (const repo of [paths.root, paths.mono]) {
    const opts = { cwd: repo, env, timeout: 1e4, maxBuffer: 65536, windowsHide: true };
    const git = async (args) => run("git", args, opts);
    await git(["init", "--initial-branch=main", "--template="]);
    await io.writeFile(join(repo, ".gitignore"), ".qa-worktrees/\n.native-g3/\n", { flag: "wx", mode: 384 });
    await io.writeFile(join(repo, "fixture.txt"), "Native worktree acceptance fixture " + nonce + "\n", { flag: "wx", mode: 384 });
    if (repo === paths.mono) await io.writeFile(join(paths.monoProject, "app.txt"), "Monorepo API fixture\n", { flag: "wx", mode: 384 });
    await git(["-c", "core.hooksPath=" + join(repo, ".disabled-hooks"), "-c", "core.fsmonitor=false", "add", "."]);
    await git(["-c", "core.hooksPath=" + join(repo, ".disabled-hooks"), "-c", "core.fsmonitor=false", "-c", "user.name=DSH G3 Fixture", "-c", "user.email=g3@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Isolated native worktree fixture"]);
    await git(["config", "--local", "core.fsmonitor", "false"]);
    await git(["config", "--local", "core.hooksPath", join(repo, repo===paths.root?".git/hooks":".disabled-hooks")]);
  }
  await checkedDirectory(join(paths.root, ".native-g3"), io);
  await checkedDirectory(join(paths.root, ".git", "hooks"), io);
  await io.writeFile(paths.control, "none\n", { flag: "wx", mode: 384 });
  await io.writeFile(paths.sentinel, "UNCHANGED " + nonce + "\n", { flag: "wx", mode: 384 });
  await io.writeFile(join(paths.root, ".git", "hooks", "post-checkout"), fixtureHook(paths), { flag: "wx", mode: 448 });
  return paths;
}
const nativeAction = async function(payload) {
  const ctx=this.root??this,action=payload.action,controller=ctx.get('sessionController');
  if(action.kind==='preflight') {
    const presets=ctx.get('permissionPresets'),working=ctx.get('workingDirectory'),workspace=ctx.get('workspaceRegistry');
    if(!presets||!controller||typeof controller.inspect!=='function'||typeof controller.projections!=='function'||typeof controller.resolveAgent!=='function'||!working||typeof working.get!=='function'||typeof working.set!=='function'||!workspace||typeof workspace.archiveSession!=='function'||typeof workspace.unarchiveSession!=='function'||!ctx.get('sandboxPolicy')||typeof ctx.waterfall!=='function')throw new Error();
    for(const mode of ['read-only','workspace-write','danger-full-access'])if(!presets.names.includes(mode)||presets.resolve(mode).sandbox!==mode)throw new Error();
    return {defaultPreset:presets.catalog().defaultPreset,policyModes:['read-only','workspace-write','danger-full-access'],nativeConfinementAdvertised:typeof ctx.get('sandbox')?.confine==='function',exactProjections:true};
  }
  if(!['summary','policy','directory','archive','unarchive','cancel','prompt'].includes(action.kind)||payload.allowOwnerTest!==true||payload.allowFixtureData!==true)throw new Error();
  if(action.kind==='policy'&&payload.allowFixturePolicyChanges!==true)throw new Error();
  if(['prompt','cancel'].includes(action.kind)&&payload.allowModelRequests!==true)throw new Error();
  if(['prompt','cancel'].includes(action.kind)&&payload.modelRequests!==1)throw new Error();
  const origins=new Map(payload.origins.map(item=>[item.id,item.origin]));
  if(origins.size!==payload.origins.length)throw new Error();
  const allowedOrigins=new Set(payload.allowedOrigins),allowedCwds=new Set(payload.allowedCwds),fullOrigins=new Set(payload.allowedFullOrigins??[]);
  const inspect=async id=>{
    if(!/^session-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!origins.has(id)||!allowedOrigins.has(origins.get(id)))throw new Error();
    const value=await controller.inspect(id,AbortSignal.timeout(10000));
    if(value.meta.cwd!==origins.get(id)||!Array.isArray(value.events))throw new Error();
    return value;
  };
  // Exact committed observations must never activate an Agent or let ensure() repair a bad cwd.
  const projection=async id=>{
    const value=await controller.projections({sessionId:id},AbortSignal.timeout(10000));
    if(value?.kind!=='sequenced'||!value.values)throw new Error();return value.values;
  };
  const observed=async id=>{
    const values=await projection(id),cwd=values.workingDirectory;
    if(typeof cwd!=='string'||!allowedCwds.has(cwd))throw new Error();return cwd;
  };
  const idle=async(id,snapshot)=>{
    if((await ctx.waterfall('workspace/session-activity',{sessionId:id},()=>Promise.resolve([]))).length!==0)return false;
    const agent=ctx.get('agents')?.get(id);
    if(agent&&(agent.status!=='idle'||agent.inbox.nextTurn.length>0))return false;
    const values=await projection(id);
    if(values.turnBoundary?.openTurnStartSeq!=null||Array.isArray(values.inbox?.['next-turn'])&&values.inbox['next-turn'].length>0||Array.isArray(values.userQuestions?.active)&&values.userQuestions.active.length>0)return false;
    const events=(snapshot??await inspect(id)).events;let open=false;const approvals=new Set();
    for(const event of events){if(event.type==='turn/start')open=true;if(event.type==='turn/end'){open=false;approvals.clear();}if(event.type==='approval/asked'&&typeof event.data?.id==='string')approvals.add(event.data.id);if(event.type==='approval/decided')approvals.delete(event.data?.id);}
    return !open&&approvals.size===0;
  };
  const effectAgent=async id=>{
    const before=await observed(id),resolved=await controller.resolveAgent(id);
    if('error' in resolved||resolved.agent?.id!==id||resolved.agent.session?.id!==id)throw new Error();
    await inspect(id);
    if(await observed(id)!==before||ctx.get('workingDirectory').get(resolved.agent.session)!==before||!await idle(id))throw new Error();
    return resolved.agent;
  };
  const fingerprint=events=>{
    const text=JSON.stringify(events);let a=2166136261,b=2246822507;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
    return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  };
  if(action.kind==='summary') {
    if(!Array.isArray(action.ids)||action.ids.length===0)throw new Error();const result={};
    for(const id of action.ids){
      const value=await inspect(id),events=value.events,expected=payload.prefixes?.[id],ends=events.filter(e=>e.type==='turn/end'),kind=ends.at(-1)?.data.reason.kind;
      if(expected&&(!Number.isSafeInteger(expected.count)||expected.count<0||!/^[0-9a-f]{16}$/.test(expected.fingerprint)))throw new Error();
      result[id]={origin:value.meta.cwd,cwd:await observed(id),eventCount:events.length,prefixCount:expected?.count??events.length,prefixFingerprint:expected?.fingerprint??fingerprint(events),prefixMatches:!expected||events.length>=expected.count&&fingerprint(events.slice(0,expected.count))===expected.fingerprint,users:events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='user').length,assistants:events.filter(e=>e.type==='assistant/message').length,turnStarts:events.filter(e=>e.type==='turn/start').length,turnEnds:ends.length,tools:events.filter(e=>['tool/call','tool/result','tool/ptc-dispatch-start','tool/ptc-dispatch'].includes(e.type)).length,lastReason:['completed','blocked','error','aborted','max-iterations'].includes(kind)?kind:null,archived:ctx.get('workspaceRegistry').archivedSessionIds.includes(id),mode:null,idle:await idle(id,value)};
      const live=ctx.get('sessions')?.get(id);if(live)result[id].mode=ctx.get('sandboxPolicy').resolve({session:live}).mode;
    }
    return result;
  }
  const id=action.id;await inspect(id);
  if(action.kind==='cancel'){await controller.cancel({sessionId:id});return true;}
  if(action.kind==='unarchive'){await ctx.get('workspaceRegistry').unarchiveSession(id);return true;}
  if(!await idle(id))throw new Error();
  if(action.kind==='archive'){await ctx.get('workspaceRegistry').archiveSession(id);return true;}
  if(action.kind==='policy'&&(!['read-only','workspace-write','danger-full-access'].includes(action.mode)||action.mode==='danger-full-access'&&!fullOrigins.has(origins.get(id))))throw new Error();
  if(action.kind==='directory'&&!allowedCwds.has(action.directory))throw new Error();
  const live=await effectAgent(id);
  if(action.kind==='policy') {
    const owner=ctx.get('permissionPresets');if(!owner.names.includes(action.mode)||owner.resolve(action.mode).sandbox!==action.mode)throw new Error();
    const before=ctx.get('sandboxPolicy').resolve({session:live.session}).mode,originalPreset=owner.current(live.session);
    owner.set(live.session,action.mode);const after=ctx.get('sandboxPolicy').resolve({session:live.session}).mode;if(after!==action.mode)throw new Error();return {before,after,originalPreset};
  }
  if(action.kind==='directory') {
    if(!allowedCwds.has(action.directory))throw new Error();
    await ctx.get('workingDirectory').set(live,action.directory,AbortSignal.timeout(10000));
    if(ctx.get('workingDirectory').get(live.session)!==action.directory||await observed(id)!==action.directory)throw new Error();return true;
  }
  if(action.kind==='prompt') {
    await controller.prompt({sessionId:id,requestId:action.requestId,mode:'queue',content:[{type:'text',text:'Reply exactly NATIVE_G3_BOUNDARY_OK. Do not call any tools. Do not read, write, or modify files.'}]},AbortSignal.timeout(15000));return true;
  }
  throw new Error();
};
const DIAGNOSTIC_CODES=new Set(['UNKNOWN_ERROR','KANBAN_ERROR','SHARED_WORKTREE','SANDBOX_DENIED','SANDBOX_UNAVAILABLE','SANDBOX_INCOMPLETE','PATH_UNAVAILABLE','SESSION_CONTEXT_UNAVAILABLE','SESSION_STATE_UNAVAILABLE','SESSION_ACTIVE','INVALID_PATH','INVALID_DIRECTORY','DISCARD_REQUIRED','WORKTREE_CHANGED','OPERATION_PENDING','OPERATION_CANCELLED','GIT_FAILED','GIT_TIMEOUT','CONTEXT_MISMATCH','DIRECTORY_SWITCH_FAILED','FORBIDDEN']);
function operationDiagnostic(error,stage,surface) {
  const text=typeof error?.message==='string'?error.message.slice(0,16384):'';
  return {stage:STAGES.has(stage)?stage:'arguments',surface:['business','native-effect','transport','assertion'].includes(surface)?surface:'assertion',code:DIAGNOSTIC_CODES.has(error?.code)?error.code:'UNKNOWN_ERROR',projection:/projection/i.test(text),typeError:/TypeError|not a function|Cannot read properties|is not iterable/i.test(text),missingPath:/ENOENT|no such file|directory.*(?:missing|does not exist)/i.test(text),permission:/EACCES|EPERM|permission denied|not permitted/i.test(text),shared:error?.code==='SHARED_WORKTREE'||/another (?:native session|task).*(?:checkout|worktree)/i.test(text),timeout:/timeout|timed out|cancelled|aborted/i.test(text)};
}
/** A separately created fixture C must stop holding a checkout BEFORE any task deletion. */
async function returnForeignFixturesBeforeRemoval(options,paths,taskInfos,origins,actions) {
  assertAuthorizations(options);
  const retained=new Set([...taskInfos].flatMap(info=>info.sessions)),returned=[];
  for(const [id,origin] of origins) {
    assertOwnedIds([id],new Set(origins.keys()));if(retained.has(id))continue;
    if(![paths.root,paths.monoProject].includes(origin))throw new NativeWorktreeFailure('cleanup');assertOwnedPath(paths,origin);
    const before=await actions.summary(id);
    if(before.origin!==origin||!before.idle||!before.prefixMatches)throw new NativeWorktreeFailure('cleanup');
    await actions.validateOrigin(origin);
    if(before.cwd!==origin){if(before.archived)await actions.unarchive(id);await actions.directory(id,origin);}
    const after=await actions.summary(id);
    if(after.origin!==origin||after.cwd!==origin||!after.idle||!after.prefixMatches)throw new NativeWorktreeFailure('cleanup');
    returned.push(id);
  }
  return returned;
}
function safeReport(report) {
  const checks=Object.fromEntries(Object.entries(report.checks??{}).filter(([key,value])=>CHECKS.has(key)&&typeof value==='boolean'));
  const runId=/^[a-f0-9]{12}$/.test(report.runId??'')?report.runId:undefined;
  const entityIds=value=>Array.isArray(value)?value.filter(isEntityId):[];
  const sessionIds=value=>Array.isArray(value)?value.filter(isNativeSessionId):[];
  const mode=value=>['read-only','workspace-write','danger-full-access'].includes(value);
  const reasons=new Set(['read-only-test','root-policy','foreign-fixture','partial-injection','partial-retry','monorepo-policy','monorepo-explicit-full','cleanup','cleanup-restrict']);
  let fixture;
  const candidate=report.fixture?.run;
  if(runId&&typeof candidate==='string'&&isAbsolute(candidate)&&!/[\0\r\n?#]|:\/\//.test(candidate)&&candidate.endsWith(sep+'.verification'+sep+'native-fixtures'+sep+'g3'+sep+'run-'+runId)){
    fixture={run:candidate,report:join(candidate,'evidence','g3-g5.json'),retained:report.fixture?.retained===true,projectsRetained:report.fixture?.projectsRetained===true};
  }
  const remaining=(report.remaining??[]).filter(value=>CODES.has(value));
  return {
    gate:'G3/G5',ok:report.ok===true,fullGatePass:report.ok===true&&!remaining.some(value=>value.includes("not-exercised")||value.includes("not-observed")||value.includes("not-reproduced")),stage:STAGES.has(report.stage)?report.stage:'arguments',runId,fixture,
    ids:{projects:entityIds(report.ids?.projects),tasks:entityIds(report.ids?.tasks),sessions:sessionIds(report.ids?.sessions)},checks,
    remaining,
    diagnostics:(Array.isArray(report.diagnostics)?report.diagnostics:[]).slice(0,32).map(item=>({stage:STAGES.has(item.stage)?item.stage:"arguments",surface:["business","native-effect","transport","assertion"].includes(item.surface)?item.surface:"assertion",code:DIAGNOSTIC_CODES.has(item.code)?item.code:"UNKNOWN_ERROR",...Object.fromEntries(["projection","typeError","missingPath","permission","shared","timeout"].map(key=>[key,item[key]===true]))})),
    coverage:{G3:checks.newBranch&&checks.monorepoCwd&&checks.osConfinement?'core-cases-passed; remaining native cases are explicitly listed':'incomplete',G5:checks.nativeUnarchiveBase&&checks.dirtyDiscard&&checks.noTreeBasePreserved&&checks.allRetainedBaseBeforeRemoval&&checks.returnFailurePreservesTree?'implemented-cases-passed':'incomplete'},
    modelRequests:Number.isInteger(report.modelRequests)&&report.modelRequests>=0&&report.modelRequests<=1?report.modelRequests:0,
    cleanup:{attempted:report.cleanup?.attempted===true,baseRestored:report.cleanup?.baseRestored===true,deletedTasks:entityIds(report.cleanup?.deletedTasks),archived:sessionIds(report.cleanup?.archived),errors:(report.cleanup?.errors??[]).filter(value=>CODES.has(value))},
    policies:(Array.isArray(report.policies)?report.policies:[]).filter(item=>isNativeSessionId(item.id)&&mode(item.before)&&mode(item.after)&&reasons.has(item.reason)).map(item=>({id:item.id,before:item.before,after:item.after,reason:item.reason}))
  };
}
/** Move only the intentionally held monorepo base; never replace an existing destination. */
async function moveOwnedBase(options,paths,move,io={lstat,realpath,rename}) {
  assertAuthorizations(options);
  const nonce=/^run-([a-f0-9]{12})$/.exec(basename(paths.run))?.[1];
  if(!nonce||paths.monoProject!==join(paths.run,'monorepo','apps','api'))throw new NativeWorktreeFailure('fixture-path');
  const base=paths.monoProject,held=base+'.held-'+nonce;
  if(!((move.from===base&&move.to===held)||(move.from===held&&move.to===base)))throw new NativeWorktreeFailure('fixture-path');
  await canonicalOwned(paths,move.from,io);await canonicalOwned(paths,move.to,io);
  const source=await io.lstat(move.from);
  if(!source.isDirectory()||source.isSymbolicLink()||await io.realpath(move.from)!==move.from)throw new NativeWorktreeFailure('fixture-path');
  let absent=false;
  try{await io.lstat(move.to);}catch(error){if(error?.code!=='ENOENT')throw error;absent=true;}
  if(!absent)throw new NativeWorktreeFailure('fixture-path');
  await io.rename(move.from,move.to);
}
function creationId(snapshot,kind) {
  const receipt=snapshot?.commandReceipt;
  const valid=kind==='conversation'?isNativeSessionId:['task','project','note'].includes(kind)?isEntityId:undefined;
  if(!valid||receipt?.kind!==kind||!valid(receipt.id))throw new Error();
  return receipt.id;
}

function sessionCreationId(value) {
  if(!isNativeSessionId(value?.sessionId))throw new Error();
  return value.sessionId;
}
async function bounded(action, timeout) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error()), timeout);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(read, predicate, timeout, signal) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const value = await bounded(read, Math.min(deadline-Date.now(),10000));
    if (predicate(value)) return value;
    const remaining=deadline-Date.now();if(remaining<=0)break;
    await new Promise((done,reject)=>{
      const finish=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);done();};
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new Error());};
      const timer=setTimeout(finish,Math.min(100,remaining));signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
    });
  }
  throw new Error();
}
async function close(resource) {
  if (resource) await bounded(() => resource.close(), 5e3);
}
async function acquire(action,timeout) {
  let expired=false;
  try{return await bounded(async()=>{const resource=await action();if(expired){await close(resource).catch(()=>{});throw new Error();}return resource;},timeout);}
  catch(error){expired=true;throw error;}
}
function unwrapRpcEnvelope(body,rpcId) {
  if (!body || body.type!=="server-response" || body.rpcId!==rpcId || body.result?.ok!==true || !Object.hasOwn(body.result,"value")) throw new Error();
  return body.result.value;
}
function unwrapBusinessOutcome(outcome) {
  if (!outcome || outcome.ok!==true || !Object.hasOwn(outcome,'value')) throw new Error();
  return outcome.value;
}
async function rpc(page,endpoint,args,timeoutMs=30000) {
  if (!isCleanRoot(page.url()) || !['kanban/snapshot','kanban/command','session/create'].includes(endpoint) || !args || typeof args!=="object" || Array.isArray(args) || !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>120000) throw new Error();
  const rpcId=randomUUID();
  const body=await bounded(()=>page.evaluate(async({endpoint,args,rpcId,timeoutMs})=>{
    const response=await fetch('api/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload:{args}})});
    if (!response.ok) throw new Error();
    return response.json();
  },{endpoint,args,rpcId,timeoutMs}),timeoutMs);
  return unwrapRpcEnvelope(body,rpcId);
}
async function boardSnapshot(page,timeoutMs=30000) {
  const value=unwrapBusinessOutcome(await rpc(page,'kanban/snapshot',{},timeoutMs));
  if(!value?.state||!Array.isArray(value.state.tasks)||!Array.isArray(value.state.projects)||!Array.isArray(value.state.notes))throw new Error();
  return value;
}
async function boundaryGuard(host, options, ids, cwd) {
  const group = "g3-tool-guard-" + randomUUID();
  const document = await host.call("DOM.getDocument", { depth: 3 });
  const branch = document.root.children?.find((n) => n.localName === "host");
  const node = branch?.children?.find((n) => n.localName === "context");
  if (!node) throw new Error();
  const { object } = await host.call("DOM.resolveNode", { nodeId: node.nodeId, objectGroup: group });
  if (!object?.objectId) throw new Error();
  const made = await host.call("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: installFixtureToolGuard.toString(), arguments: [{ value: { allowOwnerTest: options.allowOwnerTest, allowFixtureData: options.allowFixtureData, allowModelRequests: options.allowModelRequests } }, { value: ids }, { value: cwd }], returnByValue: false, awaitPromise: true });
  if (made.exceptionDetails || !made.result?.objectId) {
    await host.call("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {
    });
    throw new Error();
  }
  const handle = made.result.objectId;
  return { async snapshot() {
    const value = await host.call("Runtime.callFunctionOn", { objectId: handle, functionDeclaration: "function(){return this.snapshot();}", returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error();
    return value.result.value;
  }, async dispose() {
    try {
      const value = await host.call("Runtime.callFunctionOn", { objectId: handle, functionDeclaration: "async function(){return await this.dispose();}", returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error();
    } finally {
      await host.call("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {
      });
    }
  } };
}
async function runVerification(options, dependencies = {}) {
  assertAuthorizations(options);
  assertQuietEnvironment(dependencies.env ?? process.env);
  const timeout = options.timeoutMs ?? 3e4, nonce = (dependencies.nonce ?? (() => randomUUID().replaceAll("-", "").slice(0, 12)))();
  if (!/^[a-f0-9]{12}$/.test(nonce)) throw new NativeWorktreeFailure("fixture-path");
  let stage = "dependency", host, browser, context, page, launchUrl, paths, defaults, guard, pendingMove, cleaning = false;
  const checks = {}, diagnostics = [], remaining = ["native-busy-wait-not-exercised", "partial-cwd-not-exercised", "pending-journal-recovery-not-exercised"], policies = [], ownedTasks = /* @__PURE__ */ new Map(), ownedSessions = /* @__PURE__ */ new Map(), projectIds = [], prefixes = {}, budget = modelBudget(), cleanup = { attempted: false, baseRestored: true, deletedTasks: [], archived: [], errors: [] };
  const stop = new AbortController();
  const interrupted = () => stop.abort();
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  const hostCall = dependencies.hostCall ?? callHost;
  const wait = (read, predicate, ms = timeout) => until(read, predicate, ms, cleaning ? undefined : stop.signal);
  const allowedCwds = () => paths ? [paths.root, paths.monoProject, paths.rootNew, paths.rootExisting, paths.external, join(paths.monoTree, "apps/api")] : [];
  const targets = () => paths ? /* @__PURE__ */ new Set([paths.rootNew, paths.rootExisting, paths.external, paths.denied, paths.monoTree]) : /* @__PURE__ */ new Set();
  const native = async (action) => {
    if (action.ids) assertOwnedIds(action.ids, new Set(ownedSessions.keys()));
    if (action.id) assertOwnedIds([action.id], new Set(ownedSessions.keys()));
    try{return await bounded(() => hostCall(host, nativeAction.toString(), [{ action, origins: [...ownedSessions].map(([id, origin]) => ({ id, origin })), allowedOrigins: paths ? [paths.root, paths.monoProject] : [], allowedCwds: allowedCwds(), allowedFullOrigins: paths ? [paths.monoProject] : [], prefixes, modelRequests: budget.snapshot(), allowOwnerTest: options.allowOwnerTest, allowFixtureData: options.allowFixtureData, allowFixturePolicyChanges: options.allowFixturePolicyChanges, allowModelRequests: options.allowModelRequests }]), timeout);}
    catch(error){diagnostics.push(operationDiagnostic(error,cleaning?"cleanup":stage,"native-effect"));throw error;}
  };
  const summaries = (ids) => native({ kind: "summary", ids });
  const capture = async (id, origin) => {
    if(!isNativeSessionId(id)||ownedSessions.has(id)){remaining.push("native-operation-uncertain");cleanup.errors.push("native-operation-uncertain");throw new Error();}
    ownedSessions.set(id, origin);
    let verifiedOrigin = false;
    try {
      const value = (await summaries([id]))[id];
      if (value.origin !== origin) throw new Error();
      verifiedOrigin = true;
      if (value.turnStarts || value.users || value.assistants || value.tools) throw new Error();
      prefixes[id] = { count: value.eventCount, fingerprint: value.prefixFingerprint };
      return value;
    } catch (error) {
      if (!verifiedOrigin) ownedSessions.delete(id);
      throw error;
    }
  };
  const policy = async (ids, mode, reason) => {
    assertOwnedIds(ids, new Set(ownedSessions.keys()));
    for (const id of ids) {
      const result2 = await native({ kind: "policy", id, mode });
      policies.push({ id, before: result2.before, after: result2.after, reason });
    }
  };
  const snapshot = () => boardSnapshot(page,timeout);
  const task = async (id) => {
    if (!ownedTasks.has(id)) throw new Error();
    const value = (await snapshot()).state.tasks.find((t) => t.id === id);
    if (value && (value.projectId !== ownedTasks.get(id).projectId || value.title !== ownedTasks.get(id).title)) throw new Error();
    return value;
  };
  const command = async (request) => {
    if (!cleaning) stop.signal.throwIfAborted();
    if (request.type === "project.save") {
      if (request.project.id !== void 0 || !request.project.name.startsWith("DSH G3 " + nonce + " ") || ![paths.root, paths.monoProject].includes(request.project.projectPath) || ![paths.root, paths.mono].includes(request.project.gitRootPath)) throw new Error();
    } else if (request.type === "task.create") {
      if (!projectIds.includes(request.projectId) || !request.title.startsWith("DSH G3 " + nonce + " ")) throw new Error();
    } else {
      if (!ownedTasks.has(request.taskId)) throw new Error();
      const current = await task(request.taskId);
      if (!current) throw new Error();
      if (request.sessionId && !current.sessionIds.includes(request.sessionId)) throw new Error();
      if (request.path && !targets().has(request.path)) throw new Error();
      if (current.worktree && !targets().has(current.worktree.path)) throw new Error();
      if (current.operation?.targetPath && !targets().has(current.operation.targetPath)) throw new Error();
      if (["worktree.remove", "task.delete"].includes(request.type) && request.expectedWorktreePath !== (current.worktree?.path ?? null)) throw new Error();
      if (!["conversation.create", "conversation.close", "worktree.create", "worktree.attach", "worktree.remove", "operation.retry", "operation.return", "task.delete", "note.save"].includes(request.type)) throw new Error();
    }
    try{const result=await rpc(page,"kanban/command",{request},timeout);if(result?.ok===false)diagnostics.push(operationDiagnostic(result.error,cleaning?"cleanup":stage,"business"));return result;}
    catch(error){diagnostics.push(operationDiagnostic(error,cleaning?"cleanup":stage,"transport"));remaining.push("native-operation-uncertain");cleanup.errors.push("native-operation-uncertain");throw new Error();}
  };
  const must = async (request) => unwrapBusinessOutcome(await command(request));
  const write = async (value, text) => {
    assertAuthorizations(options);
    await canonicalOwned(paths, value);
    await writeFile(value, text, { mode: 384 });
  };
  const ownGit = async (repo, args) => {
    if (![paths.root, paths.mono].includes(repo) || await realpath(repo) !== repo) throw new Error();
    const env = Object.fromEntries(["PATH", "SystemRoot", "SYSTEMROOT", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"].filter((key) => typeof process.env[key] === "string").map((key) => [key, process.env[key]]));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" });
    return execute("git", ["-c", "core.hooksPath=" + join(repo, ".disabled-hooks"), "-c", "core.fsmonitor=false", ...args], { cwd: repo, env, timeout: 1e4, maxBuffer: 65536, windowsHide: true });
  };
  const claimCreation = (value,kind) => {
    try { return creationId(value,kind); } catch { remaining.push("native-operation-uncertain"); cleanup.errors.push("native-operation-uncertain"); throw new Error(); }
  };
  const register = async (name, projectPath, gitRootPath) => {
    const value = await must({ type: "project.save", project: { name: "DSH G3 " + nonce + " " + name, projectPath, gitRootPath, defaultBranch: "main" } });
    const id = claimCreation(value,"project");
    const found = value.state.projects.filter((p) => p.id === id && p.name === "DSH G3 " + nonce + " " + name && p.projectPath === projectPath && p.gitRootPath === gitRootPath);
    if (found.length !== 1) throw new Error();
    projectIds.push(found[0].id);
    return found[0].id;
  };
  const createTask = async (label, projectId, origin, two = true) => {
    const title = "DSH G3 " + nonce + " " + label;
    const created = await must({ type: "task.create", projectId, title, description: "Isolated native G3/G5 acceptance fixture; no automatic agent execution." });
    const madeId = claimCreation(created,"task");
    const found = created.state.tasks.filter((t) => t.id === madeId && t.projectId === projectId && t.title === title);
    if (found.length !== 1 || found[0].sessionIds.length !== 1) throw new Error();
    const id = found[0].id;
    ownedTasks.set(id, { title, projectId, origin });
    await capture(found[0].sessionIds[0], origin);
    if (two) {
      const conversation = await must({ type: "conversation.create", taskId: id });
      const newSessionId = claimCreation(conversation,"conversation");
      const current2 = await task(id);
      if(!current2.sessionIds.includes(newSessionId)||ownedSessions.has(newSessionId))throw new Error();
      if (current2.sessionIds.length !== 2 || current2.sessionIds[0] === current2.sessionIds[1]) throw new Error();
      for (const sid of current2.sessionIds) if (!ownedSessions.has(sid)) await capture(sid, origin);
      await must({ type: "conversation.close", taskId: id, sessionId: current2.sessionIds[1] });
      if (!(await task(id)).closedSessionIds.includes(current2.sessionIds[1])) throw new Error();
    }
    const current = await task(id);
    return { id, sessions: [...current.sessionIds], origin };
  };
  const expectCwd = async (info, directory) => {
    const bound = await task(info.id);
    if (bound && (bound.sessionIds.length !== info.sessions.length || bound.sessionIds.some((id, index) => id !== info.sessions[index]))) throw new Error();
    const current = await summaries(info.sessions);
    if (info.sessions.some((id) => current[id].origin !== info.origin || current[id].cwd !== directory || !current[id].prefixMatches)) throw new Error();
    checks.sameNativeIds = true;
    checks.nativeHistoryPreserved = true;
    return current;
  };
  const denied = (value) => {
    if (value?.ok === false && ["SANDBOX_UNAVAILABLE", "SANDBOX_INCOMPLETE"].includes(value.error?.code)) { remaining.push("native-confinement-unavailable"); stage = "native-preflight"; throw new Error(); }
    return value?.ok === false && ["SANDBOX_DENIED", "FS_SANDBOX_DENIED", "READ_ONLY"].includes(value.error?.code);
  };
  const expectMissing = async (value) => {
    try {
      await stat(value);
      return false;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
  };
  const removeTask = async (info, discard) => {
    const current = await task(info.id);
    if (!current) throw new Error();
    const root = current.worktree?.path ?? null;
    let settled = false, observed = false;
    const deleting = command({ type: "task.delete", taskId: info.id, confirmed: true, expectedWorktreePath: root, discardChanges: discard }).then((value2) => {
      settled = true;
      return value2;
    }, (error) => {
      settled = true;
      throw error;
    });
    const watched = deleting.catch(() => void 0);
    if (root) {
      const deadline=Date.now()+timeout;
      while (!settled) {
        if(Date.now()>=deadline){remaining.push("native-operation-uncertain");cleanup.errors.push("native-operation-uncertain");throw new Error();}
        if(!cleaning)stop.signal.throwIfAborted();
        const current2 = await task(info.id);
        if (current2?.operation?.phase === "removing" && !await expectMissing(root)) {
          const values = await summaries(info.sessions);
          if (info.sessions.every((id) => values[id].cwd === info.origin) && !await expectMissing(root)) observed = true;
        }
        await new Promise((resolve2) => setTimeout(resolve2, 30));
      }
    }
    const value = await deleting;
    await watched;
    if (value?.ok !== true) throw new Error();
    if (root && !observed) {
      remaining.push("pre-removal-window-not-observed");
      throw new Error();
    }
    if (root) checks.allRetainedBaseBeforeRemoval = true;
    if (await task(info.id)) throw new Error();
    const result2 = await expectCwd(info, info.origin);
    if (info.sessions.some((id) => !result2[id].archived)) throw new Error();
    checks.nativeArchived = true;
    for (const id of info.sessions) {
      await native({ kind: "unarchive", id });
      const restored = (await summaries([id]))[id];
      if (restored.cwd !== info.origin || restored.archived || !restored.prefixMatches) throw new Error();
      await native({ kind: "archive", id });
    }
    checks.nativeUnarchiveBase = true;
    cleanup.deletedTasks.push(info.id);
    return true;
  };
  try {
    const { chromium } = await bounded(dependencies.loadPlaywright ?? (() => import("@playwright/test")), timeout);
    stage = "inspector";
    host = await acquire(() => (dependencies.connect ?? connectInspector)({ endpoint: INSPECTOR_URL, timeoutMs: timeout }), timeout);
    await host.call("Runtime.enable");
    stage = "browser";
    browser = await acquire(()=>chromium.launch({ headless: true, timeout }),timeout);
    context = await acquire(()=>browser.newContext({ viewport: { width: 1400, height: 1e3 }, acceptDownloads: false, serviceWorkers: "block" }),timeout);
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);
    await context.route("**/*", async (route) => {
      try {
        new URL(route.request().url()).origin === new URL(GUI_URL).origin ? await route.continue() : await route.abort("blockedbyclient");
      } catch {
        await route.abort("failed").catch(() => {
        });
      }
    });
    page = await acquire(()=>context.newPage(),timeout);
    stage = "owner-login";
    launchUrl = await bounded(()=>hostCall(host, function() {
      return (this.root ?? this).get("connection").authenticatedUrl("http://127.0.0.1:51781/");
    }.toString()),timeout);
    assertOfficialLaunchUrl(launchUrl);
    try {
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout });
    } finally {
      launchUrl = void 0;
    }
    stage = "clean-root";
    await page.waitForURL((url) => isCleanRoot(url.href), { timeout });
    if (!isCleanRoot(page.url())) throw new Error();
    stage = "preview";
    await (dependencies.acknowledgePreview ?? acknowledgePreviewNotice)(page, timeout);
    stage = "native-preflight";
    defaults = await native({ kind: "preflight" });
    await snapshot();
    if (defaults.nativeConfinementAdvertised !== true) throw new Error();
    stage = "fixture-path";
    paths = await (dependencies.prepareFixture ?? prepareFixture)(options, fileURLToPath(new URL("../", import.meta.url)), nonce);
    stage = "projects";
    const rootProject = await register("root fixture project", paths.root, paths.root);
    const monoProject = await register("monorepo fixture project", paths.monoProject, paths.mono);
    stage = "root-fresh";
    const root = await createTask("new branch task", rootProject, paths.root);
    const fresh = await summaries(root.sessions);
    if (root.sessions.some((id) => fresh[id].users || fresh[id].assistants || fresh[id].tools || fresh[id].turnStarts)) throw new Error();
    checks.freshDistinctNoTurns = true;
    const noteSnapshot=await must({type:"note.save",taskId:root.id,content:"Owned G3/G5 acceptance note "+nonce});
    const noteId=claimCreation(noteSnapshot,"note");
    if(!(await snapshot()).state.notes.some(note=>note.id===noteId&&note.taskId===root.id))throw new Error();
    stage = "read-only";
    await policy(root.sessions, "read-only", "read-only-test");
    const readOnly = await command({ type: "worktree.create", taskId: root.id, mode: "new", path: paths.rootNew, branchName: "native-g3-" + nonce + "-root", sourceBranch: "main" });
    if (!denied(readOnly) || !await expectMissing(paths.rootNew)) throw new Error();
    await expectCwd(root, paths.root);
    checks.readOnlyDenied = true;
    await must({ type: "operation.return", taskId: root.id });
    stage = "outside-root";
    await policy(root.sessions, "workspace-write", "root-policy");
    const outside = await command({ type: "worktree.create", taskId: root.id, mode: "new", path: paths.denied, branchName: "native-g3-" + nonce + "-outside", sourceBranch: "main" });
    if (!denied(outside) || !await expectMissing(paths.denied)) throw new Error();
    await expectCwd(root, paths.root);
    checks.outsideRootDenied = true;
    await must({ type: "operation.return", taskId: root.id });
    stage = "root-new";
    await write(paths.control, "deny\n");
    await must({ type: "worktree.create", taskId: root.id, mode: "new", path: paths.rootNew, branchName: "native-g3-" + nonce + "-root", sourceBranch: "main" });
    await expectCwd(root, paths.rootNew);
    checks.newBranch = true;
    stage = "os-confinement";
    if (await readFile(paths.sentinel, "utf8") !== "UNCHANGED " + nonce + "\n" || await readFile(paths.attempt, "utf8") !== "attempted" || await readFile(paths.complete, "utf8") !== "completed") throw new Error();
    checks.osConfinement = true;
    await write(paths.control, "none\n");
    stage = "shared-target-create";
    const createdC = await rpc(page, "session/create", { request: { cwd: paths.root } },timeout);
    let C;try{C=sessionCreationId(createdC);}catch{remaining.push("native-operation-uncertain");cleanup.errors.push("native-operation-uncertain");throw new Error();}
    stage="shared-target-capture";await capture(C, paths.root);
    stage="shared-target-policy";await policy([C], "workspace-write", "foreign-fixture");
    stage="shared-target-directory";await native({ kind: "directory", id: C, directory: paths.rootNew });
    stage="shared-target-command";const shared = await command({ type: "worktree.remove", taskId: root.id, confirmed: true, expectedWorktreePath: paths.rootNew, discardChanges: true });
    stage="shared-target-result";if (shared?.ok !== false || shared.error?.code !== "SHARED_WORKTREE" || await expectMissing(paths.rootNew)) throw new Error();
    checks.sharedTargetProtected = true;
    stage="shared-target-return";await must({ type: "operation.return", taskId: root.id });
    await expectCwd(root, paths.root);
    stage="shared-target-foreign-return";await native({ kind: "directory", id: C, directory: paths.root });
    stage="shared-target-reattach";await must({ type: "worktree.attach", taskId: root.id, path: paths.rootNew });
    stage = "dirty-decline";
    await write(join(paths.rootNew, "untracked-consent.txt"), "Requires explicit discard " + nonce + "\n");
    await write(join(paths.rootNew, "fixture.txt"), "Tracked local change " + nonce + "\n");
    const declined = await command({ type: "task.delete", taskId: root.id, confirmed: true, expectedWorktreePath: paths.rootNew, discardChanges: false });
    if (declined?.ok !== false || declined.error?.code !== "DISCARD_REQUIRED" || !(await readFile(join(paths.rootNew, "untracked-consent.txt"), "utf8")).includes(nonce)) throw new Error();
    await expectCwd(root, paths.rootNew);
    checks.dirtyDecline = true;
    stage = "dirty-discard";
    await removeTask(root, true);
    checks.dirtyDiscard = true;
    if((await snapshot()).state.notes.some(note=>note.taskId===root.id))throw new Error();
    checks.notesDeleted=true;
    await ownGit(paths.root, ["show-ref", "--verify", "refs/heads/native-g3-" + nonce + "-root"]);
    checks.branchPreserved = true;
    stage = "no-tree";
    const noTree = await createTask("no worktree task", rootProject, paths.root, false);
    await removeTask(noTree, false);
    if (await readFile(join(paths.root, "fixture.txt"), "utf8") !== "Native worktree acceptance fixture " + nonce + "\n") throw new Error();
    checks.noTreeBasePreserved = true;
    stage = "existing-branch";
    const existing = await createTask("existing branch task", rootProject, paths.root);
    await policy(existing.sessions, "workspace-write", "root-policy");
    await write(paths.control, "sleep\n");
    const creating = command({ type: "worktree.create", taskId: existing.id, mode: "existing", path: paths.rootExisting, branchName: "native-g3-" + nonce + "-root" });
    const completed = creating.catch(() => void 0);
    await wait(async () => !await expectMissing(paths.sleepMarker), Boolean);
    if ((await task(existing.id))?.operation?.phase !== "git") throw new Error();
    await policy([existing.sessions[1]], "read-only", "partial-injection");
    if (options.allowModelRequests) {
      stage = "boundary-prompt";
      guard = await boundaryGuard(host, options, [...existing.sessions, C], paths.root);
      budget.reserve(true);
      await native({ kind: "prompt", id: existing.sessions[0], requestId: randomUUID() });
      const summary = await wait(() => summaries([existing.sessions[0]]), (value) => value[existing.sessions[0]].idle && value[existing.sessions[0]].turnEnds > 0);
      const state = summary[existing.sessions[0]];
      if (state.lastReason !== "blocked" || state.assistants || state.tools) throw new Error();
      checks.optionalPreStepBoundary = true;
    } else remaining.push("pre-step-boundary-not-exercised");
    stage = "partial-retry";
    const partial = await creating;
    await completed;
    if (partial?.ok !== false || await expectMissing(paths.rootExisting) || (await task(existing.id))?.operation?.phase !== "failed") throw new Error();
    await expectCwd(existing, paths.root);
    await policy([existing.sessions[1]], "workspace-write", "partial-retry");
    await write(paths.control, "none\n");
    await must({ type: "operation.retry", taskId: existing.id });
    await expectCwd(existing, paths.rootExisting);
    checks.partialGitRetry = true;
    checks.existingBranch = true;
    stage = "partial-return";
    await must({ type: "operation.return", taskId: existing.id });
    await expectCwd(existing, paths.root);
    if (await expectMissing(paths.rootExisting)) throw new Error();
    checks.returnPreservesTree = true;
    await must({ type: "worktree.attach", taskId: existing.id, path: paths.rootExisting });
    await removeTask(existing, false);
    stage = "attach";
    await ownGit(paths.root, ["worktree", "add", "-b", "native-g3-" + nonce + "-external", paths.external, "main"]);
    const external = await createTask("external attach task", rootProject, paths.root);
    await policy(external.sessions, "workspace-write", "root-policy");
    await must({ type: "worktree.attach", taskId: external.id, path: paths.external });
    await expectCwd(external, paths.external);
    checks.attachExisting = true;
    await removeTask(external, false);
    stage = "monorepo";
    const mono = await createTask("monorepo task", monoProject, paths.monoProject);
    await policy(mono.sessions, "workspace-write", "monorepo-policy");
    const monoDenied = await command({ type: "worktree.create", taskId: mono.id, mode: "new", path: paths.monoTree, branchName: "native-g3-" + nonce + "-mono", sourceBranch: "main" });
    if (!denied(monoDenied) || !await expectMissing(paths.monoTree)) throw new Error();
    await must({ type: "operation.return", taskId: mono.id });
    await policy(mono.sessions, "danger-full-access", "monorepo-explicit-full");
    await must({ type: "worktree.create", taskId: mono.id, mode: "new", path: paths.monoTree, branchName: "native-g3-" + nonce + "-mono", sourceBranch: "main" });
    await expectCwd(mono, join(paths.monoTree, "apps/api"));
    checks.monorepoCwd = true;
    stage = 'partial-return';
    const heldBase=paths.monoProject+'.held-'+nonce;
    await canonicalOwned(paths,paths.monoProject);await canonicalOwned(paths,heldBase);
    if(!await expectMissing(heldBase)||await realpath(paths.monoProject)!==paths.monoProject)throw new Error();
    await moveOwnedBase(options,paths,{from:paths.monoProject,to:heldBase});pendingMove={from:heldBase,to:paths.monoProject};
    const failedReturn=await command({type:'worktree.remove',taskId:mono.id,confirmed:true,expectedWorktreePath:paths.monoTree,discardChanges:false});
    if(failedReturn?.ok!==false||await expectMissing(paths.monoTree)||(await task(mono.id))?.operation?.phase!=='failed')throw new Error();
    await expectCwd(mono,join(paths.monoTree,'apps/api'));checks.returnFailurePreservesTree=true;
    await canonicalOwned(paths,heldBase);await canonicalOwned(paths,paths.monoProject);
    await moveOwnedBase(options,paths,{from:heldBase,to:paths.monoProject});pendingMove=undefined;
    await must({type:'operation.retry',taskId:mono.id});await expectCwd(mono,paths.monoProject);
    if(!await expectMissing(paths.monoTree))throw new Error();
    stage = 'monorepo';
    await removeTask(mono, false);
    await ownGit(paths.mono, ["show-ref", "--verify", "refs/heads/native-g3-" + nonce + "-mono"]);
    stage = "archive-resume";
    for (const id of ownedSessions.keys()) {
      const value = (await summaries([id]))[id];
      if (!value.prefixMatches) throw new Error();
      if (!options.allowModelRequests && (value.users || value.assistants || value.turnStarts || value.tools)) throw new Error();
    }
  } catch(error) {
    diagnostics.push(operationDiagnostic(error,stage,"assertion"));
    checks.failedAt = STAGES.has(stage) ? stage : "arguments";
  } finally {
    launchUrl = void 0;
    cleaning = true;
    cleanup.attempted = !!paths;
    if (pendingMove) {
      try {
        await moveOwnedBase(options,paths,pendingMove);
        pendingMove = void 0;
      } catch {
        cleanup.baseRestored=false;
        remaining.push("owned-base-restore-required");
        cleanup.errors.push("fixture-cleanup-blocked");
      }
    }
    // A missing immutable origin is never permission to delete/retire its native histories.
    if (!pendingMove && paths && host && page && isCleanRoot(page.url())) {
      let foreignReady=false;
      try{await returnForeignFixturesBeforeRemoval(options,paths,ownedTasks.values(),ownedSessions,{summary:async id=>(await summaries([id]))[id],validateOrigin:async origin=>{await canonicalOwned(paths,origin);if(await realpath(origin)!==origin||!(await stat(origin)).isDirectory())throw new Error();},unarchive:id=>native({kind:"unarchive",id}),directory:(id,directory)=>native({kind:"directory",id,directory})});foreignReady=true;}
      catch(error){cleanup.errors.push("fixture-cleanup-blocked");diagnostics.push(operationDiagnostic(error,"cleanup","native-effect"));}
      for (const [id, info] of foreignReady?ownedTasks:[]) {
        try {
          let current = await task(id);
          if (!current) continue;
          await wait(() => summaries(current.sessionIds), (value) => Object.values(value).every((item) => item.idle));
          await policy(current.sessionIds, info.origin===paths.monoProject?"danger-full-access":"workspace-write", "cleanup");
          current = await task(id);
          if (current.operation) {
            const result2 = await command({ type: current.operation.request.kind === "delete" ? "operation.retry" : "operation.return", taskId: id });
            if (result2?.ok !== true) throw new Error();
          }
          current = await task(id);
          if (current) {
            if (current.worktree && !targets().has(current.worktree.path)) throw new Error();
            const result2 = await command({ type: "task.delete", taskId: id, confirmed: true, expectedWorktreePath: current.worktree?.path ?? null, discardChanges: true });
            if (result2?.ok !== true) throw new Error();
          }
          if (await task(id)) throw new Error();
          if (!cleanup.deletedTasks.includes(id)) cleanup.deletedTasks.push(id);
        } catch {
          cleanup.errors.push("fixture-cleanup-blocked");
        }
      }
      for (const id of ownedSessions.keys()) {
        try {
          let value = (await summaries([id]))[id];
          if (!value.idle) {
            if(options.allowModelRequests!==true||budget.snapshot()!==1)throw new Error();
            await native({ kind: "cancel", id });
            await wait(() => summaries([id]), (current) => current[id].idle);
            value = (await summaries([id]))[id];
          }
          if (!value.idle) throw new Error();
          if (value.archived) await native({ kind: "unarchive", id });
          const origin=ownedSessions.get(id);
          await canonicalOwned(paths,origin);
          if(await realpath(origin)!==origin||!(await stat(origin)).isDirectory())throw new Error();
          await native({ kind: "directory", id, directory: origin });
          await policy([id], "read-only", "cleanup-restrict");
          await native({ kind: "archive", id });
          cleanup.archived.push(id);
        } catch {
          cleanup.errors.push("native-archive-failed");
        }
      }
      try {
        const after = await native({ kind: "preflight" });
        checks.globalDefaultsUnchanged = after.defaultPreset === defaults.defaultPreset;
      } catch {
        cleanup.errors.push("fixture-policy-restore-failed");
      }
    }
    try {
      if (guard) {
        const state = await guard.snapshot();
        if (Object.values(state.blockedCounts ?? {}).some((value) => value > 0)) checks.optionalPreStepBoundary = false;
        await guard.dispose();
      }
    } catch {
      cleanup.errors.push("fixture-cleanup-blocked");
    }
    for (const resource of [page, context, browser, host]) try {
      await close(resource);
    } catch {
      cleanup.errors.push("resource-close-failed");
    }
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
  const required = ["freshDistinctNoTurns", "sameNativeIds", "nativeHistoryPreserved", "readOnlyDenied", "outsideRootDenied", "newBranch", "existingBranch", "attachExisting", "monorepoCwd", "osConfinement", "sharedTargetProtected", "dirtyDecline", "dirtyDiscard", "branchPreserved", "noTreeBasePreserved", "notesDeleted", "allRetainedBaseBeforeRemoval", "nativeArchived", "nativeUnarchiveBase", "partialGitRetry", "returnPreservesTree", "returnFailurePreservesTree", "globalDefaultsUnchanged"];
  const result = safeReport({ ok: !checks.failedAt && cleanup.errors.length === 0 && required.every((key) => checks[key] === true), stage: checks.failedAt ?? (cleanup.errors.length ? "cleanup" : "artifact"), runId: nonce, fixture: paths ? { run: paths.run, report: paths.report, retained: true, projectsRetained: true } : void 0, ids: { projects: projectIds, tasks: [...ownedTasks.keys()], sessions: [...ownedSessions.keys()] }, checks, remaining, diagnostics, policies, modelRequests: budget.snapshot(), cleanup });
  if (paths) {
    try {
      await canonicalOwned(paths, paths.report);
      await writeFile(paths.report, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 384 });
    } catch {
      result.ok = false;
      result.stage = "artifact";
    }
  }
  return result;
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { help: HELP };
  return runVerification(options);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    process.stdout.write((result.help ?? JSON.stringify(result, null, 2)) + "\n", () => process.exit(result.help || result.ok ? 0 : 1));
  } catch (error) {
    const stage = error instanceof NativeWorktreeFailure ? error.stage : "arguments";
    process.stderr.write("Native G3/G5 verification refused/failed at stage: " + stage + "\n", () => process.exit(1));
  }
}
export {
  HELP,
  NativeWorktreeFailure,
  assertAuthorizations,
  assertOwnedIds,
  assertOwnedPath,
  assertQuietEnvironment,
  fixtureHook,
  fixturePaths,
  main,
  modelBudget,
  nativeAction,
  parseArgs,
  prepareFixture,
  runVerification,
  safeReport,
  boardSnapshot,
  rpc,
  unwrapRpcEnvelope,
  unwrapBusinessOutcome,
  creationId,
  sessionCreationId,
  isEntityId,
  isNativeSessionId,
  operationDiagnostic,
  returnForeignFixturesBeforeRemoval,
  moveOwnedBase,
  acquire,
  until
};
