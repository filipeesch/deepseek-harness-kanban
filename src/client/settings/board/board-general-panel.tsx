import React from 'react';
import type { Board, HubState } from '../../../shared/types.js';
import type { RunCommand } from '../../ui.js';
import { BoardIdentityForm } from './board-identity-form.js';

/** The board's display name, in its own panel. */
export function BoardGeneralPanel({ hub, board, run, onDirtyChange }: { hub: HubState; board: Board; run: RunCommand; onDirtyChange?: (dirty: boolean) => void }) {
  return <BoardIdentityForm hub={hub} board={board} run={run} {...(onDirtyChange === undefined ? {} : { onDirtyChange })} />;
}
