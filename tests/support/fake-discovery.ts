import type { DiscoveryFs, DirectoryEntry } from '../../src/host/sharing/google-drive-local/filesystem.js';
import type { SharingCommandRunner } from '../../src/host/sharing/command-runner.js';
import type { CommandResult } from '../../src/shared/ports.js';

function separatorOf(value: string): string { return value.includes('\\') ? '\\' : '/'; }

function parentOf(value: string): string {
  const separator = separatorOf(value);
  const index = value.lastIndexOf(separator);
  if (index < 0) return separator;
  return index === 0 ? separator : value.slice(0, index);
}

function baseOf(value: string): string {
  return value.slice(value.lastIndexOf(separatorOf(value)) + 1);
}

function childOf(target: string, name: string): string {
  const separator = separatorOf(target);
  return target.endsWith(separator) ? target + name : target + separator + name;
}

/** An in-memory filesystem with explicit symbolic-link targets. */
export class FakeDiscoveryFs implements DiscoveryFs {
  readonly directories = new Set<string>();
  readonly files = new Set<string>();
  readonly links = new Map<string, string>();
  readonly calls: string[] = [];
  readonly listLimits: Array<number | undefined> = [];

  constructor(directories: string[] = []) {
    for (const directory of directories) this.directories.add(directory);
  }

  directory(value: string): this { this.directories.add(value); return this; }
  file(value: string): this { this.files.add(value); return this; }
  link(value: string, target: string): this { this.links.set(value, target); return this; }

  async exists(value: string): Promise<boolean> {
    this.calls.push('exists:' + value);
    const target = this.links.get(value) ?? value;
    return this.directories.has(target) || this.files.has(target);
  }

  async isDirectory(value: string): Promise<boolean> {
    this.calls.push('isDirectory:' + value);
    const target = this.links.get(value) ?? value;
    return this.directories.has(target);
  }

  async list(value: string, limit?: number): Promise<{ entries: DirectoryEntry[]; truncated: boolean }> {
    this.calls.push('list:' + value);
    this.listLimits.push(limit);
    const target = this.links.get(value) ?? value;
    if (!this.directories.has(target)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    if (this.denied.has(target)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    const names = new Set<string>();
    const base = target.length > 1 && /[\\/]$/.test(target) ? target.slice(0, -1) : target;
    for (const directory of this.directories) if (parentOf(directory) === base) names.add(baseOf(directory));
    for (const file of this.files) if (parentOf(file) === base) names.add(baseOf(file));
    for (const link of this.links.keys()) if (parentOf(link) === base) names.add(baseOf(link));
    const all = [...names];
    const truncated = limit !== undefined && all.length > limit;
    const selected = limit === undefined ? all : all.slice(0, limit);
    return {
      truncated,
      entries: selected.map(name => {
        const child = childOf(target, name);
        return { name, directory: this.directories.has(this.links.get(child) ?? child) };
      }),
    };
  }

  async realpath(value: string): Promise<string> {
    this.calls.push('realpath:' + value);
    return this.links.get(value) ?? value;
  }

  /** Directories whose listing is refused with EACCES. */
  readonly denied = new Set<string>();
}

export interface FakeRunner {
  runner: SharingCommandRunner;
  calls: string[][];
}

/** A command runner keyed by the exact joined argv, recording every call. */
export function fakeRunner(outputs: Record<string, Partial<CommandResult>>): FakeRunner {
  const calls: string[][] = [];
  const runner: SharingCommandRunner = async argv => {
    calls.push(argv);
    const value = outputs[argv.join(' ')] ?? { exitCode: 1, stdout: '', stderr: 'not configured' };
    return { exitCode: value.exitCode ?? 0, stdout: value.stdout ?? '', stderr: value.stderr ?? '' };
  };
  return { runner, calls };
}
