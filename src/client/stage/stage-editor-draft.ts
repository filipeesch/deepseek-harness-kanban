import type { DeterministicSummary } from '../../shared/deterministic.js';
import type { Attention, Column, StagePatch, Task, TransitionRule } from '../../shared/types.js';
import { deterministicDraft, deterministicDefinition, deterministicProblems, type DeterministicDraft } from './deterministic-draft.js';
import { deterministicEqual } from '../../domain/deterministic-definition.js';
import { isDomainId } from '../../domain/validation.js';
import { sameTransitionRules } from '../../domain/transition-rule.js';
import { conversationStageActivity, describeStageActivity, persistedStageActivity } from '../../shared/stage-activity.js';

/** One chosen transition target and the condition the user is editing for it. */
export interface StageTransitionDraft { readonly to: string; readonly when: string }

/**
 * How the stage treats its destinations: it permits any other stage, it permits a
 * chosen set, or it permits none at all. The last one is authored as an empty
 * transition list, which is a stage that never advances on its own.
 */
export type StageTransitionMode = 'any' | 'restricted' | 'none';

/** Everything the stage editor is editing, before any of it is stored. */
export interface StageEditorDraft {
  readonly execution?: 'agent' | 'deterministic';
  readonly deterministic?: DeterministicDraft;
  readonly name: string;
  readonly onEnterPrompt: string;
  readonly mode: StageTransitionMode;
  readonly transitions: readonly StageTransitionDraft[];
  readonly initial: boolean;
  readonly id: string;
}

/** A problem the editor shows next to the field that caused it. */
export interface StageEditorProblem { readonly field: 'name' | 'id' | 'transitions' | 'source' | 'env' | 'exits' | 'execution'; readonly message: string }

/** The mode a stored stage's transition list describes. */
export function transitionMode(transitions: TransitionRule[] | undefined): StageTransitionMode {
  if (transitions === undefined) return 'any';
  return transitions.length === 0 ? 'none' : 'restricted';
}

/** The draft a stage opens with. */
export function stageDraft(column: Column): StageEditorDraft {
  // An authored list means restricted or terminal, even when it is empty: the parser
  // treats an empty list as "permits nothing" and an absent one as "permits anything".
  const transitions = column.allowedTransitions;
  return {
    ...(column.deterministic === undefined ? {} : { execution: 'deterministic' as const, deterministic: deterministicDraft(column.deterministic) }),
    name: column.name,
    onEnterPrompt: column.onEnterPrompt ?? '',
    mode: transitionMode(transitions),
    transitions: (transitions ?? []).map(rule => ({ to: rule.to, when: rule.when ?? '' })),
    initial: false,
    id: column.id,
  };
}

/** True when the draft still describes the stage exactly as it is stored. */
export function draftChanged(draft: StageEditorDraft, column: Column): boolean {
  const stored = stageDraft(column);
  if (draft.name !== stored.name || draft.onEnterPrompt !== stored.onEnterPrompt || draft.id !== stored.id || draft.initial) return true;
  if ((draft.execution ?? 'agent') !== (stored.execution ?? 'agent')) return true;
  if (draft.execution === 'deterministic') return !deterministicEqual(deterministicDefinition(draft.deterministic ?? deterministicDraft()), column.deterministic);
  if (draft.mode !== stored.mode) return true;
  if (draft.mode !== 'restricted') return false;
  if (draft.transitions.length !== stored.transitions.length) return true;
  return draft.transitions.some((transition, index) => {
    const other = stored.transitions[index];
    return other === undefined || transition.to !== other.to || transition.when.trim() !== other.when.trim();
  });
}

