import { spawn } from 'node:child_process';
import { classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature, type ConfinedArgv } from '@deepseek-ai/dsh-sandbox';
import { KanbanError } from '../shared/errors.js';
import type { CommandResult } from '../shared/ports.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 500;
const HOST_COMMAND_TIMEOUT_MS = 15_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Spawn one exact argv with bounded output and lifetime; confinement wrapping is optional. */
export function executeCommand(argv: string[], cwd: string, wrapped: ConfinedArgv | undefined, signal: AbortSignal, timeout: AbortSignal): Promise<CommandResult> {
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

/** Run one plugin-owned, read-only host command without session confinement. */
export function runHostCommand(argv: string[], cwd: string, timeoutMs = HOST_COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  return executeCommand(argv, cwd, undefined, timeout, timeout);
}
