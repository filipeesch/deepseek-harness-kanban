// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardState, KanbanSnapshot, Command } from '../../src/shared/types.js';
import type { RunCommand } from '../../src/client/ui.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { WorkflowView, type WorkflowViewProps } from '../../src/client/workflow-view/workflow-view.js';
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

function StubCanvas(props: WorkflowCanvasProps) {
  useEffect(() => {
    for (const stage of props.stages) props.callbacks.onMeasure(stage.id, { width: 264, height: 120 });
  }, []);
  return <div data-testid="canvas" data-ready={String(props.ready)} data-fit={props.fitRequest}>
    {props.stages.map(stage => <section key={stage.id} aria-label={stage.label} data-testid={'stage-' + stage.id} data-x={stage.x} data-y={stage.y}>
      {stage.cards.map(card => <button key={card.id} type="button" onPointerDown={event => props.callbacks.onCardPointerDown(event, card.id, stage.id)} onClick={() => props.callbacks.onOpenCard(card.id)}>{card.title}</button>)}
      <button type="button" aria-label={'drop-' + stage.id} onClick={() => props.onStageMove(stage.id, { x: 42, y: 84 })}>drop</button>
      <button type="button" aria-label={'resize-' + stage.id} onClick={() => props.callbacks.onMeasure(stage.id, { width: 400, height: 120 })}>resize</button>
    </section>)}
    {props.overlay}
  </div>;
}

function setup(overrides: Partial<WorkflowViewProps> = {}) {
  const run = vi.fn(async (_command: Command) => fixture() as KanbanSnapshot);
  const state = boardState();
  let props: WorkflowViewProps = {
    hubId: 'hub-1', boardId: 'board-1', state, tasks: state.tasks, attention: {}, optimistic: null, drag: null,
    beginDrag: vi.fn(), shouldSuppressClick: () => false, run: run as unknown as RunCommand,
    revision: 7, onOpenTask: vi.fn(), onError: vi.fn(), canvas: StubCanvas,
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

describe('workflow view', () => {
  it('presents each stage with its cards and opens a card', () => {
    const onOpenTask = vi.fn();
    setup({ onOpenTask });
    expect(screen.getByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'One' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onOpenTask).toHaveBeenCalledWith('a');
  });

  it('forwards a card pointer gesture to the board drag pipeline', () => {
    const beginDrag = vi.fn();
    setup({ beginDrag });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Alpha' }), { button: 0 });
    expect(beginDrag).toHaveBeenCalledWith(expect.anything(), 'a', 'one');
  });

  it('reveals the diagram once every stage has been measured', async () => {
    setup();
    await act(async () => {});
    expect(screen.getByTestId('canvas').dataset['ready']).toBe('true');
  });

  it('stores one workflow save per completed drag', async () => {
    vi.useFakeTimers();
    const { run } = setup();
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-three' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { yaml: string };
    expect(command.yaml.match(/position: \{x: 42, y: 84\}/g)).toHaveLength(2);
  });

  it('undoes and redoes a stored placement through the controls and the keyboard', async () => {
    vi.useFakeTimers();
    const { run, applyCommand } = setup();
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Organize' })); });
    expect(run).toHaveBeenCalledTimes(1);
    const organized = run.mock.calls[0]![0] as unknown as { yaml: string };
    expect(organized.yaml.match(/position:/g)?.length).toBe(3);
    await act(async () => { applyCommand(organized as unknown as Command); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(run).toHaveBeenCalledTimes(2);
    const restored = run.mock.calls[1]![0] as unknown as { yaml: string };
    expect(restored.yaml.match(/position:/g)?.length).toBe(1);
  });

  it('does not add a history entry for a card move', async () => {
    const view = setup();
    const moved: BoardState = { ...view.props.state, tasks: [task('a', 'Alpha', 'two'), task('b', 'Beta', 'two')] };
    await act(async () => { view.update({ state: moved, tasks: moved.tasks }); });
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a pending save on the board that scheduled it', async () => {
    vi.useFakeTimers();
    const { run, update } = setup();
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { unmount(); });
    expect(run).toHaveBeenCalledTimes(1);
    const command = run.mock.calls[0]![0] as unknown as { boardId: string; yaml: string };
    expect(command.boardId).toBe('board-1');
    expect(command.yaml).toContain('position: {x: 42, y: 84}');
  });

  it('restores the previous diagram layout when undoing Organize after a resize', async () => {
    setup();
    const xOf = (id: string) => Number(screen.getByTestId('stage-' + id).dataset['x']);
    const initial = xOf('two');
    fireEvent.click(screen.getByRole('button', { name: 'resize-one' }));
    await act(async () => {});
    expect(xOf('two')).toBe(initial);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Organize' })); });
    const organized = xOf('two');
    expect(organized).toBeGreaterThan(initial);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(xOf('two')).toBe(initial);
  });

  it('yields a drag override to an external stored position', async () => {
    vi.useFakeTimers();
    const { run, applyCommand, update, props } = setup();
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(calls).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'drop-two' })); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => {});
    expect(onError).toHaveBeenCalled();
    expect(Number(screen.getByTestId('stage-two').dataset['x'])).toBe(392);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('presents the optimistic destination before the move confirms', () => {
    setup({ optimistic: { taskId: 'a', columnId: 'two', placement: 'start' } });
    expect(within(screen.getByTestId('stage-two')).getByRole('button', { name: 'Alpha' })).toBeTruthy();
    expect(within(screen.getByTestId('stage-one')).queryByRole('button', { name: 'Alpha' })).toBeNull();
  });

  it('presents only the cards given by the shared filter', () => {
    const state = boardState();
    setup({ tasks: state.tasks.filter(candidate => candidate.id === 'a') });
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Beta' })).toBeNull();
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
