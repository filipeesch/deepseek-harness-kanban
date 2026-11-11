// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoardCard } from '../../src/client/board-card.js';
import { AutoRunController } from '../../src/client/auto-run.js';
import { EMPTY_ATTENTION, type Task, type Workflow } from '../../src/shared/types.js';
import { fixture } from './helpers.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const task: Task = { ...fixture().state.tasks[0]!, title: 'Alpha task', columnId: 'todo', operation: null, pendingTransition: undefined };

function workflowWith(allowedTransitions: Workflow['columns'][number]['allowedTransitions']): Workflow {
  return {
    name: 'Flow',
    initialColumnId: 'todo',
    columns: [
      { id: 'todo', name: 'Todo', ...(allowedTransitions === undefined ? {} : { allowedTransitions }) },
      { id: 'plan', name: 'Plan' },
      { id: 'done', name: 'Done' },
    ],
    groups: [],
  };
}

function renderCard(workflow: Workflow) {
  return render(<BoardCard
    task={task}
    column={workflow.columns[0]!}
    projectName="API"
    attention={EMPTY_ATTENTION}
    workflow={workflow}
    selectionMode={false}
    selected={false}
    autoRun={new AutoRunController({ run: async () => fixture() })}
    autoModePending={false}
    onToggleAutoMode={vi.fn()}
    onOpen={vi.fn()}
    onToggleSelect={vi.fn()}
    onBeginDrag={vi.fn()}
    shouldSuppressClick={() => false}
    onMoveTask={vi.fn()}
  />);
}

describe('card advance destination', () => {
  it('offers the following stage for a stage that permits any other stage', () => {
    renderCard(workflowWith(undefined));
    expect(screen.getByRole('button', { name: /Plan/ })).toBeTruthy();
  });

  it('keeps offering the following stage for a restricted stage, as it did before', () => {
    renderCard(workflowWith([{ to: 'done' }]));
    expect(screen.getByRole('button', { name: /Plan/ })).toBeTruthy();
  });

  it('omits the advance action for a stage that permits no destination', () => {
    renderCard(workflowWith([]));
    // The next stage exists in workflow order, but the stage permits no destination.
    expect(screen.queryByRole('button', { name: /Advance to/ })).toBeNull();
    expect(document.querySelector('.kb-card-action')).toBeNull();
  });
});
