import React from 'react';
import type { Board, HubSharingView, HubState } from '../shared/types.js';
import { EMPTY_SCOPE_ACTIVITY, type ScopeActivity } from './scope-activity.js';
import { RunningTasksBadge } from './running-tasks-badge.js';
import { PlusIcon } from './icons.js';
import { BoardPublishingBadge, HubPublishingBadge } from './sharing/indicators.js';
import { boardSharing } from './sharing/status.js';

export interface HubNavProps {
  hubs: readonly HubState[];
  /** Omitted when no Hub is active; an empty list still renders the row with its create action. */
  boards?: readonly Board[];
  activeHubId?: string;
  activeBoardId?: string;
  /** Aggregated activity per Hub id, already projected for the whole snapshot. */
  hubActivity: ReadonlyMap<string, ScopeActivity>;
  /** Aggregated activity per board id of the active Hub. */
  boardActivity: ReadonlyMap<string, ScopeActivity>;
  onSelectHub: (hubId: string) => void;
  onSelectBoard: (hubId: string, boardId: string) => void;
  onCreateHub: () => void;
  onCreateBoard: () => void;
  /** Publishing state per Hub, projected from the host snapshot. */
  sharing?: Readonly<Record<string, HubSharingView>>;
}

/** One scope tab: its name, then the attention indicators in a fixed order, then the running count. */
function ScopeTab({ scope, name, className, selected, activity, sharing, onSelect }: {
  scope: 'Hub' | 'Board';
  name: string;
  className: string;
  selected: boolean;
  activity: ScopeActivity;
  sharing?: React.ReactNode;
  onSelect: () => void;
}) {
  return <button type="button" role="tab" className={className + (selected ? ' is-active' : '')} aria-selected={selected} onClick={onSelect}>{name}
    {activity.unread && <span className="kb-dot kb-blue" role="img" aria-label={scope + ' unread activity'} />}
    {activity.awaitingReply && <span className="kb-dot kb-orange" role="img" aria-label={scope + ' awaiting reply'} />}
    {activity.failed && <span className="kb-dot kb-red" role="img" aria-label={scope + ' failure'} />}
    <RunningTasksBadge activity={activity} />
    {sharing}
  </button>;
}

/** Hub and board tab rows; every fact and callback arrives through props. */
export function HubNav({ hubs, boards, activeHubId, activeBoardId, hubActivity, boardActivity, onSelectHub, onSelectBoard, onCreateHub, onCreateBoard, sharing = {} }: HubNavProps) {
  return <nav className="kb-hub-nav" aria-label="Hub and board navigation">
    <div className="kb-hub-tabs" role="tablist" aria-label="Hubs">
      {hubs.map(hub => <ScopeTab
        key={hub.id}
        scope="Hub"
        name={hub.name}
        className="kb-hub-tab"
        selected={hub.id === activeHubId}
        activity={hubActivity.get(hub.id) ?? EMPTY_SCOPE_ACTIVITY}
        sharing={<HubPublishingBadge view={sharing[hub.id]} />}
        onSelect={() => onSelectHub(hub.id)}
      />)}
      <button type="button" className="kb-tab-add" aria-label="Create Hub" title="Create Hub" onClick={onCreateHub}><PlusIcon size={13} /></button>
    </div>
    {boards !== undefined && <div className="kb-board-tabs" role="tablist" aria-label="Boards">
      {boards.map(board => <ScopeTab
        key={board.id}
        scope="Board"
        name={board.name}
        className="kb-board-tab"
        selected={board.id === activeBoardId}
        activity={boardActivity.get(board.id) ?? EMPTY_SCOPE_ACTIVITY}
        sharing={<BoardPublishingBadge state={activeHubId === undefined || sharing[activeHubId]?.status === 'preview' ? undefined : boardSharing(sharing[activeHubId], board.id)?.state} />}
        onSelect={() => { if (activeHubId !== undefined) onSelectBoard(activeHubId, board.id); }}
      />)}
      <button type="button" className="kb-tab-add" aria-label="Create board" title="Create board" onClick={onCreateBoard}><PlusIcon size={13} /></button>
    </div>}
  </nav>;
}
