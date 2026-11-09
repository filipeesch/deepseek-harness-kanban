// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BoardView } from '../../src/client/board.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { EMPTY_STAGE_COPY } from '../../src/client/board-copy.js';
import { fakeApi, fixture, openFilterPopoverByClick, type TestSnapshot } from './helpers.js';

vi.mock('../../src/client/workflow-view/canvas.js', async () => {
  const React = await import('react');
  // The real header, so the creation action a test drives is the one the canvas paints.
  const { StageHeader } = await import('../../src/client/workflow-view/stage-node.js');
  const { EMPTY_STAGE_COPY } = await import('../../src/client/board-copy.js');
  type StubProps = {
    stages: Array<{ id: string; label: string; width: number; height: number; cardIds: string[]; creatable: boolean }>;
    locked: boolean;
    ready: boolean;
    callbacks: { onMeasure: (id: string, size: { width: number; height: number }) => void; onCreateTask?: () => void };
    cardEnvironment: { renderCard: (taskId: string) => React.ReactNode };
    controls?: (viewport: { zoomIn: () => void; zoomOut: () => void; fit: () => void }) => React.ReactNode;
    onStageMove: (id: string, position: { x: number; y: number }) => void;
  };
  return {
    WorkflowCanvas: (props: StubProps) => {
      React.useEffect(() => { for (const stage of props.stages) props.callbacks.onMeasure(stage.id, { width: 200, height: 100 }); }, []);
      return React.createElement('div', { 'data-testid': 'flow-canvas' },
        props.stages.map(stage => React.createElement('div', { key: stage.id, 'data-testid': 'flow-stage-' + stage.id },
          React.createElement(StageHeader, {
            id: stage.id,
            label: stage.label,
            cardCount: stage.cardIds.length,
            locked: props.locked,
            creatable: stage.creatable,
            onCreateTask: props.callbacks.onCreateTask,
          }),
          stage.cardIds.map(cardId => React.createElement(React.Fragment, { key: cardId }, props.cardEnvironment.renderCard(cardId))),
          stage.cardIds.length === 0 && React.createElement('p', { className: 'kb-empty-column' }, EMPTY_STAGE_COPY),
          React.createElement('button', { key: 'move', type: 'button', 'aria-label': 'move ' + stage.label, onClick: () => { if (!props.locked) props.onStageMove(stage.id, { x: 5, y: 6 }); } }, 'move'),
        )),
        props.controls?.({ zoomIn: () => {}, zoomOut: () => {}, fit: () => {} }),
      );
    },
  };
});

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const workflowYaml = ['name: Delivery', 'default_view: workflow', 'initial_column: intake', 'columns:', '  - id: intake', '    label: Intake', '  - id: doing', '    label: Doing', '  - id: review', '    label: Review', ''].join(String.fromCharCode(10));

function withDefault(data: TestSnapshot): TestSnapshot {
  const board = data.state.hubs[0]!.boards[0]!;
  board.workflowYaml = workflowYaml;
  board.workflow = parseWorkflow(workflowYaml);
  return data;
}

function mount(data = fixture()) {
  const mock = fakeApi(data);
  const view = render(<BoardView api={mock.api} renderConversation={() => <div />} />);
  return { ...mock, ...view };
}

