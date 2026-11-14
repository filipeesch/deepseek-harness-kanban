import React from 'react';
import type { Board, BoardState, HubState } from '../../../shared/types.js';
import type { RunCommand } from '../../ui.js';
import { BoardProjectScopeForm } from './board-project-scope-form.js';

/** Which projects may create tasks on the board, in its own panel. */
export function BoardProjectsPanel({ state, hub, board, run, onDirtyChange }: { state: BoardState; hub: HubState; board: Board; run: RunCommand; onDirtyChange?: (dirty: boolean) => void }) {
  return <BoardProjectScopeForm state={state} hub={hub} board={board} run={run} {...(onDirtyChange === undefined ? {} : { onDirtyChange })} />;
}
