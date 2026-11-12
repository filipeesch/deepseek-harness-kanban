import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox';
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import type { DeterministicPolicyPort } from './ports.js';
import { failure } from './ports.js';
import { SOURCE_MAX_BYTES } from './safety.js';

export function optionalService<T>(context: unknown, name: string): T | undefined {
  try { return (context as Record<string, T> | undefined)?.[name]; } catch { return undefined; }
}
/** Agentless policy uses the standing mode, never trust as permission escalation. */
export function createNativeDeterministicPolicy(context: unknown): DeterministicPolicyPort {
  const filesystem = () => optionalService<FileSystem>(context, 'fs') ?? failure('FILESYSTEM_UNAVAILABLE', 'Mount the native filesystem capability to resolve deterministic source and directory identity.');
  return {
    async directory(path, signal) {
      signal?.throwIfAborted();
      if (!path || path.includes('\0')) failure('DIRECTORY_INVALID', 'The selected execution directory is unavailable.');
      const fs = filesystem();
      const target = await fs.resolve(path, { signal });
      if ((await fs.stat(target, signal))?.type !== 'directory') failure('DIRECTORY_INVALID', 'Restore the selected task or project directory before execution.');
      return fs.processPath(target);
    },
    async source(path, directory, signal) {
      signal?.throwIfAborted();
      const fs = filesystem();
      const target = await fs.resolve(path, { cwd: directory, signal });
      const info = await fs.stat(target, signal);
      if (info?.type !== 'file' || info.size !== undefined && info.size > SOURCE_MAX_BYTES) failure('SOURCE_INVALID', 'The primary source must be a regular UTF-8 file of at most 128 KiB.');
      const code = await fs.readText(target, signal);
      if (Buffer.byteLength(code) > SOURCE_MAX_BYTES) failure('SOURCE_INVALID', 'The primary source exceeds 128 KiB.');
      return { path: fs.processPath(target), code };
    },
    async execution(directory, signal) {
      signal?.throwIfAborted();
      const service = optionalService<Pick<SandboxPolicyService, 'resolve'>>(context, 'sandboxPolicy');
      if (!service) failure('POLICY_UNAVAILABLE', 'Mount the native sandbox policy capability; deterministic execution cannot infer permission from local trust.');
      const standing = service.resolve();
      const policy: SandboxExecutionPolicy = { mode: standing.mode, workspaceRoot: directory, ...(standing.additionalWritableRoots ? { additionalWritableRoots: [...standing.additionalWritableRoots] } : {}) };
      if (policy.mode !== 'danger-full-access') {
        const sandbox = optionalService<Pick<SandboxProvider, 'confine'>>(context, 'sandbox');
        if (!sandbox) failure('POLICY_UNAVAILABLE', 'Mount a native process sandbox capable of the selected file policy.');
        const probe = await sandbox.confine(['bash', '-c', ':'], { ...policy, mode: policy.mode }, signal);
        if (probe.enforcement !== 'full') failure('POLICY_INCOMPLETE', 'The native sandbox reports partial enforcement; select a fully enforcing backend before running this script.');
      }
      return policy;
    },
  };
}
