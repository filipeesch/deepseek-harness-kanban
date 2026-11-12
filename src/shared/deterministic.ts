import type { Problem } from './types.js';

/** Authored executable behavior. Source bytes are never trimmed or normalized. */
export interface DeterministicDefinition {
  language: 'bash' | 'typescript';
  code?: string;
  file?: string;
  directory: 'task' | 'project';
  env?: string[];
  exits: Record<string, string>;
}
export interface DeterministicTarget { columnId: string; stageIdentity: string }
export interface TaskStageEntry { id: string; columnId: string; stageIdentity: string; enteredAt: string }
export const DETERMINISTIC_PHASES = ['capture-pending', 'awaiting-trust', 'active', 'stopping', 'stopped', 'result-ready', 'delivering', 'failed'] as const;
export type DeterministicPhase = (typeof DETERMINISTIC_PHASES)[number];
/** Immutable private source reference and approved authority, never resolved secret values. */
export interface DeterministicCapture {
  sourceRef: string;
  fingerprint: string;
  language: DeterministicDefinition['language'];
  directory: DeterministicDefinition['directory'];
  executionDirectory: string;
  source: { kind: 'inline' | 'file'; path?: string };
  env: string[];
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
}
/** Explicit bounded review surface, separate from ordinary state publication. */
export interface DeterministicReview {
  executionId: string; fingerprint: string; code: string;
  language: DeterministicDefinition['language']; directory: DeterministicDefinition['directory'];
  exits: Record<string, string>; env: string[];
  variables: Array<{ name: string; configured: boolean }>;
  source?: { kind: 'inline' | 'file'; path?: string };
  executionDirectory?: string;
}
export interface StepCompletion { exit: string; message: string }
