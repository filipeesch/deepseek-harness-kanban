import type { CommandResult } from '../../shared/ports.js';
import { runHostCommand } from '../host-command.js';

/** One plugin-owned command invocation; injectable so tests avoid subprocesses. */
export type SharingCommandRunner = (argv: string[], cwd: string, timeoutMs?: number) => Promise<CommandResult>;

export const defaultSharingCommandRunner: SharingCommandRunner = (argv, cwd, timeoutMs) => runHostCommand(argv, cwd, timeoutMs);
