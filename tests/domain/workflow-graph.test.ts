import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { workflowGraph } from '../../src/domain/workflow-graph.js';
import { parseWorkflow } from '../../src/domain/workflow.js';

const flow: Workflow = {
  name: 'Flow',
  initialColumnId: 'backlog',
  columns: [
    { id: 'backlog', name: 'Backlog', allowedTransitions: ['plan', 'done'] },
    { id: 'plan', name: 'Plan' },
    { id: 'review', name: 'In Review', allowedTransitions: ['done', 'backlog', 'review'] },
    { id: 'done', name: 'Done', allowedTransitions: [] },
  ],
  groups: [{ id: 'planning', name: 'Planning', columnIds: ['plan', 'backlog'] }],
};

describe('workflow graph', () => {
  it('lists every stage in workflow order with its group', () => {
    const graph = workflowGraph(flow);
    expect(graph.nodes.map(node => node.id)).toEqual(['backlog', 'plan', 'review', 'done']);
    expect(graph.nodes.map(node => node.groupId)).toEqual(['planning', 'planning', undefined, undefined]);
  });

  it('draws configured transitions with fan-out positions', () => {
    const graph = workflowGraph(flow);
    expect(graph.connections.filter(connection => connection.from === 'backlog')).toEqual([
      { from: 'backlog', to: 'plan', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 2 },
      { from: 'backlog', to: 'done', kind: 'explicit', returning: false, fanOut: 1, fanOutCount: 2 },
    ]);
  });

  it('draws one dashed default connection for a stage that omits transitions', () => {
    const graph = workflowGraph(flow);
    expect(graph.connections.filter(connection => connection.from === 'plan')).toEqual([
      { from: 'plan', to: 'review', kind: 'implicit', returning: false, fanOut: 0, fanOutCount: 1 },
    ]);
  });

  it('skips a self target and marks a returning connection', () => {
    const graph = workflowGraph(flow);
    expect(graph.connections.filter(connection => connection.from === 'review')).toEqual([
      { from: 'review', to: 'done', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 2 },
      { from: 'review', to: 'backlog', kind: 'explicit', returning: true, fanOut: 1, fanOutCount: 2 },
    ]);
  });

  it('draws nothing for an empty transition list or a single-stage workflow', () => {
    expect(workflowGraph(flow).connections.filter(connection => connection.from === 'done')).toEqual([]);
    const single: Workflow = { name: 'One', initialColumnId: 'one', columns: [{ id: 'one', name: 'One' }], groups: [] };
    expect(workflowGraph(single)).toEqual({ nodes: [{ id: 'one', name: 'One', index: 0 }], connections: [] });
  });

  it('skips a target the workflow does not define', () => {
    const hand: Workflow = { name: 'Hand', initialColumnId: 'one', columns: [{ id: 'one', name: 'One', allowedTransitions: ['missing', 'two'] }, { id: 'two', name: 'Two' }], groups: [] };
    expect(workflowGraph(hand).connections).toEqual([{ from: 'one', to: 'two', kind: 'explicit', returning: false, fanOut: 0, fanOutCount: 1 }]);
  });

  it('derives connections from parsed YAML', () => {
    const yaml = ['default_view: workflow', 'columns:', '  - id: todo', '    label: Todo', '    allowed_transitions: [doing]', '  - id: doing', '    label: Doing', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));
    expect(workflowGraph(parseWorkflow(yaml)).connections.map(connection => [connection.from, connection.to, connection.kind])).toEqual([
      ['todo', 'doing', 'explicit'],
      ['doing', 'done', 'implicit'],
    ]);
  });
});
