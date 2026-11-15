import type { StageEditorTab } from './stage-tabs.js';

/**
 * One validation problem and the field that caused it.
 *
 * The editor keeps a single problem vocabulary: the stage fields and the program
 * fields are the same kind of fact, they are presented through one component, and
 * the tab that owns the field is derived from it instead of being restated.
 */
export interface StageProblem {
  readonly field: 'name' | 'id' | 'execution' | 'transitions' | 'source' | 'env' | 'params' | 'exits';
  readonly message: string;
}

/** Every problem of one field, joined for one inline notice. */
export function problemMessage(problems: readonly StageProblem[], field: StageProblem['field']): string | undefined {
  const messages = problems.filter(problem => problem.field === field).map(problem => problem.message);
  return messages.length === 0 ? undefined : messages.join(' ');
}

/** The first tab, in editor order, that holds a problem. */
export function firstProblemTab(problems: readonly StageProblem[], tabs: readonly StageEditorTab[], tabOf: (field: StageProblem['field']) => StageEditorTab): StageEditorTab | undefined {
  return tabs.find(tab => problems.some(problem => tabOf(problem.field) === tab));
}
