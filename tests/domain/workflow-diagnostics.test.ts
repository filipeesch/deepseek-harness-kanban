import { describe, expect, it } from 'vitest';
import { workflowProblems } from '../../src/domain/workflow-diagnostics.js';

const VALID = 'name: Flow\ninitial_column: todo\ncolumns:\n  - id: todo\n    label: Todo\n  - id: done\n    label: Done\n';

describe('workflow problems', () => {
  it('reports no problem for a valid document', () => {
    expect(workflowProblems(VALID)).toEqual([]);
  });

  it('reports every syntax problem with its position', () => {
    const text = 'columns:\n  - id: todo\n    label: Todo\n    bad: [1, 2\n  - id: done\n    label: Done\n    bad2: [3, 4\n';
    const problems = workflowProblems(text);
    expect(problems.length).toBeGreaterThan(1);
    expect(new Set(problems.map(problem => problem.line)).size).toBeGreaterThan(1);
    expect(problems.every(problem => typeof problem.line === 'number' && typeof problem.column === 'number')).toBe(true);
    expect(problems.every(problem => problem.message.length > 0)).toBe(true);
  });

  it('reports an empty document without a position', () => {
    expect(workflowProblems('   ')).toEqual([{ message: 'Workflow YAML must be nonempty text.' }]);
  });

  it('reports a semantic problem once the document parses', () => {
    const problems = workflowProblems('name: Flow\ncolumns: []\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('at least one column');
    expect(problems[0]!.line).toBeUndefined();
  });

  it('reports an unknown transition target without a position', () => {
    const problems = workflowProblems('columns:\n  - id: todo\n    label: Todo\n    allowed_transitions: [ghost]\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('ghost');
  });
});
