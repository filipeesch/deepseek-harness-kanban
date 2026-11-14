import React from 'react';
import type { BoardState, KanbanSnapshot } from '../../../shared/types.js';
import type { RunCommand } from '../../ui.js';
import { WorkflowEditor } from '../../workflow-editor.js';

export interface BoardWorkflowPanelProps {
  state: BoardState;
  run: RunCommand;
  hubId: string;
  boardId: string;
  yaml: string;
  baseRevision: number;
  onYamlChange: (yaml: string) => void;
  onSaved: (snapshot: KanbanSnapshot) => void;
  onReload: () => void;
  onShare?: () => Promise<void>;
}

/** The active board's workflow document, given the whole panel while it is open. */
export function BoardWorkflowPanel(props: BoardWorkflowPanelProps) {
  return <WorkflowEditor {...props} />;
}
