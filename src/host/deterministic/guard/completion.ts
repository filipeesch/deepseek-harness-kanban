import type { GuardMode } from './config.js';

/** What one Bash call produced, in the shape the host decodes. */
export interface GuardResult {
  stdout: string;
  stderr: string;
  overflow: boolean;
}

/** What the completion flow needs from the running guard. */
export interface CompletionHost {
  mode: GuardMode;
  quiesce(): Promise<void>;
  connected(): boolean;
  /** Whether the guard may report a captured result; false when the command never ran. */
  emitResult(): boolean;
  result(): GuardResult;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  sendDone(): Promise<void>;
  exit(code: number): void;
}

const UNCLEAN_EXIT_MS = 10000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finish one execution exactly once: prove cleanup, then report.
 *
 * An unproven tree must not report a result, so the guard stays reachable for reclaim
 * to answer that cleanup failed, and leaves without claiming quiescence.
 */
export function createCompletion(host: CompletionHost): (code: number) => Promise<void> {
  let completion: Promise<void> | undefined;
  return code => {
    completion ??= (async () => {
      try { await host.quiesce(); }
      catch (error) {
        host.writeStderr('NATIVE_LIFETIME_UNCLEAN: ' + reason(error) + '\n');
        setTimeout(() => host.exit(125), UNCLEAN_EXIT_MS);
        return;
      }
      if (!host.connected()) return;
      if (host.mode === 'bash' && host.emitResult()) host.writeStdout(JSON.stringify(host.result()) + '\n');
      await host.sendDone();
      host.exit(code);
    })();
    return completion;
  };
}
