// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardView } from '../../src/client/board.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { fakeApi, fixture, openFilterPopoverByClick, type TestSnapshot } from './helpers.js';

vi.mock('../../src/client/workflow-view/canvas.js', async () => {
  const React = await import('react');
  type StubProps = {
    stages: Array<{ id: string; label: string; width: number; height: number; cardIds: string[] }>;
    locked: boolean;
    ready: boolean;
    callbacks: { onMeasure: (id: string, size: { width: number; height: number }) => void };
    cardEnvironment: { renderCard: (taskId: string) => React.ReactNode };
    controls?: (viewport: { zoomIn: () => void; zoomOut: () => void; fit: () => void }) => React.ReactNode;
    onStageMove: (id: string, position: { x: number; y: number }) => void;
  };
  return {
    WorkflowCanvas: (props: StubProps) => {
      React.useEffect(() => { for (const stage of props.stages) props.callbacks.onMeasure(stage.id, { width: 200, height: 100 }); }, []);
      return React.createElement('div', { 'data-testid': 'flow-canvas' },
        props.stages.map(stage => React.createElement('div', { key: stage.id },
          stage.label,
          stage.cardIds.map(cardId => React.createElement(React.Fragment, { key: cardId }, props.cardEnvironment.renderCard(cardId))),
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
