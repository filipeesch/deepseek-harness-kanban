import { lstat, readdir } from 'node:fs/promises';
import type { GitRepository } from '../shared/ports.js';
import type { CheckoutDirectoryState, CheckoutObservation, CheckoutRegistrationState } from '../shared/types.js';

/** One read of the destination: the two facts recovery is decided from. */
export type CheckoutState = CheckoutObservation;

/**
 * Reads what a failed creation left, as facts instead of an exception. A directory
 * that no registration claims is a state the recovery can name and act on, never a
 * Git identity error.
 */
export class CheckoutStateProbe {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async probe(repository: GitRepository, target: string, parentCandidates: string[] = []): Promise<CheckoutState> {
    return {
      directory: await directoryState(target),
      registration: await registrationState(repository, target),
      at: this.now(),
      parentCandidates: [...parentCandidates],
    };
  }
}

async function directoryState(value: string): Promise<CheckoutDirectoryState> {
  try {
    const info = await lstat(value);
    if (!info.isDirectory()) return 'present';
    return (await readdir(value)).length === 0 ? 'empty' : 'present';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

/**
 * Whether an existing entry must refuse a creation. Git accepts an empty directory,
 * so only a file, a symlink, or a directory with content is a blocked destination.
 */
export async function blocksCreate(value: string): Promise<boolean> {
  try {
    const info = await lstat(value);
    if (!info.isDirectory()) return true;
    return (await readdir(value)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function registrationState(repository: GitRepository, target: string): Promise<CheckoutRegistrationState> {
  const entry = (await repository.registered()).find(item => item.path === target);
  if (entry === undefined) return 'none';
  return entry.prunable ? 'orphan' : 'registered';
}
