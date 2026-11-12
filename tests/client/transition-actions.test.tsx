// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TransitionRule, Workflow } from '../../src/shared/types.js';
import type { ConnectionLayouts } from '../../src/domain/workflow-connections.js';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { useTransitionActions, type ConnectionLayoutPort, type TransitionActionInput } from '../../src/client/workflow-view/use/use-transition-actions.js';
import { emptyHistory } from '../../src/client/workflow-view/history.js';
import type { PlacementHistoryState } from '../../src/client/workflow-view/use/use-placement-history.js';

function workflowWith(rules: TransitionRule[] | undefined, other?: TransitionRule[] | undefined): Workflow {
  return {
    name: 'Flow',
    initialColumnId: 'a',
    columns: [
      { id: 'a', name: 'A', ...(rules === undefined ? {} : { allowedTransitions: rules }) },
      { id: 'b', name: 'B', ...(other === undefined ? {} : { allowedTransitions: other }) },
      { id: 'c', name: 'C' },
    ],
    groups: [],
  };
}

function harness(workflow: Workflow, connections: ConnectionLayouts = {}) {
  const state = { workflow };
  const sent: string[] = [];
  const writes = {
    saveWorkflow: vi.fn(async (yaml: string) => { sent.push('save:' + yaml); return {} as KanbanSnapshot; }),
    patchStage: vi.fn(async (stageId: string) => { sent.push('stage:' + stageId); return {} as KanbanSnapshot; }),
    atomically: vi.fn(async (task: (send: { saveWorkflow: (yaml: string) => Promise<KanbanSnapshot>; patchStage: (stageId: string, patch: unknown) => Promise<KanbanSnapshot> }) => Promise<unknown>) => task({
      saveWorkflow: async (yaml: string) => { sent.push('save:' + yaml); return {} as KanbanSnapshot; },
      patchStage: async (stageId: string) => { sent.push('stage:' + stageId); return {} as KanbanSnapshot; },
    })),
    drain: vi.fn(),
  };
  const pushes: Array<{ restores?: string; beforeConnections?: unknown; afterConnections?: unknown }> = [];
  const dropped: unknown[] = [];
  const historyState = {
    get history() { return emptyHistory(); },
    historyRef: { get current() { return emptyHistory(); } },
    push: (step: unknown) => { pushes.push(step as never); },
    replace: vi.fn(),
    dropStep: (step: unknown) => { dropped.push(step); },
    reset: vi.fn(),
  } as unknown as PlacementHistoryState;
  const intends: Array<[string, readonly TransitionRule[] | null]> = [];
  const released: string[][] = [];
  const overrides = {
    overrides: {},
    intend: (stageId: string, rules: readonly TransitionRule[] | null) => { intends.push([stageId, rules]); },
    preview: vi.fn(),
    release: (values: Readonly<Record<string, readonly TransitionRule[] | null | undefined>>) => { released.push(Object.keys(values)); },
    reset: vi.fn(),
  };
  const applied: string[] = [];
  const accepted: ConnectionLayouts[] = [];
  const restored: ConnectionLayouts[] = [];
  const layoutIntents: ConnectionLayouts[] = [];
  const connectionLayouts: ConnectionLayoutPort = {
    current: () => ({ ...connections }),
    intend: (values) => { layoutIntents.push(values); },
    authoritativeYaml: () => 'ACK',
    apply: (text) => { applied.push(text); return 'COMPOSED'; },
    accept: (values) => { accepted.push(values); },
    restore: (values) => { restored.push(values); },
  };
  const onError = vi.fn();
  const input: TransitionActionInput = {
    workflow: () => state.workflow,
    writes: writes as never,
    overrides,
    history: historyState,
    connections: connectionLayouts,
    positions: () => ({ a: { x: 0, y: 0 } }),
    sizes: () => ({}),
    onError,
  };
  const view = renderHook(() => useTransitionActions(input));
  return { view, state, writes, sent, pushes, intends, released, applied, accepted, restored, layoutIntents, onError, dropped };
}
describe('transition actions', () => {
  it('never adds a legacy routing source to deterministic exits, including diagram undo', async () => {
    const workflow = workflowWith(undefined);
    workflow.columns[0]!.deterministic = { language: 'bash', code: 'echo ok', directory: 'task', exits: { ok: 'b', cached: 'b' } };
    const h = harness(workflow);
    await act(async () => { h.view.result.current.create('a', 'c'); h.view.result.current.repoint('a', 'b', 'c'); h.view.result.current.remove('a', 'b'); h.view.result.current.restore({ a: [{ to: 'c' }] }); });
    expect(h.sent).toEqual([]); expect(h.intends).toEqual([]); expect(h.onError).toHaveBeenCalled();
    await expect(h.view.result.current.setCondition('a', 'b', 'not an exit')).rejects.toThrow('named exits');
  });
  it('authors only the destination that was drawn from a stage that allowed any stage', async () => {
    const h = harness(workflowWith(undefined));
    await act(async () => { h.view.result.current.create('a', 'c'); });
    expect(h.intends).toEqual([['a', [{ to: 'c' }]]]);
    expect(h.pushes).toHaveLength(1);
    expect(h.sent).toEqual(['stage:a']);
    expect(h.applied).toEqual([]);
    expect(h.layoutIntents).toEqual([]);
    expect(h.pushes[0]!.restores).toBe('transitions');
  });

  it('keeps the destinations a restricted stage already authored', async () => {
    const h = harness(workflowWith([{ to: 'b', when: 'later' }]));
    await act(async () => { h.view.result.current.create('a', 'c'); });
    expect(h.writes.atomically).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual(['stage:a']);
    expect(h.intends[0]![1]).toEqual([{ to: 'b', when: 'later' }, { to: 'c' }]);
  });

  it('stores nothing when the stage already authors the destination', async () => {
    const h = harness(workflowWith([{ to: 'c' }]));
    await act(async () => { h.view.result.current.create('a', 'c'); });
    expect(h.writes.atomically).not.toHaveBeenCalled();
    expect(h.pushes).toEqual([]);
  });


  it('keeps the side a connection was drawn from when the automatic route differs', async () => {
    const h = harness(workflowWith(undefined));
    await act(async () => { h.view.result.current.create('a', 'c', 'bottom'); });
    expect(h.sent).toEqual(['stage:a', 'save:COMPOSED']);
    expect(h.applied).toEqual(['ACK']);
    expect(h.accepted).toEqual([{ 'a->c': { from: 'a', to: 'c', source: { side: 'bottom', at: 2 } } }]);
    expect(h.pushes[0]!.restores).toBe('both');
  });

  it('leaves the automatic route alone when the side matches it', async () => {
    const forward = harness(workflowWith(undefined));
    await act(async () => { forward.view.result.current.create('a', 'c', 'right'); });
    expect(forward.sent).toEqual(['stage:a']);
    expect(forward.applied).toEqual([]);
    // A connection to an earlier stage leaves from the bottom edge automatically.
    const returning = harness(workflowWith(undefined));
    await act(async () => { returning.view.result.current.create('c', 'a', 'bottom'); });
    expect(returning.sent).toEqual(['stage:c']);
    expect(returning.applied).toEqual([]);
  });

  it('re-points a destination and prunes the superseded layout inside one transaction', async () => {
    const h = harness(workflowWith([{ to: 'b' }]), { 'a->b': { from: 'a', to: 'b', source: { side: 'top', at: 1 } } });
    await act(async () => { h.view.result.current.repoint('a', 'b', 'c'); });
    expect(h.sent).toEqual(['stage:a', 'save:COMPOSED']);
    // The prune is composed onto the document the patch acknowledged, never before it.
    expect(h.applied).toEqual(['ACK']);
    expect(h.accepted).toEqual([{}]);
    expect(h.pushes[0]).toMatchObject({ restores: 'both', beforeConnections: { 'a->b': { from: 'a', to: 'b' } }, afterConnections: {} });
    expect(h.intends[0]![1]).toEqual([{ to: 'c' }]);
  });

  it('moves the owner of a transition, authoring on the receiver before removing it', async () => {
    const h = harness(workflowWith([{ to: 'c', when: 'only when urgent' }], []), { 'a->c': { from: 'a', to: 'c' } });
    await act(async () => { h.view.result.current.reown('a', 'c', 'b'); });
    expect(h.sent).toEqual(['stage:b', 'stage:a', 'save:COMPOSED']);
    expect(h.applied).toEqual(['ACK']);
    expect(h.intends[0]).toEqual(['b', [{ to: 'c', when: 'only when urgent' }]]);
    expect(h.intends[1]).toEqual(['a', []]);
  });

  it('keeps the receiver condition when it already authors the moved destination', async () => {
    const h = harness(workflowWith([{ to: 'c', when: 'from a' }], [{ to: 'c', when: 'from b' }]));
    await act(async () => { h.view.result.current.reown('a', 'c', 'b'); });
    expect(h.intends[0]).toEqual(['b', [{ to: 'c', when: 'from b' }]]);
    expect(h.intends[1]).toEqual(['a', []]);
  });

  it('moves the default path of a stage that authors nothing and stops drawing it', async () => {
    const h = harness(workflowWith(undefined, []));
    await act(async () => { h.view.result.current.reown('a', 'c', 'b'); });
    // With no stored layout entry there is nothing to prune, so only the patches are sent.
    expect(h.sent).toEqual(['stage:b', 'stage:a']);
    expect(h.applied).toEqual([]);
    expect(h.intends[0]).toEqual(['b', [{ to: 'c' }]]);
    expect(h.intends[1]).toEqual(['a', []]);
  });

  it('prunes the stored layout of the default path it moves', async () => {
    const h = harness(workflowWith(undefined, []), { 'a->c': { from: 'a', to: 'c', source: { side: 'top', at: 1 } } });
    await act(async () => { h.view.result.current.reown('a', 'c', 'b'); });
    expect(h.sent).toEqual(['stage:b', 'stage:a', 'save:COMPOSED']);
    expect(h.accepted).toEqual([{}]);
  });

  it('removes the last destination and leaves the stage permitting none', async () => {
    const h = harness(workflowWith([{ to: 'b' }]), { 'a->b': { from: 'a', to: 'b' } });
    await act(async () => { h.view.result.current.remove('a', 'b'); });
    expect(h.sent).toEqual(['stage:a', 'save:COMPOSED']);
    expect(h.applied).toEqual(['ACK']);
    expect(h.intends[0]).toEqual(['a', []]);
  });

  it('removes the default path of a stage that authors nothing', async () => {
    const h = harness(workflowWith(undefined));
    await act(async () => { h.view.result.current.remove('a', 'c'); });
    expect(h.sent).toEqual(['stage:a']);
    expect(h.intends[0]).toEqual(['a', []]);
  });

  it('ignores a removal of a destination a restricted stage does not draw', async () => {
    const h = harness(workflowWith([{ to: 'b' }]));
    await act(async () => { h.view.result.current.remove('a', 'c'); });
    expect(h.sent).toEqual([]);
    expect(h.pushes).toEqual([]);
  });

  it('writes one condition through the narrow patch', async () => {
    const h = harness(workflowWith([{ to: 'b' }]));
    await act(async () => { await h.view.result.current.setCondition('a', 'b', 'when ready'); });
    expect(h.writes.patchStage).toHaveBeenCalledWith('a', { transitionCondition: { to: 'b', when: 'when ready' } });
    expect(h.intends).toEqual([['a', [{ to: 'b', when: 'when ready' }]]]);
  });

  it('promotes the default path when a condition is written for it', async () => {
    const h = harness(workflowWith(undefined));
    await act(async () => { await h.view.result.current.setCondition('a', 'c', 'on review'); });
    expect(h.writes.patchStage).toHaveBeenCalledWith('a', { transitionCondition: { to: 'c', when: 'on review' } });
    expect(h.intends).toEqual([['a', [{ to: 'c', when: 'on review' }]]]);
  });

  it('clears a condition with a null write', async () => {
    const h = harness(workflowWith([{ to: 'b', when: 'old' }]));
    await act(async () => { await h.view.result.current.setCondition('a', 'b', '   '); });
    expect(h.writes.patchStage).toHaveBeenCalledWith('a', { transitionCondition: { to: 'b', when: null } });
  });

  it('reports a rejected condition inside the editor and releases only its stage', async () => {
    const h = harness(workflowWith([{ to: 'b' }]));
    h.writes.patchStage.mockRejectedValueOnce({ code: 'REVISION_CONFLICT', message: 'The Hub changed.' });
    await act(async () => {
      await expect(h.view.result.current.setCondition('a', 'b', 'later')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    });
    expect(h.view.result.current.error).toBe('The Hub changed.');
    expect(h.dropped).toHaveLength(1);
    expect(h.released).toEqual([['a']]);
    expect(h.view.result.current.pending).toBe(false);
  });

  it('drops exactly the step it pushed and releases only its stages when a gesture is rejected', async () => {
    const h = harness(workflowWith(undefined));
    h.writes.atomically.mockRejectedValueOnce({ code: 'REVISION_CONFLICT', message: 'The Hub changed.' });
    await act(async () => { h.view.result.current.create('a', 'c'); });
    await act(async () => {});
    expect(h.dropped).toEqual(h.pushes);
    expect(h.released).toEqual([['a']]);
    expect(h.onError).toHaveBeenCalled();
  });

  it('restores one stage patch per destination set a history step carries', async () => {
    const h = harness(workflowWith([{ to: 'b' }]));
    await act(async () => { h.view.result.current.restore({ a: [{ to: 'b' }], b: null }); });
    expect(h.sent).toEqual(['stage:a', 'stage:b']);
  });
});
