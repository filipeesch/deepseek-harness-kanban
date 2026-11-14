import React from 'react';
import type { Board, BoardState, HubSharingView, HubState } from '../../../shared/types.js';
import type { RunCommand } from '../../ui.js';
import { BoardDeletionControl } from './board-deletion-control.js';

/** Deleting the board, isolated from the forms that edit it. */
export function BoardDangerPanel({ state, hub, board, sharing, run, onDeleted }: {
  state: BoardState;
  hub: HubState;
  board: Board;
  sharing?: HubSharingView;
  run: RunCommand;
  onDeleted?: () => void;
}) {
  return <div className="kb-form" role="group" aria-label="Board danger zone">
    <h3>Danger zone</h3>
    <p className="kb-hint">Deleting the board removes its workflow. Its tasks must be removed first; projects, worktrees, conversations, and workspaces are kept.</p>
    <BoardDeletionControl state={state} hub={hub} board={board} run={run} onDeleted={onDeleted} {...(sharing === undefined ? {} : { sharing })} />
  </div>;
}
