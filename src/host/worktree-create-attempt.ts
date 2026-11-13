import { KanbanError } from '../shared/errors.js';
import type { ContextOperation, CreateAttemptRecord, GitProject } from '../shared/types.js';
import { resolveCanonicalPath } from './path-resolution.js';

/** How a retry may use a branch that already exists. */
export type BranchReuseMode = 'create' | 'reuse' | 'blocked';

/**
 * A retry creates, reuses, or refuses a branch by comparing its tip with the commit
 * the attempt proved. Reuse is never inferred from the branch name alone.
 */
export function retryModeFor(tip: string | undefined, expected: string): BranchReuseMode {
  if (tip === undefined) return 'create';
  return tip === expected ? 'reuse' : 'blocked';
}

/** The recorded proof no longer describes the operation, its target, or its repository. */
export function unverifiedAttempt(): KanbanError {
  return new KanbanError('CREATE_RECOVERY_UNVERIFIED', 'The recorded create precondition no longer matches this operation.');
}

/**
 * The persisted proof that this host invoked a worktree write at a destination that
 * was absent. Every recovery route asks this object what it may claim; none of them
 * infers ownership from a directory that merely exists.
 */
export class CreateAttempt {
  constructor(private readonly operation: ContextOperation, readonly record: CreateAttemptRecord) {}

  /** The attempt of a creation operation, or undefined when none was armed. */
  static of(operation: ContextOperation): CreateAttempt | undefined {
    const record = operation.createAttempt;
    return record === undefined ? undefined : new CreateAttempt(operation, record);
  }

  get path(): string { return this.record.path; }
  get branchName(): string { return this.record.branchName; }
  get mode(): CreateAttemptRecord['mode'] { return this.record.mode; }

  /**
   * The commit this attempt proved it would check out. A record written before the
   * field existed resolves the same source the creation used, once, and the caller
   * persists the answer.
   */
  async sourceCommit(project: GitProject, resolve: (sourceBranch: string) => Promise<string>): Promise<string> {
    if (this.record.sourceCommit !== undefined) return this.record.sourceCommit;
    const request = this.operation.request;
    const source = (request.kind === 'create' ? request.sourceBranch : undefined) ?? project.defaultBranch ?? 'HEAD';
    return resolve(source);
  }

  /** Whether the branch tip is exactly the commit this attempt proved it would check out. */
  commitProven(tip: string | undefined, expected: string): boolean {
    return tip !== undefined && tip === expected;
  }

  /** How a retry may use a branch that already exists. */
  retryMode(tip: string | undefined, expected: string): BranchReuseMode {
    return retryModeFor(tip, expected);
  }

  /**
   * Refuse a proof that no longer matches its operation. Canonicalization is part of
   * the check, so a moved or aliased destination cannot inherit a stale claim.
   */
  async assertVerified(project: GitProject): Promise<void> {
    const request = this.operation.request;
    if (request.kind !== 'create') throw unverifiedAttempt();
    const record = this.record;
    if (record.absentBefore !== true || record.operationId !== this.operation.id) throw unverifiedAttempt();
    if (record.path !== this.operation.targetPath || record.path !== request.path) throw unverifiedAttempt();
    if (record.branchName !== request.branchName || record.mode !== request.mode) throw unverifiedAttempt();
    if (record.path !== await resolveCanonicalPath(request.path, true)) throw unverifiedAttempt();
    if (record.gitRootPath !== await resolveCanonicalPath(project.gitRootPath)) throw unverifiedAttempt();
  }
}
