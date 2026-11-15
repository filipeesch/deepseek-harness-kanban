import type { StageProblem } from './stage-problem.js';

/**
 * The five authoring concerns one stage edit covers, in the order the editor
 * presents them.
 *
 * A stage that authors a program has an Inputs and an Approval tab; a stage that
 * authors an agent instruction or nothing does not, because both concerns describe
 * a program that does not exist.
 */
export type StageEditorTab = 'stage' | 'execution' | 'routing' | 'inputs' | 'approval';

const LABELS: Readonly<Record<StageEditorTab, string>> = {
  stage: 'Stage', execution: 'Execution', routing: 'Routing', inputs: 'Inputs', approval: 'Approval',
};

const ORDER: readonly StageEditorTab[] = ['stage', 'execution', 'routing', 'inputs', 'approval'];

/** The tabs one stage presents, in editor order. */
export function stageEditorTabs(scripted: boolean): StageEditorTab[] {
  return scripted ? [...ORDER] : ORDER.filter(tab => tab !== 'inputs' && tab !== 'approval');
}

/** The label of one tab. */
export function stageTabLabel(tab: StageEditorTab): string {
  return LABELS[tab];
}

/**
 * The tab that owns one field, so a problem is never presented away from its field.
 *
 * The mapping is exhaustive on purpose: a field added to the draft later fails to
 * compile here instead of quietly landing on the Execution tab.
 */
export function stageTabOfField(field: StageProblem['field']): StageEditorTab {
  switch (field) {
    case 'name':
    case 'id':
    case 'execution':
      return 'stage';
    case 'transitions':
    case 'exits':
      return 'routing';
    case 'params':
    case 'env':
      return 'inputs';
    case 'source':
      return 'execution';
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}
