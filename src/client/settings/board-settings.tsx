import React, { useCallback, useEffect, useId, useState } from 'react';
import type { Board, BoardState, ClientApi, HubSharingView, HubState } from '../../shared/types.js';
import { useSharingActions } from '../sharing/actions.js';
import { canPublishBoard } from '../sharing/status.js';
import { Tabs, type RunCommand } from '../ui.js';
import type { NativeSeat } from '../native-slot-host.js';
import { BoardDangerPanel } from './board/board-danger-panel.js';
import { BoardDefaultsPanel } from './board/board-defaults-panel.js';
import { BoardGeneralPanel } from './board/board-general-panel.js';
import { BoardProjectsPanel } from './board/board-projects-panel.js';
import { BoardWorkflowPanel } from './board/board-workflow-panel.js';

const SECTIONS = ['General', 'Projects', 'Defaults', 'Workflow', 'Danger zone'] as const;
export type BoardSection = (typeof SECTIONS)[number];

/** Which panels can hold a draft the container's leave guard must protect. */
const DRAFT_SECTIONS: ReadonlySet<BoardSection> = new Set(['General', 'Projects', 'Defaults']);

export interface BoardSettingsProps {
  state: BoardState;
  hub: HubState | null;
  board: Board;
  run: RunCommand;
  api?: ClientApi;
  sharing?: HubSharingView;
  onDeleted?: () => void;
  workflowDraft: { yaml: string; revision: number } | null;
  setWorkflowDraft: React.Dispatch<React.SetStateAction<{ yaml: string; revision: number } | null>>;
  /** The native slot registry for the board's model selector; absent in isolated harnesses. */
  nativeSeat?: NativeSeat;
  /** Report whether any board panel holds unsaved edits, for the shell's leave guard. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The Board section of Configuration: five focused panels behind one sub-tab row.
 *
 * Each panel owns its own form and reports only its own draft. The container owns
 * the navigation, so leaving a panel that would lose its draft asks first; the
 * Workflow draft already lives above the panel and survives every switch, so
 * leaving Workflow neither asks nor discards. Saving a panel never touches
 * another panel's draft.
 */
export function BoardSettings({ state, hub, board, run, api, sharing, onDeleted, workflowDraft, setWorkflowDraft, nativeSeat, onDirtyChange }: BoardSettingsProps) {
  const id = useId();
  const [active, setActive] = useState<BoardSection>('General');
  const [pending, setPending] = useState<BoardSection | null>(null);
  const [dirty, setDirty] = useState<Record<BoardSection, boolean>>({ General: false, Projects: false, Defaults: false, Workflow: false, 'Danger zone': false });
  const share = useSharingActions(api);
  const onShare = hub !== null && api !== undefined && canPublishBoard(sharing, board.id) ? async () => {
    const failure = await share.run('publish-board', { type: 'sharing.publishBoard', hubId: hub.id, boardId: board.id });
    if (failure !== null) throw failure;
  } : undefined;
  const workflowEditing = workflowDraft !== null && workflowDraft.yaml !== state.workflowYaml;

  const mark = useCallback((section: BoardSection) => (value: boolean): void => {
    setDirty(previous => previous[section] === value ? previous : { ...previous, [section]: value });
  }, []);
  // Report the aggregate so the shell can guard leaving Board and closing the dialog.
  useEffect(() => {
    onDirtyChange?.([...DRAFT_SECTIONS].some(section => dirty[section]));
  }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  function request(next: BoardSection): void {
    if (next === active) return;
    // The workflow draft is retained above the panel, so leaving it loses nothing.
    if (DRAFT_SECTIONS.has(active) && dirty[active]) { setPending(next); return; }
    setActive(next);
  }
  function discardAndContinue(): void {
    if (pending === null) return;
    const next = pending;
    setPending(null);
    setDirty(previous => ({ ...previous, [active]: false }));
    setActive(next);
  }

  if (hub === null) return null;
  const panel = active === 'General' ? <BoardGeneralPanel hub={hub} board={board} run={run} onDirtyChange={mark('General')} />
    : active === 'Projects' ? <BoardProjectsPanel state={state} hub={hub} board={board} run={run} onDirtyChange={mark('Projects')} />
    : active === 'Defaults' ? <BoardDefaultsPanel
        hub={hub} board={board} run={run} {...(api === undefined ? {} : { api })}
        yaml={state.workflowYaml} baseRevision={state.revision} workflowEditing={workflowEditing}
        onOpenWorkflow={() => request('Workflow')} onDirtyChange={mark('Defaults')}
        {...(nativeSeat === undefined ? {} : { seat: nativeSeat })}
      />
    : active === 'Workflow' ? <BoardWorkflowPanel
        state={state} run={run} hubId={hub.id} boardId={board.id}
        yaml={workflowDraft?.yaml ?? state.workflowYaml}
        baseRevision={workflowDraft?.revision ?? state.revision}
        onYamlChange={yaml => setWorkflowDraft(current => current ? { ...current, yaml } : { yaml, revision: state.revision })}
        onSaved={() => setWorkflowDraft(null)}
        onReload={() => setWorkflowDraft(null)}
        {...(onShare === undefined ? {} : { onShare })}
      />
    : <BoardDangerPanel state={state} hub={hub} board={board} run={run} {...(sharing === undefined ? {} : { sharing })} {...(onDeleted === undefined ? {} : { onDeleted })} />;

  return <div className="kb-form kb-board-settings">
    <Tabs label="Board configuration sections" values={SECTIONS} selected={active} onSelect={value => request(value as BoardSection)} id={id} />
    {pending !== null && <div className="kb-inline-confirm" role="alertdialog" aria-label="Discard board panel changes">
      <p>Leave {active} and discard its unsaved changes?</p>
      <div className="kb-actions">
        <button type="button" className="kb-button" onClick={() => setPending(null)}>Keep editing</button>
        <button type="button" className="kb-button kb-danger" onClick={discardAndContinue}>Discard and continue</button>
      </div>
    </div>}
    <section className="kb-board-panel" role="tabpanel" id={id + '-panel-' + active} aria-labelledby={id + '-tab-' + active}>
      {panel}
    </section>
  </div>;
}
