export const REQUIRED_ENTRY_POINTS: readonly string[];
export function bundleSelected(profile: unknown): boolean;
export function hasComposedKanban(dump: string): boolean;
export function parseAllowBuildsKey(output: string): string | undefined;
export function withAllowBuilds(text: string, key: string): string;
export function missingEntryPoints(present: Iterable<string>): string[];
export function hasHostPackageCopies(names: Iterable<string>): boolean;

export interface VerifyIo {
  copyFile(from: string, to: string): Promise<unknown>;
  mkdir(target: string, options?: { recursive?: boolean }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(target: string, encoding: 'utf8'): Promise<string>;
  readdir(target: string): Promise<string[]>;
  rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<unknown>;
  stat(target: string): Promise<unknown>;
  writeFile(target: string, data: string): Promise<unknown>;
}

export interface VerifyRunResult {
  code: number;
  stdout: string;
  stderr: string;
  failure?: string;
}

export interface VerifyInstallOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; cwd?: string }) => Promise<VerifyRunResult>;
  io?: VerifyIo;
  dsh?: string;
  profile?: string;
  temporaryRoot?: string;
  keep?: boolean;
}

export function verifyInstall(options?: VerifyInstallOptions): Promise<{
  spec: string;
  profile: string;
  packageRoot: string;
  entries: readonly string[];
  home?: string;
}>;
