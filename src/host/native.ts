import type { Context } from '@deepseek-ai/cordis';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-workspace';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import {
  writableRoots, classifyRunnerFailure, matchesSignature, isRunnerSpawnFailure,
  type SandboxExecutionPolicy, type ConfinedArgv,
} from '@deepseek-ai/dsh-sandbox';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { GitExecutor, SessionPort, CommandResult } from '../shared/ports.js';
import type { Attention } from '../shared/types.js';
import { KanbanError, invariant } from '../shared/errors.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const EXECUTION_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 500;
type Inspection = Awaited<ReturnType<Context['sessionController']['inspect']>>;
type Projection = Awaited<ReturnType<Context['sessionController']['projections']>>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
}
function absolute(path: string): void {
  invariant(isAbsolute(path) && !path.includes('\0'), 'INVALID_PATH', 'An absolute execution-world path is required.');
}
/** Resolve existing ancestors too: a not-yet-created worktree must not escape through a symlink. */
async function canonicalTarget(path: string): Promise<string> {
  absolute(path);
  try { return await realpath(path); }
  catch (error) {
    if (!record(error) || error.code !== 'ENOENT') throw error;
    const entry = await lstat(path).catch((failure: unknown) => {
      if (record(failure) && failure.code === 'ENOENT') return undefined;
      throw failure;
    });
    invariant(!entry?.isSymbolicLink(), 'INVALID_PATH', 'A dangling symlink is not a safe operation target.');
    const parent = dirname(path);
    invariant(parent !== path, 'INVALID_PATH', 'The operation path has no accessible filesystem root.');
    return join(await canonicalTarget(parent), basename(path));
  }
}
async function directoryPath(path: string): Promise<string> {
  absolute(path);
  const result = await realpath(path);
  invariant((await stat(result)).isDirectory(), 'INVALID_DIRECTORY', 'The selected path is not an existing directory.');
  return result;
}
function inspectedDirectory(inspection: Inspection): string | undefined {
  let current = inspection.meta.cwd;
  for (const event of inspection.events) {
    if (event.type === 'working-directory/change') current = event.data.cwd;
  }
  return current;
}
function nativePending(projection: Projection, inspection: Inspection): boolean {
  // Native timed questions publish this browser-safe projection, including continued questions.
  const questions: unknown = projection?.values['userQuestions'];
  if (record(questions) && Array.isArray(questions.active) && questions.active.length > 0) return true;
  const approvals = new Set<string>();
  for (const event of inspection.events) {
    const type: string = event.type;
    const data: unknown = event.data;
    if (type === 'turn/end') approvals.clear();
    if (!record(data) || typeof data.id !== 'string') continue;
    if (type === 'approval/asked') approvals.add(data.id);
    if (type === 'approval/decided') approvals.delete(data.id);
  }
  return approvals.size > 0;
}
function inspectedOpenTurn(inspection: Inspection): boolean {
  let open = false;
  for (const event of inspection.events) {
    if (event.type === 'turn/start') open = true;
    if (event.type === 'turn/end') open = false;
  }
  return open;
}
function lastOutcomeFailed(inspection: Inspection): boolean {
  let failed = false;
  for (const event of inspection.events) {
    if (event.type === 'turn/end') failed = event.data.reason.kind === 'error';
  }
  return failed;
}
function validatePolicy(policy: SandboxExecutionPolicy): SandboxExecutionPolicy {
  invariant(['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode),
    'SANDBOX_POLICY_UNAVAILABLE', 'The native sandbox returned an unsupported policy.');
  absolute(policy.workspaceRoot);
  return policy;
}
/** Select a REAL policy which is no broader than any participant; never manufacture a shared root. */
function commonPolicy(policies: SandboxExecutionPolicy[]): SandboxExecutionPolicy {
  const confined = policies.filter((policy) => policy.mode !== 'danger-full-access');
  if (confined.length === 0) return policies[0]!;
  const readOnly = confined.find((policy) => policy.mode === 'read-only');
  if (readOnly) return readOnly;
  const selected = confined.find((candidate) => writableRoots(candidate).every((root) =>
    confined.every((other) => writableRoots(other).some((grant) => inside(grant, root)))));
  invariant(selected, 'SANDBOX_POLICY_CONFLICT',
    'These conversations have incompatible sandbox roots; no existing policy safely confines a shared Git operation.');
  return selected;
}

/** Native adapters own no session history, permission grants, or replacement runtime. */
export function createNativePorts(ctx: Context): { sessions: SessionPort; executor: GitExecutor } {
  const inspect = (id: string, signal = AbortSignal.timeout(READ_TIMEOUT_MS)) =>
    ctx.sessionController.inspect(SessionId(id), signal);
  const projections = (id: string, signal = AbortSignal.timeout(READ_TIMEOUT_MS)) =>
    ctx.sessionController.projections({ sessionId: SessionId(id) }, signal);
  const activity = (id: string) => ctx.waterfall('workspace/session-activity',
    { sessionId: SessionId(id) }, () => Promise.resolve([]));
  const resolveAgent = async (id: string) => {
    const resolved = await ctx.sessionController.resolveAgent(SessionId(id));
    if ('error' in resolved) throw resolved.error;
    return resolved.agent;
  };
  const policiesFor = async (ids: string[], signal?: AbortSignal): Promise<SandboxExecutionPolicy[]> => {
    const policyService = ctx.get('sandboxPolicy');
    invariant(policyService, 'SANDBOX_POLICY_UNAVAILABLE', 'The native sandbox policy service is unavailable.');
    if (ids.length === 0) return [validatePolicy(policyService.resolve())];
    const policies: SandboxExecutionPolicy[] = [];
    for (const id of new Set(ids)) {
      signal?.throwIfAborted();
      let session = ctx.sessions.get(SessionId(id));
      if (!session) {
        // A detached native Session is a policy snapshot only: never attached, resumed, or driven.
        const snapshot = await inspect(id, signal);
        session = Session.create(SessionId(id), snapshot.events, snapshot.meta, snapshot.inheritedEventCount);
      }
      policies.push(validatePolicy(policyService.resolve({ session })));
    }
    return policies;
  };
  const checkPaths = async (paths: string[], policies: SandboxExecutionPolicy[], write: boolean) => {
    const canonical = await Promise.all(paths.map(canonicalTarget));
    if (!write) return;
    for (const policy of policies) {
      if (policy.mode === 'danger-full-access') continue;
      const roots = writableRoots(policy);
      invariant(policy.mode !== 'read-only' && canonical.every((path) => roots.some((root) => inside(root, path))),
        'SANDBOX_DENIED', 'The native file policy does not permit every required Git/worktree path.',
      );
    }
  };
  const admissions = new Map<string, { text: string; done: Promise<void> }>();
  const sessions: SessionPort = {
    async create(projectPath) {
      const cwd = await directoryPath(projectPath);
      // Omitting sessionId is essential: explicit IDs can reuse blank conversations.
      const created = await ctx.sessionController.create({ cwd });
      return created.sessionId;
    },
    async directory(id) {
      const live = ctx.sessions.get(SessionId(id));
      if (live) return ctx.workingDirectory.get(live);
      const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
      let projection: Awaited<ReturnType<Context['sessionController']['projections']>> | undefined;
      try { projection = await projections(id, signal); }
      catch (error) {
        if (signal.aborted || typeof error === 'object' && error !== null && 'code' in error && error.code === 'gateway/cancelled') throw error;
        // Aggregate projections are optional here; only exact canonical history may replace them.
      }
      if (projection?.kind === 'sequenced' && typeof projection.values.workingDirectory === 'string') {
        absolute(projection.values.workingDirectory);
        return projection.values.workingDirectory;
      }
      // Header-only list cwd and migration cache hints may be stale. Read the exact native observation.
      const cwd = inspectedDirectory(await inspect(id, signal));
      invariant(cwd, 'SESSION_CONTEXT_UNAVAILABLE', 'This conversation has no recorded effective project directory.');
      absolute(cwd);
      return cwd;
    },
    async validateDirectory(id, expected) {
      const existing = async (path: string): Promise<string> => {
        try { return await directoryPath(path); }
        catch (error) {
          if (error instanceof KanbanError) throw error;
          throw new KanbanError('SESSION_CONTEXT_UNAVAILABLE', 'The task execution directory is missing or cannot be inspected. Restore its context before running.');
        }
      };
      const target = await existing(expected);
      invariant(target === expected, 'CONTEXT_MISMATCH', 'The expected task execution directory must be canonical.');
      // Read committed state only. Native ensure() may recover to the immutable original cwd; that is not execution admission.
      const observed = await sessions.directory(id);
      invariant(await existing(observed) === target, 'CONTEXT_MISMATCH', 'The native conversation is not in the expected task execution directory.');
      // Detect a native recovery/commit while canonical filesystem checks were awaiting I/O. This is not an atomic filesystem lease.
      invariant(await sessions.directory(id) === observed, 'CONTEXT_CHANGED', 'The native conversation directory changed while execution was being validated.');
      invariant(await existing(expected) === target, 'CONTEXT_CHANGED', 'The expected execution directory changed while it was being validated.');
    },
    async setDirectory(id, path, signal) {
      signal?.throwIfAborted();
      const target = await directoryPath(path);
      invariant(await sessions.isIdle(id), 'SESSION_ACTIVE', 'Wait for the conversation and all owned activity before changing directories.');
      const agent = await resolveAgent(id);
      signal?.throwIfAborted();
      invariant(await sessions.isIdle(id), 'SESSION_ACTIVE', 'Conversation activity resumed before its directory could change.');
      await ctx.workingDirectory.set(agent, target, signal);
      invariant(ctx.workingDirectory.get(agent.session) === target, 'DIRECTORY_SWITCH_FAILED', 'The native conversation did not commit the requested directory.');
    },
    async isIdle(id) {
      const owned = await activity(id);
      if (owned.length > 0) return false; // Includes native turns, jobs, descendants, and schedules.
      const agent = ctx.agents.get(SessionId(id));
      // nextStep can contain non-waking native cwd/context notices; those are not active work.
      if (agent && (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0)) return false;
      const projection = await projections(id);
      if (projection?.kind !== 'sequenced') throw new KanbanError('SESSION_STATE_UNAVAILABLE', 'Exact native activity projections are unavailable.');
      const boundary: unknown = projection.values['turnBoundary'];
      if (record(boundary) && boundary.openTurnStartSeq != null) return false;
      const inbox: unknown = projection.values.inbox;
      if (record(inbox) && Array.isArray(inbox['next-turn']) && inbox['next-turn'].length > 0) return false;
      const snapshot = await inspect(id);
      return !inspectedOpenTurn(snapshot) && !nativePending(projection, snapshot);
    },
    async send(id, text, requestId = randomUUID()) {
      invariant(text.trim(), 'EMPTY_PROMPT', 'A task execution requires a non-empty instruction.');
      invariant(requestId.trim() && !requestId.includes('\0'), 'INVALID_REQUEST_ID', 'A stable non-empty native prompt identity is required.');
      const key = JSON.stringify([id, requestId]);
      const active = admissions.get(key);
      if (active) {
        invariant(active.text === text, 'PROMPT_ID_CONFLICT', 'The same prompt identity cannot describe two different instructions.');
        return active.done;
      }
      // Native prompt admission dedupes rpcId in both Inbox lists and durable user/message events.
      // Join in-flight calls too: the SDK checks identity before asynchronous attachment admission.
      const done = (async () => {
        await ctx.sessionController.prompt({
          sessionId: SessionId(id), requestId: requestId as SessionRequestId,
          mode: 'queue', content: [{ type: 'text', text }],
        }, AbortSignal.timeout(READ_TIMEOUT_MS));
      })();
      admissions.set(key, { text, done });
      try { await done; }
      finally { if (admissions.get(key)?.done === done) admissions.delete(key); }
    },
    async archive(id) {
      invariant(await sessions.isIdle(id), 'SESSION_ACTIVE', 'Active conversations cannot be archived by task cleanup.');
      // Native archive checks its waterfall again; no stopActivity and no log deletion.
      await ctx.workspaceRegistry.archiveSession(SessionId(id));
    },
    async attention(id): Promise<Attention> {
      const [owned, projection, snapshot] = await Promise.all([activity(id), projections(id), inspect(id)]);
      const live = ctx.agents.get(SessionId(id));
      return {
        running: live?.status === 'running' || owned.length > 0,
        // Unread is client-owned UiSession.sessionStatus.completionUnread; the client merges it.
        unread: false,
        awaitingReply: nativePending(projection, snapshot),
        failed: lastOutcomeFailed(snapshot),
      };
    },
    async directories() {
      const listed = await ctx.sessionController.list({}, AbortSignal.timeout(READ_TIMEOUT_MS));
      const ids = new Set([...listed.items.map((item) => item.sessionId), ...ctx.sessions.list().map((session) => session.id)]);
      const result: Array<{ sessionId: string; directory: string }> = [];
      for (const id of ids) result.push({ sessionId: id, directory: await sessions.directory(id) });
      return result; // An unreadable peer is not silently dropped from shared-tree protection.
    },
  };
  const executor: GitExecutor = {
    async assertPolicy(_project, paths, ids, write) {
      await checkPaths(paths, await policiesFor(ids), write);
    },
    async run(project, args, ids, signal) {
      signal?.throwIfAborted();
      invariant(args.every((arg) => typeof arg === 'string' && !arg.includes('\0')), 'INVALID_GIT_ARGUMENT', 'Git arguments must be exact strings without NUL bytes.');
      const timeout = AbortSignal.timeout(EXECUTION_TIMEOUT_MS);
      const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const cwd = await directoryPath(project.gitRootPath);
      const policy = commonPolicy(await policiesFor(ids, lifetime));
      let wrapped: ConfinedArgv | undefined;
      let argv = ['git', ...args];
      if (policy.mode !== 'danger-full-access') {
        const sandbox = ctx.get('sandbox');
        invariant(sandbox, 'SANDBOX_UNAVAILABLE', 'A native confinement backend is required for this Git operation.');
        wrapped = await sandbox.confine(argv, { ...policy, mode: policy.mode }, lifetime);
        invariant(wrapped.enforcement === 'full', 'SANDBOX_INCOMPLETE', 'The native backend cannot fully enforce this Git operation.');
        invariant(wrapped.argv.length > 0 && wrapped.argv.every((part) => typeof part === 'string' && !part.includes('\0')),
          'SANDBOX_UNAVAILABLE', 'The native confinement backend returned invalid runner arguments.');
        argv = wrapped.argv;
      }
      lifetime.throwIfAborted();
      return execute(argv, cwd, wrapped, lifetime, timeout);
    },
  };
  return { sessions, executor };
}

/** Spawn only the exact argv returned by native confinement, with bounded output and lifetime. */
function execute(argv: string[], cwd: string, wrapped: ConfinedArgv | undefined, signal: AbortSignal, timeout: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let stopped: KanbanError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if (!record(error) || error.code !== 'ESRCH') child.kill(kind);
      }
    };
    const stop = (error: KanbanError) => {
      if (stopped) return;
      stopped = error;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };
    const abort = () => stop(new KanbanError(timeout.aborted ? 'GIT_TIMEOUT' : 'OPERATION_CANCELLED',
      timeout.aborted ? 'The Git operation exceeded its execution deadline.' : 'The Git operation was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const collect = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) { stop(new KanbanError('GIT_OUTPUT_LIMIT', 'The Git operation exceeded its output limit.')); return; }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    let spawnError: Error | undefined;
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (exitCode, terminatedBy) => {
      signal.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      if (stopped) {
        // The runner may close before a descendant which ignored SIGTERM exits.
        if (process.platform !== 'win32' && child.pid !== undefined) kill('SIGKILL');
        reject(stopped); return;
      }
      if (spawnError) {
        const runner = wrapped && isRunnerSpawnFailure(spawnError, argv[0], cwd);
        reject(new KanbanError(runner ? 'SANDBOX_UNAVAILABLE' : 'GIT_SPAWN_FAILED', spawnError.message));
        return;
      }
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (wrapped && classifyRunnerFailure(exitCode, err, wrapped.runnerFailureRules)) {
        reject(new KanbanError('SANDBOX_UNAVAILABLE', 'The native sandbox runner failed before Git executed.', { exitCode, stderr: err }));
      } else if (wrapped && matchesSignature(exitCode, err, wrapped.denialSignatures)) {
        reject(new KanbanError('SANDBOX_DENIED', 'The native sandbox denied a Git file operation.', { exitCode, stderr: err }));
      } else if (exitCode === null) {
        reject(new KanbanError('GIT_TERMINATED', 'Git terminated without an exit status.', { signal: terminatedBy }));
      } else resolve({ exitCode, stdout: out, stderr: err });
    });
  });
}
