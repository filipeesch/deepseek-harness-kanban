// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardState, KanbanSnapshot, Command } from '../../src/shared/types.js';
import type { RunCommand } from '../../src/client/ui.js';
import { AutoRunController } from '../../src/client/auto-run.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { WorkflowView, type WorkflowCardPort, type WorkflowViewProps } from '../../src/client/workflow-view/workflow-view.js';
import type { WorkflowCanvasProps } from '../../src/client/workflow-view/canvas.js';
import { deferred, fixture } from './helpers.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const yaml = ['name: Delivery', 'columns:', '  - id: one', '    label: One', '    position: {x: 0, y: 0}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));

function task(id: string, title: string, columnId: string) {
  return {
    id, projectId: 'p', title, description: '', columnId, position: 0,
    sessionIds: [], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function boardState(): BoardState {
  return {
    schemaVersion: 2, revision: 7, workflowYaml: yaml, workflow: parseWorkflow(yaml),
    projects: [{ id: 'p', name: 'Project', projectPath: '/repo' }],
    tasks: [task('a', 'Alpha', 'one'), task('b', 'Beta', 'two')],
    notes: [], settings: {},
  };
}

function cardPort(overrides: Partial<WorkflowCardPort> = {}): WorkflowCardPort {
  return {
    attention: {},
    projectNames: new Map([['p', 'Project']]),
    autoRun: new AutoRunController({ run: async () => fixture() as KanbanSnapshot }),
    autoModePending: new Set<string>(),
    selectionMode: false,
    selectedIds: new Set<string>(),
    advancePending: new Set<string>(),
    onToggleAutoMode: vi.fn(),
    onToggleSelect: vi.fn(),
    onAdvance: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
}

/** Draws the stages, the board cards, the controls, and the gesture buttons the tests drive. */
function StubCanvas(props: WorkflowCanvasProps) {
  useEffect(() => {
    for (const stage of props.stages) props.callbacks.onMeasure(stage.id, { width: stage.width, height: stage.height });
  }, [props.stages]);
  return <div data-testid="canvas" data-ready={String(props.ready)} data-fit={props.fitRequest}>
    {props.stages.map(stage => <section key={stage.id} aria-label={stage.label} data-testid={'stage-' + stage.id} data-x={stage.x} data-y={stage.y} data-w={stage.width} data-h={stage.height}>
      {stage.cardIds.map(cardId => <React.Fragment key={cardId}>{props.cardEnvironment.renderCard(cardId)}</React.Fragment>)}
      <button type="button" aria-label={'drop-' + stage.id} onClick={() => { if (!props.locked) props.onStageMove(stage.id, { x: 42, y: 84 }); }}>drop</button>
      <button type="button" aria-label={'resize-' + stage.id} onClick={() => {
        if (props.locked) return;
        props.onStageResize(stage.id, { width: 400, height: 200 });
        props.onStageResizeEnd(stage.id, { width: 400, height: 200 });
      }}>resize</button>
    </section>)}
    {props.controls !== undefined && props.controls({ zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() })}
    {props.overlay}
  </div>;
}

function setup(overrides: Partial<WorkflowViewProps> = {}) {
  const run = vi.fn(async (_command: Command) => fixture() as KanbanSnapshot);
  const state = boardState();
  let props: WorkflowViewProps = {
    hubId: 'hub-1', boardId: 'board-1', state, tasks: state.tasks, optimistic: null, drag: null,
    beginDrag: vi.fn(), shouldSuppressClick: () => false, run: run as unknown as RunCommand,
    revision: 7, onOpenTask: vi.fn(), onError: vi.fn(), canvas: StubCanvas, card: cardPort(),
    ...overrides,
  };
  const view = render(<WorkflowView {...props} />);
  function update(next: Partial<WorkflowViewProps>) {
    props = { ...props, ...next };
    view.rerender(<WorkflowView {...props} />);
  }
  function applyCommand(command: Command) {
    const saved = (command as unknown as { yaml: string }).yaml;
    const nextState = { ...props.state, workflowYaml: saved, workflow: parseWorkflow(saved) };
    update({ state: nextState, tasks: nextState.tasks });
  }
  return { ...view, run, update, applyCommand, get props() { return props; } };
}

function unlock() {
  fireEvent.click(screen.getByRole('button', { name: 'Unlock layout editing' }));
}

describe('workflow view', () => {
  it('presents each stage with its cards and opens a card', () => {
    const onOpenTask = vi.fn();
    setup({ onOpenTask });
    expect(screen.getByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'One' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open task Alpha' }));
    expect(onOpenTask).toHaveBeenCalledWith('a');
  });

  it('forwards a card pointer gesture to the board drag pipeline', () => {
    const beginDrag = vi.fn();
    setup({ beginDrag });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open task Alpha' }), { button: 0 });
    expect(beginDrag).toHaveBeenCalledWith(expect.anything(), 'a', 'one');
  });

  it('reveals the diagram once every stage has been measured', async () => {
    setup();
    await act(async () => {});
    expect(screen.getByTestId('canvas').dataset['ready']).toBe('true');
  });

  it('starts locked and blocks layout editing until unlocked', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    expect((screen.getByRole('button', { name: 'Organize stages' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).not.toHaveBeenCalled();
  });

  it('stores one workflow save per completed drag', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { type: string; yaml: string; expectedRevision: number };
    expect(command.type).toBe('board.workflow.save');
    expect(command.expectedRevision).toBe(7);
    expect(command.yaml).toContain('position: {x: 42, y: 84}');
  });

  it('coalesces two drags into one save with both positions', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-three' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { yaml: string };
    expect(command.yaml.match(/position: \{x: 42, y: 84\}/g)).toHaveLength(2);
  });

  it('stores one workflow save per completed stage resize', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'resize-one' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { yaml: string };
    expect(command.yaml).toContain('size: {width: 400, height: 200}');
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('400');
  });

  it('undoes and redoes a stored placement through the controls and the keyboard', async () => {
    vi.useFakeTimers();
    const { run, applyCommand } = setup();
    unlock();
    const undo = screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo layout change' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    const saved = run.mock.calls[0]![0] as Command;
    await act(async () => { applyCommand(saved); });
    expect(undo.disabled).toBe(false);
    await act(async () => { fireEvent.click(undo); });
    expect(run).toHaveBeenCalledTimes(2);
    const restored = run.mock.calls[1]![0] as unknown as { yaml: string };
    expect(restored.yaml).not.toContain('position: {x: 42, y: 84}');
    await act(async () => { applyCommand(restored as unknown as Command); });
    expect(redo.disabled).toBe(false);
    await act(async () => { fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true }); });
    expect(run).toHaveBeenCalledTimes(3);
    const redone = run.mock.calls[2]![0] as unknown as { yaml: string };
    expect(redone.yaml).toContain('position: {x: 42, y: 84}');
  });

  it('stores every stage placement when organized and undoes it as one step', async () => {
    vi.useFakeTimers();
    const { run, applyCommand } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Organize stages' })); });
    expect(run).toHaveBeenCalledTimes(1);
    const organized = run.mock.calls[0]![0] as unknown as { yaml: string };
    expect(organized.yaml.match(/position:/g)?.length).toBe(3);
    await act(async () => { applyCommand(organized as unknown as Command); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(run).toHaveBeenCalledTimes(2);
    const restored = run.mock.calls[1]![0] as unknown as { yaml: string };
    expect(restored.yaml.match(/position:/g)?.length).toBe(1);
  });

  it('does not add a history entry for a card move', async () => {
    const view = setup();
    unlock();
    const moved: BoardState = { ...view.props.state, tasks: [task('a', 'Alpha', 'two'), task('b', 'Beta', 'two')] };
    await act(async () => { view.update({ state: moved, tasks: moved.tasks }); });
    expect((screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a pending save on the board that scheduled it', async () => {
    vi.useFakeTimers();
    const { run, update } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    const other = boardState();
    other.workflowYaml = ['name: Other', 'columns:', '  - id: alpha', '    label: Alpha', ''].join(String.fromCharCode(10));
    other.workflow = parseWorkflow(other.workflowYaml);
    other.tasks = [task('c', 'Gamma', 'alpha')];
    await act(async () => { update({ boardId: 'board-2', revision: 9, state: other, tasks: other.tasks }); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { boardId: string; expectedRevision: number; yaml: string };
    expect(command.boardId).toBe('board-1');
    // The revision is Hub-scoped and this view only knows the latest one it saw.
    expect(command.expectedRevision).toBe(9);
    expect(command.yaml).toContain('id: one');
    expect(command.yaml).not.toContain('alpha');
  });

  it('flushes a completed drag when the view unmounts before the debounce', async () => {
    vi.useFakeTimers();
    const { run, unmount } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { unmount(); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { boardId: string; yaml: string };
    expect(command.boardId).toBe('board-1');
    expect(command.yaml).toContain('position: {x: 42, y: 84}');
  });

  it('restores the stage size when undoing before the save lands', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'resize-one' })); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('400');
    // Undo before the coalesced resize save is dispatched.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('264');
    await act(async () => { vi.advanceTimersByTime(400); });
    // The resize was never stored, so reverting it needs no workflow save.
    expect(run).not.toHaveBeenCalled();
  });

  it('does not leave a size override that masks a later acknowledged size', async () => {
    vi.useFakeTimers();
    const { update, props } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'resize-one' })); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('400');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('264');
    await act(async () => { vi.advanceTimersByTime(400); });
    const sized = ['name: Delivery', 'columns:', '  - id: one', '    label: One', '    size: {width: 500, height: 300}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));
    const external = { ...props.state, workflowYaml: sized, workflow: parseWorkflow(sized) };
    await act(async () => { update({ state: external, tasks: external.tasks }); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('500');
  });

  it('lets an acknowledged size win over an undone resize', async () => {
    vi.useFakeTimers();
    const sized = ['name: Delivery', 'columns:', '  - id: one', '    label: One', '    size: {width: 400, height: 300}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));
    const state: BoardState = { ...boardState(), workflowYaml: sized, workflow: parseWorkflow(sized) };
    const { run, applyCommand, update, props } = setup({ state, tasks: state.tasks });
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'resize-one' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => { applyCommand(run.mock.calls[0]![0] as Command); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('400');
    // Undo the resize, then let another editor publish a larger size before the
    // compensating save is acknowledged.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('400');
    const externalYaml = sized.replace('size: {width: 400, height: 300}', 'size: {width: 500, height: 300}');
    const external = { ...props.state, revision: 8, workflowYaml: externalYaml, workflow: parseWorkflow(externalYaml) };
    await act(async () => { update({ state: external, revision: 8, tasks: external.tasks }); });
    expect(screen.getByTestId('stage-one').dataset['w']).toBe('500');
  });

  it('restores the previous diagram layout when undoing Organize after a resize', async () => {
    setup();
    unlock();
    const xOf = (id: string) => Number(screen.getByTestId('stage-' + id).dataset['x']);
    const initial = xOf('two');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'resize-one' })); });
    expect(xOf('two')).toBe(initial);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Organize stages' })); });
    const organized = xOf('two');
    expect(organized).toBeGreaterThan(initial);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(xOf('two')).toBe(initial);
  });

  it('rebases a pending layout edit onto a workflow acknowledged mid-edit', async () => {
    vi.useFakeTimers();
    const { run, update, props } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    // Another editor renames the workflow and changes its revision before the
    // coalesced layout save is dispatched.
    const externalYaml = ['name: External delivery', 'columns:', '  - id: one', '    label: One', '    position: {x: 0, y: 0}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));
    const external = { ...props.state, revision: 8, workflowYaml: externalYaml, workflow: parseWorkflow(externalYaml) };
    await act(async () => { update({ state: external, revision: 8, tasks: external.tasks }); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { yaml: string; expectedRevision: number };
    expect(command.expectedRevision).toBe(8);
    expect(command.yaml).toContain('name: External delivery');
    expect(command.yaml).toContain('position: {x: 42, y: 84}');
  });

  it('yields a drag override to an external stored position', async () => {
    vi.useFakeTimers();
    const { run, applyCommand, update, props } = setup();
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => { applyCommand(run.mock.calls[0]![0] as Command); });
    expect(Number(screen.getByTestId('stage-two').dataset['x'])).toBe(42);
    const externalYaml = ['name: Delivery', 'columns:', '  - id: one', '    label: One', '    position: {x: 0, y: 0}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '    position: {x: 999, y: 999}', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));
    const external = { ...props.state, workflowYaml: externalYaml, workflow: parseWorkflow(externalYaml) };
    await act(async () => { update({ state: external, tasks: external.tasks }); });
    expect(Number(screen.getByTestId('stage-two').dataset['x'])).toBe(999);
  });

  it('queues a compensating save when Undo lands while a save is in flight', async () => {
    vi.useFakeTimers();
    const pending = deferred<KanbanSnapshot>();
    const calls: Command[] = [];
    const customRun = vi.fn(async (command: Command) => { calls.push(command); return pending.promise; });
    const { props } = setup({ run: customRun as unknown as RunCommand });
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(calls).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout change' })); });
    expect(calls).toHaveLength(1);
    const acknowledged = fixture() as KanbanSnapshot;
    acknowledged.state.hubs[0]!.revision = props.revision + 1;
    await act(async () => { pending.resolve(acknowledged); });
    await act(async () => {});
    expect(calls).toHaveLength(2);
    const compensating = calls[1] as unknown as { yaml: string; expectedRevision: number; boardId: string };
    expect(compensating.boardId).toBe('board-1');
    expect(compensating.expectedRevision).toBe(props.revision + 1);
    expect(compensating.yaml).not.toContain('position: {x: 42, y: 84}');
  });

  it('rolls back a failed placement save to the acknowledged workflow', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const customRun = vi.fn(async (_command: Command): Promise<KanbanSnapshot> => { throw { code: 'STALE_REVISION', message: 'The revision changed.' }; });
    setup({ run: customRun as unknown as RunCommand, onError });
    unlock();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => {});
    expect(onError).toHaveBeenCalled();
    expect(Number(screen.getByTestId('stage-two').dataset['x'])).toBe(392);
    expect((screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('presents the optimistic destination before the move confirms', () => {
    setup({ optimistic: { taskId: 'a', columnId: 'two', placement: 'start' } });
    expect(within(screen.getByTestId('stage-two')).getByRole('button', { name: 'Open task Alpha' })).toBeTruthy();
    expect(within(screen.getByTestId('stage-one')).queryByRole('button', { name: 'Open task Alpha' })).toBeNull();
  });

  it('presents only the cards given by the shared filter', () => {
    const state = boardState();
    setup({ tasks: state.tasks.filter(candidate => candidate.id === 'a') });
    expect(screen.getByRole('button', { name: 'Open task Alpha' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open task Beta' })).toBeNull();
  });

  it('does not travel a card hidden by the filter', async () => {
    const view = setup({ tasks: [] });
    const moved: BoardState = { ...view.props.state, tasks: [task('a', 'Alpha', 'two'), task('b', 'Beta', 'two')] };
    await act(async () => { view.update({ state: moved, tasks: [] }); });
    expect(document.querySelector('.kb-flow-travel-card')).toBeNull();
  });

  it('restores a stored placement when the diagram opens', () => {
    const stored = boardState();
    stored.workflowYaml = ['name: Delivery', 'columns:', '  - id: one', '    label: One', '    position: {x: 0, y: 0}', '    allowed_transitions: [two, three]', '  - id: two', '    label: Two', '    position: {x: 111, y: 222}', '  - id: three', '    label: Three', '    allowed_transitions: []', ''].join(String.fromCharCode(10));
    stored.workflow = parseWorkflow(stored.workflowYaml);
    setup({ state: stored, tasks: stored.tasks });
    const two = screen.getByTestId('stage-two');
    expect(two.dataset['x']).toBe('111');
    expect(two.dataset['y']).toBe('222');
  });

  it('presents a travelling card when a task changes stage', async () => {
    const view = setup();
    const moved: BoardState = { ...view.props.state, tasks: [task('a', 'Alpha', 'two'), task('b', 'Beta', 'two')] };
    await act(async () => { view.update({ state: moved, tasks: moved.tasks }); });
    expect(document.querySelector('.kb-flow-travel-card')?.textContent).toBe('Alpha');
  });
});
