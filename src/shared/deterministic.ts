import type { Problem } from './types.js';

/** One required parameter a deterministic stage declares; the declaration carries no value. */
export interface DeterministicParameter {
  name: string;
  /** Optional authored guidance for the origin stage; never a value. */
  description?: string;
}
/** Authored executable behavior. Source bytes are never trimmed or normalized. */
export interface DeterministicDefinition {
  language: 'bash' | 'typescript';
  code?: string;
  file?: string;
  directory: 'task' | 'project';
  env?: string[];
  /** Required parameters the origin stage must supply for an entry. */
  params?: DeterministicParameter[];
  exits: Record<string, string>;
}
export interface DeterministicTarget { columnId: string; stageIdentity: string }
export interface TaskStageEntry { id: string; columnId: string; stageIdentity: string; enteredAt: string }
export const DETERMINISTIC_PHASES = ['capture-pending', 'awaiting-trust', 'active', 'stopping', 'stopped', 'result-ready', 'delivering', 'failed'] as const;
export type DeterministicPhase = (typeof DETERMINISTIC_PHASES)[number];
/** Immutable private source reference and approved authority, never resolved secret values or entry values. */
export interface DeterministicCapture {
  sourceRef: string;
  fingerprint: string;
  language: DeterministicDefinition['language'];
  directory: DeterministicDefinition['directory'];
  executionDirectory: string;
  source: { kind: 'inline' | 'file'; path?: string };
  env: string[];
  /** Declared parameter names; the values stay on the entry and outside this authority. */
  params: string[];
  exits: Record<string, DeterministicTarget>;
}
export interface DeterministicResult {
  id: string; exit: string; message: string; at: string;
  target?: DeterministicTarget;
  synthetic?: boolean;
  deliveryId?: string;
  deliveryStatus?: 'pending' | 'accepted' | 'failed';
  error?: Problem;
}
/** Task-local durable authority; ordinary snapshots must project a summary instead. */
export interface DeterministicControl {
  entryId: string; executionId: string; stageIdentity: string;
  definition: DeterministicDefinition;
  /** Stable destinations captured with the entry intent, before asynchronous source I/O. */
  targets?: Record<string, DeterministicTarget>;
  /** Entry-bound values; every attempt and Play of this entry reuses them. */
  parameters?: Record<string, string>;
  phase: DeterministicPhase; startedAt: string; attempt: number; restartCount: number;
  attemptId?: string; capture?: DeterministicCapture; result?: DeterministicResult; error?: Problem;
}
export interface DeterministicHandoff {
  id: string; entryId: string; executionId: string;
  fromColumnId: string; columnId: string; exit: string; message: string; at: string;
  acceptedAt?: string; error?: Problem;
  instruction?: string; sessionId?: string;
}
/** Safe card/drawer state; contains neither private capture references nor authorization. */
export interface DeterministicSummary {
  entryId: string; executionId: string; phase: DeterministicPhase; startedAt: string;
  attempt: number; restartCount: number; error?: Problem; exit?: string; message?: string;
  /** Present once a saved result exists; `failed` requires an explicit delivery retry. */
  deliveryStatus?: 'pending' | 'accepted' | 'failed';
  savedVersionChanged?: boolean;
  fingerprint?: string;
  /** Entry-bound values, projected so the script panel can show and repair them. */
  parameters?: Record<string, string>;
}
/** Explicit bounded review surface, separate from ordinary state publication. */
export interface DeterministicReview {
  executionId: string; fingerprint: string; code: string;
  language: DeterministicDefinition['language']; directory: DeterministicDefinition['directory'];
  exits: Record<string, string>; env: string[];
  /** The captured declaration the reviewed version requires. */
  params: DeterministicParameter[];
  variables: Array<{ name: string; configured: boolean }>;
  source?: { kind: 'inline' | 'file'; path?: string };
  executionDirectory?: string;
}
/** Everything a deterministic program receives; values are data, never interpolated into source. */
export interface DeterministicInput {
  task: { id: string; title: string; description: string };
  hub: { id: string };
  board: { id: string };
  stage: { id: string; identity: string };
  project: { id: string; directory: string };
  directory: string;
  worktree: { path: string; branch: string } | null;
  entryId: string;
  enteredAt: string | undefined;
  executionId: string;
  startedAt: string;
  attemptId: string | undefined;
  attempt: number;
  restartCount: number;
  /** Exactly the declared names, with the entry's values. */
  params: Record<string, string>;
  handoff?: DeterministicHandoff;
}
export interface StepCompletion { exit: string; message: string }
