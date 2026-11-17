import type { DecisionDefinition } from '../../shared/types.js';
import { DECISION_LIMITS, DECISION_OPTION_ID, decisionEqual } from '../../domain/decision-definition.js';
import type { StageProblem } from './stage-problem.js';

/** One option the user is editing, before it is stored. */
export interface DecisionOptionDraft { readonly id: string; readonly title: string; readonly description: string; readonly to: string; /** Immutable editor identity; never authored or stored. */ readonly rowKey?: string }

/** Everything the Decision tab edits. */
export interface DecisionDraft { readonly question: string; readonly context: string; readonly options: readonly DecisionOptionDraft[] }

let rowSequence = 0;
function newRowKey(): string { rowSequence += 1; return 'decision-row-' + rowSequence; }

/** A new option row with an unused default id and a stable editor key. */
export function newDecisionOption(options: readonly DecisionOptionDraft[], to: string): DecisionOptionDraft {
  const used = new Set(options.map(option => option.id.trim()));
  let index = 1;
  while (used.has('option-' + index)) index += 1;
  return { id: 'option-' + index, title: '', description: '', to, rowKey: newRowKey() };
}

/** The draft an empty gate starts with. */
export function emptyDecisionDraft(): DecisionDraft {
  return { question: '', context: '', options: [] };
}

/** The draft a stored decision configuration opens with. */
export function decisionDraft(value: DecisionDefinition): DecisionDraft {
  return { question: value.question, context: value.context ?? '', options: value.options.map(option => ({ id: option.id, title: option.title, description: option.description ?? '', to: option.to, rowKey: newRowKey() })) };
}

/** The definition the draft would author, with blank optional text omitted. */
export function decisionDefinition(draft: DecisionDraft): DecisionDefinition {
  return {
    question: draft.question,
    ...(draft.context.trim().length === 0 ? {} : { context: draft.context }),
    options: draft.options.map(option => ({ id: option.id.trim(), title: option.title, ...(option.description.trim().length === 0 ? {} : { description: option.description }), to: option.to })),
  };
}

/** True when the draft describes the stored configuration. */
export function decisionDraftChanged(draft: DecisionDraft, value: DecisionDefinition | undefined): boolean {
  return value === undefined ? true : !decisionEqual(decisionDefinition(draft), value);
}

/**
 * Every problem that stops the decision draft from being stored. Destinations are
 * checked against the board's other stages, never against the edited stage itself.
 */
export function decisionProblems(draft: DecisionDraft, otherStageIds: ReadonlySet<string>, stageId: string): StageProblem[] {
  const problems: StageProblem[] = [];
  const add = (message: string): void => { problems.push({ field: 'decision', message }); };
  if (draft.question.trim().length === 0) add('A decision question is required.');
  else if (draft.question.length > DECISION_LIMITS.questionLength) add('The question is longer than ' + DECISION_LIMITS.questionLength + ' characters.');
  if (draft.context.length > DECISION_LIMITS.contextLength) add('The context is longer than ' + DECISION_LIMITS.contextLength + ' characters.');
  if (draft.options.length === 0) add('A decision requires at least one option.');
  if (draft.options.length > DECISION_LIMITS.options) add('A decision supports at most ' + DECISION_LIMITS.options + ' options.');
  const seen = new Set<string>();
  for (const [index, option] of draft.options.entries()) {
    const label = 'Option ' + (index + 1);
    const id = option.id.trim();
    if (id.length === 0) add(label + ' requires an id.');
    else if (!DECISION_OPTION_ID.test(id)) add(label + ' id must start with a letter and use only letters, digits, "_" or "-".');
    else if (seen.has(id)) add(label + ' repeats an option id.');
    seen.add(id);
    if (option.title.trim().length === 0) add(label + ' requires a title.');
    else if (option.title.length > DECISION_LIMITS.titleLength) add(label + ' title is longer than ' + DECISION_LIMITS.titleLength + ' characters.');
    if (option.description.length > DECISION_LIMITS.descriptionLength) add(label + ' description is longer than ' + DECISION_LIMITS.descriptionLength + ' characters.');
    if (option.to.length === 0) add(label + ' requires a destination.');
    else if (!otherStageIds.has(option.to) || option.to === stageId) add(label + ' destination is not another stage of this board.');
  }
  return problems;
}