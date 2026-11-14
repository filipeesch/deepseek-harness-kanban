import type { PendingUserWorkKind, Problem } from './types.js';

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
  /** `path` is the resolved primary file; `reference` is the authored path. */
  source: { kind: 'inline' | 'file'; path?: string; reference?: string };
  env: string[];
  /** Declared parameter names; the values stay on the entry and outside this authority. */
  params: string[];
  exits: Record<string, DeterministicTarget>;
}
/** One bounded background fact that refused delivery of a saved result. */
export interface DeterministicHoldBackground {
  kind: 'job' | 'schedule';
  /** Present for a job the drawer can cancel; never synthesized. */
  id?: string;
  label: string;
}
/** The stable reasons a saved result may be refused delivery. Never presentation text. */
export const DETERMINISTIC_HOLD_CODES = ['task-operation', 'project-operation', 'pending-transition', 'worktree-not-ready', 'project-directory-missing', 'execution-directory-changed', 'auto-mode-hold', 'context-reserved', 'conversation-active', 'background-work', 'pending-user-work', 'conversation-unreadable', 'stale-authority'] as const;
export type DeterministicHoldCode = (typeof DETERMINISTIC_HOLD_CODES)[number];
/** Durable explanation of one refused delivery: why, when, and the bounded facts behind it. */
export interface DeterministicHold {
  code: DeterministicHoldCode;
  at: string;
  /** Bounded background activity; absent unless the reason is background work. */
  background?: DeterministicHoldBackground[];
  /** Pending user-work kinds; absent unless the reason is pending user work. */
  pending?: PendingUserWorkKind[];
}
export interface DeterministicResult {
  id: string; exit: string; message: string; at: string;
  /** Bounded, redacted values the program sent; never part of the approved capture. */
  params?: Record<string, string>;
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
  /** Present while delivery of a saved result is refused; cleared once admitted or settled. */
  hold?: DeterministicHold;
}
export interface DeterministicHandoff {
  id: string; entryId: string; executionId: string;
  fromColumnId: string; columnId: string; exit: string; message: string; at: string;
  /** Bounded, redacted values the source program sent; conversation context and history, never program input. */
  params?: Record<string, string>;
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
  /** Present while a saved result awaits delivery; explains the refusal without a run. */
  hold?: DeterministicHold;
}
/** Stage-scoped executable version review; project variable values stay out of it. */
export interface DeterministicStageReview {
  stage: { boardId: string; stageId: string; stageIdentity: string; name: string };
  version: {
    fingerprint: string; stageGeneration: string; captured: boolean; directoryDependent: boolean;
    /** The project directory that resolved an authored relative source. */
    representative?: { projectId: string; projectName: string; directory: string };
  };
  code: string;
  language: DeterministicDefinition['language'];
  directory: DeterministicDefinition['directory'];
  source: { kind: 'inline' | 'file'; reference?: string };
  exits: Record<string, string>;
  env: string[];
  /** The reviewed declaration; descriptions are authored guidance, not authority. */
  params: DeterministicParameter[];
  approval: 'approved' | 'required';
  /** How many entries of this board and stage wait for this exact version. */
  waitingCards?: number;
  /** Present when the review is bound to a captured execution. */
  captured?: { taskId: string; entryId: string; executionDirectory: string };
}
/** Authorized names and configured state for one project and stable stage; values never leave the host. */
export interface DeterministicVariablesView {
  env: string[];
  variables: Array<{ name: string; configured: boolean }>;
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
  handoff?: DeterministicInputHandoff;
}
/** The handoff as a program sees it: exit and message metadata, never the sent parameter map. */
export type DeterministicInputHandoff = Omit<DeterministicHandoff, 'params'>;
export interface StepCompletion { exit: string; message: string; params?: Record<string, string> }