describe('board presentation selection', () => {
  it('keeps the filter control and its active filter in the workflow diagram', async () => {
    mount(withDefault(fixture()));
    await screen.findByTestId('flow-canvas');
    openFilterPopoverByClick();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'documentation' } });
    expect(screen.getByRole('button', { name: /^Filter tasks, filtering by search text/ })).toBeTruthy();
    const cards = [...screen.getByTestId('flow-canvas').querySelectorAll('[data-task-id]')];
    expect(cards.map(card => card.getAttribute('data-task-id'))).toEqual(['t2']);
  });

  it('opens the column board when the workflow configures no default', async () => {
    mount();
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Workflow diagram' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the workflow diagram when the workflow configures it', async () => {
    mount(withDefault(fixture()));
    expect(await screen.findByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    expect(screen.getByTestId('flow-canvas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workflow' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches presentations without sending a command', async () => {
    const { command } = mount();
    await screen.findByRole('region', { name: 'Intake column' });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(await screen.findByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });

  it('resets the diagram state when switching boards', async () => {
    const data = withDefault(fixture());
    const hub = data.state.hubs[0]!;
    const secondYaml = ['name: Second flow', 'default_view: workflow', 'columns:', '  - id: intake', '    label: Second intake', '  - id: doing', '    label: Second doing', ''].join(String.fromCharCode(10));
    hub.boards.push({ id: 'board-2', name: 'Second', workflowYaml: secondYaml, workflow: parseWorkflow(secondYaml), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    mount(data);
    await screen.findByRole('region', { name: 'Workflow diagram' });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock layout editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'move Intake' }));
    expect((screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(await screen.findByText('Second intake')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Undo layout change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses each board default when switching in both directions', async () => {
    const data = fixture();
    const hub = data.state.hubs[0]!;
    const flowYaml = ['name: Second flow', 'default_view: workflow', 'columns:', '  - id: intake', '    label: Second intake', '  - id: doing', '    label: Second doing', ''].join(String.fromCharCode(10));
    hub.boards.push({ id: 'board-2', name: 'Second', workflowYaml: flowYaml, workflow: parseWorkflow(flowYaml), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    mount(data);
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(await screen.findByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Delivery/ }));
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
  });

  it('returns focus to the diagram card after closing the drawer', async () => {
    mount(withDefault(fixture()));
    await screen.findByRole('button', { name: 'Open task Alpha task' });
    await act(async () => {});
    const card = screen.getByRole('button', { name: 'Open task Alpha task' });
    fireEvent.click(card);
    await act(async () => {});
    await screen.findByRole('heading', { name: 'Alpha task', level: 2 });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('remembers the chosen presentation after a remount', async () => {
    const data = withDefault(fixture());
    const first = mount(data);
    await screen.findByRole('region', { name: 'Workflow diagram' });
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    await screen.findByRole('region', { name: 'Intake column' });
    first.unmount();
    mount(data);
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
  });

  it('keeps each board own choice', async () => {
    const data = withDefault(fixture());
    const hub = data.state.hubs[0]!;
    const secondYaml = ['name: Second flow', 'default_view: workflow', 'columns:', '  - id: intake', '    label: Second intake', '  - id: doing', '    label: Second doing', ''].join(String.fromCharCode(10));
    hub.boards.push({ id: 'board-2', name: 'Second', workflowYaml: secondYaml, workflow: parseWorkflow(secondYaml), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    const first = mount(data);
    await screen.findByRole('region', { name: 'Workflow diagram' });
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    await screen.findByRole('region', { name: 'Intake column' });
    first.unmount();
    mount(data);
    await screen.findByRole('region', { name: 'Intake column' });
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(await screen.findByRole('region', { name: 'Workflow diagram' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Delivery/ }));
    expect(await screen.findByRole('region', { name: 'Intake column' })).toBeTruthy();
  });
});

describe('creating a task from the workflow diagram', () => {
  it('offers the creation action on the initial stage alone', async () => {
    mount(withDefault(fixture()));
    await screen.findByTestId('flow-canvas');
    expect(within(screen.getByTestId('flow-stage-intake')).getByRole('button', { name: 'New task' })).toBeTruthy();
    expect(within(screen.getByTestId('flow-stage-doing')).queryByRole('button', { name: 'New task' })).toBeNull();
    expect(within(screen.getByTestId('flow-stage-review')).queryByRole('button', { name: 'New task' })).toBeNull();
  });

  it('opens the board dialog the column board action opens, and creates there', async () => {
    const user = userEvent.setup();
    const { command } = mount(withDefault(fixture()));
    await screen.findByTestId('flow-canvas');
    await user.click(screen.getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'From the diagram');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project' }), 'p1');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'task.create', projectId: 'p1', title: 'From the diagram', description: '' }));
    // The created task belongs to the board, not to the presentation that asked for it.
    expect(await screen.findByRole('button', { name: 'Open task From the diagram' })).toBeTruthy();
  });

  it('withholds the action from both presentations when only unadopted placeholders exist', async () => {
    // A placeholder names a project a received board mentioned; it owns no directory,
    // so no task can be created in it and the action must not promise one.
    const data = withDefault(fixture());
    data.state.projects = [{ id: 'p1', projectKey: 'p1', name: 'API', origin: 'published' }];
    mount(data);
    await screen.findByTestId('flow-canvas');
    const diagram = within(screen.getByTestId('flow-stage-intake')).getByRole('button', { name: 'New task' }) as HTMLButtonElement;
    expect(diagram.disabled).toBe(true);
    fireEvent.click(diagram);
    expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull();
    // One creation instance, so the other presentation answers the same way.
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    await screen.findByRole('region', { name: 'Intake column' });
    expect((screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the diagram action available when only the board refuses, and says why', async () => {
    // The Hub can own a task; this board declined every project. Disabling the action
    // here would hide the only text that explains the refusal and names the remedy.
    const data = withDefault(fixture());
    data.state.hubs[0]!.boards[0]!.allowedProjectKeys = [];
    const user = userEvent.setup();
    mount(data);
    await screen.findByTestId('flow-canvas');
    const action = within(screen.getByTestId('flow-stage-intake')).getByRole('button', { name: 'New task' }) as HTMLButtonElement;
    expect(action.disabled).toBe(false);
    await user.click(action);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByText(/accepts no new task/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the diagram dialog only the projects the board allows', async () => {
    const data = withDefault(fixture());
    data.state.hubs[0]!.boards[0]!.allowedProjectKeys = ['p1'];
    const user = userEvent.setup();
    mount(data);
    await screen.findByTestId('flow-canvas');
    await user.click(within(screen.getByTestId('flow-stage-intake')).getByRole('button', { name: 'New task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).getAllByRole('option').map(option => option.textContent)).toEqual(['Select a project', 'API']);
  });

  it('keeps the action offering the first card when a real search empties the stage', async () => {
    mount(withDefault(fixture()));
    await screen.findByTestId('flow-canvas');
    openFilterPopoverByClick();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'no task carries this text' } });
    const stage = screen.getByTestId('flow-stage-intake');
    await waitFor(() => expect(within(stage).getByText(EMPTY_STAGE_COPY)).toBeTruthy());
    // The stage shows nothing, yet it still offers the way to make the first card:
    // emptiness is a projection of the cards, never a judgement about creating.
    expect((within(stage).getByRole('button', { name: 'New task' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('hands focus to the shared dialog and back to the diagram action', async () => {
    const user = userEvent.setup();
    mount(withDefault(fixture()));
    await screen.findByTestId('flow-canvas');
    const action = within(screen.getByTestId('flow-stage-intake')).getByRole('button', { name: 'New task' });
    action.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    // Keyboard activation reaches a real modal, not a stubbed callback: the keyboard
    // goes into the dialog, which is what a keyboard user needs to fill it in.
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    // And comes back to the control that opened it, so the tab order stays where the
    // user left it instead of dropping to the top of the document.
    expect(document.activeElement).toBe(action);
  });
});
