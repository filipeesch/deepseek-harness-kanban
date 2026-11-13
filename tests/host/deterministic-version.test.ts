import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { stageGeneration } from '../../src/host/deterministic-version.js';
import type { Board } from '../../src/shared/types.js';

const YAML = 'columns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: task\n      params: [{name: pipeline, description: First}]\n      exits: {done: done}\n  - id: done\n    label: Done\n';
function board(identity: string, description = 'First'): Board {
  const workflow = parseWorkflow(YAML.replace('First', description));
  return { id: 'board', workflow, localStageIdentities: { wait: identity, done: 'done-key' } } as unknown as Board;
}
describe('deterministic stage generation', () => {
  it('changes when the stable stage identity changes with the same authored document', () => {
    const first = board('wait-a');
    const second = board('wait-b');
    expect(stageGeneration(first, first.workflow.columns[0]!)).not.toBe(stageGeneration(second, second.workflow.columns[0]!));
  });
  it('changes when a destination stable identity changes', () => {
    const first = board('wait-a');
    const second = { ...first, localStageIdentities: { wait: 'wait-a', done: 'done-b' } } as Board;
    expect(stageGeneration(first, first.workflow.columns[0]!)).not.toBe(stageGeneration(second, second.workflow.columns[0]!));
  });
  it('keeps the generation for a parameter description edit', () => {
    const described = board('wait-a', 'First');
    const changed = board('wait-a', 'Reworded guidance');
    expect(stageGeneration(described, described.workflow.columns[0]!)).toBe(stageGeneration(changed, changed.workflow.columns[0]!));
  });
});
