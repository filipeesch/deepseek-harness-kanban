import type { StageProblem } from './stage-problem.js';

/**
 * The authoring concerns one stage edit covers, in the order the editor presents
 * them. A stage that authors a program has Inputs and Approval tabs; a stage that
 * authors a decision has its Decision tab; neither concern describes the other mode.
 */
export type StageEditorTab = 'stage' | 'execution' | 'routing' | 'inputs' | 'approval' | 'decision';

const LABELS: Readonly<Record<StageEditorTab, string>> = {
  stage: 'Stage', execution: 'Execution', routing: 'Routing', inputs: 'Inputs', approval: 'Approval', decision: 'Decision',
};

const AGENT_ORDER: readonly StageEditorTab[] = ['stage', 'execution', 'routing'];
const SCRIPTED_ORDER: readonly StageEditorTab[] = ['stage', 'execution', 'routing', 'inputs', 'approval'];
const DECISION_ORDER: readonly StageEditorTab[] = ['stage', 'decision'];

/** The tabs one stage presents, in editor order. */
export function stageEditorTabs(execution: 'agent' | 'scripted' | 'decision'): StageEditorTab[] {
  if (execution === 'scripted') return [...SCRIPTED_ORDER];
  if (execution === 'decision') return [...DECISION_ORDER];
  return [...AGENT_ORDER];
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
    case 'decision':
      return 'decision';
    default: {
      const unhandled: never = field;
      return unhandled;
    }
  }
}