/** Every problem that stops the draft from being stored. */
export function draftProblems(draft: StageEditorDraft, otherStageIds: ReadonlySet<string>): StageEditorProblem[] {
  const problems: StageEditorProblem[] = [];
  if (draft.name.trim().length === 0) problems.push({ field: 'name', message: 'A stage name is required.' });
  if (draft.id.trim().length === 0) problems.push({ field: 'id', message: 'A stage id is required.' });
  else if (!isDomainId(draft.id)) problems.push({ field: 'id', message: 'A stage id must be a nonempty safe identifier, with no spaces.' });
  else if (otherStageIds.has(draft.id)) problems.push({ field: 'id', message: 'Another stage already uses this id.' });
  if (draft.execution === 'deterministic') {
    problems.push(...deterministicProblems(draft.deterministic ?? deterministicDraft(), otherStageIds));
    if (draft.onEnterPrompt.trim() || draft.mode !== 'any' || draft.transitions.length) problems.push({ field: 'execution', message: 'Deterministic execution cannot coexist with an instruction or allowed destinations.' });
  } else if (draft.mode === 'restricted') {
    // A stage that permits no destination is a real state with its own mode, so the
    // editor points there instead of quietly storing a list that permits nothing.
    if (draft.transitions.length === 0) problems.push({ field: 'transitions', message: 'Choose at least one destination, or choose "No destinations".' });
    const seen = new Set<string>();
    for (const transition of draft.transitions) {
      if (seen.has(transition.to)) problems.push({ field: 'transitions', message: 'A destination can be chosen once.' });
      seen.add(transition.to);
    }
    if (draft.transitions.some(transition => transition.to === draft.id)) problems.push({ field: 'transitions', message: 'A stage cannot be its own destination.' });
    if (draft.transitions.some(transition => !otherStageIds.has(transition.to) && transition.to !== draft.id)) problems.push({ field: 'transitions', message: 'A destination is no longer a stage of this board.' });
  }
  return problems;
}

/** The warning shown when another stage of the board already uses the edited name. */
export function duplicateNameWarning(draft: StageEditorDraft, columns: readonly Column[], stageId: string): string | null {
  const name = draft.name.trim();
  if (name.length === 0) return null;
  const match = columns.find(column => column.id !== stageId && column.name.trim() === name);
  return match === undefined ? null : 'The stage "' + match.name + '" already uses this name.';
}

/** The destinations the draft would author: null permits any stage, empty permits none. */
export function draftDestinations(draft: StageEditorDraft): TransitionRule[] | null {
  if (draft.mode === 'any') return null;
  if (draft.mode === 'none') return [];
  return draft.transitions.map(transition => transition.when.trim().length === 0 ? { to: transition.to } : { to: transition.to, when: transition.when.trim() });
}

/** The patch for the fields the user actually changed. */
export function stagePatch(draft: StageEditorDraft, column: Column): StagePatch {
  const patch: StagePatch = {};
  if (draft.name !== column.name) patch.name = draft.name.trim();
  const instruction = draft.onEnterPrompt;
  const storedInstruction = column.onEnterPrompt ?? '';
  if (instruction !== storedInstruction) patch.onEnterPrompt = instruction.trim().length === 0 ? null : instruction;
  if (draft.id !== column.id) patch.id = draft.id;
  if (draft.initial) patch.initial = true;
  if (draft.execution === 'deterministic') {
    const wanted = deterministicDefinition(draft.deterministic ?? deterministicDraft());
    if (!deterministicEqual(wanted, column.deterministic)) patch.deterministic = wanted;
    if (column.onEnterPrompt !== undefined) patch.onEnterPrompt = null;
    if (column.allowedTransitions !== undefined) patch.allowedTransitions = null;
    return patch;
  }
  if (column.deterministic !== undefined) patch.deterministic = null;
  const wanted = draftDestinations(draft);
  if (!sameTransitionRules(column.allowedTransitions, wanted)) patch.allowedTransitions = wanted;
  return patch;
}

/** The stages a transition may target: every stage but the edited one. */
export function transitionChoices(columns: readonly Column[], stageId: string): Column[] {
  return columns.filter(column => column.id !== stageId);
}

/**
 * Why the board cannot rename a stage identifier right now, or null when it can.
 * The host repeats this check: here it only explains the field before a save.
 */
export function stageRenameBlock(tasks: readonly Task[], attention: Readonly<Record<string, Attention>>, scripts: Readonly<Record<string, DeterministicSummary>> = {}): string | null {
  if (tasks.some(task => scripts[task.id] && ['capture-pending', 'active', 'stopping', 'result-ready', 'delivering'].includes(scripts[task.id]!.phase))) return 'The id cannot change while the board has deterministic execution in flight. Finish it first.';
  const reasons: string[] = [];
  for (const task of tasks) {
    reasons.push(...persistedStageActivity(task), ...conversationStageActivity(attention[task.id]));
  }
  if (reasons.length === 0) return null;
  return 'The id cannot change while the board has work in flight (' + describeStageActivity(reasons) + '). Finish it first.';
}
