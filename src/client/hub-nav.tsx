import React from 'react';
import type { Board, HubSharingView, HubState } from '../shared/types.js';
import { EMPTY_SCOPE_ACTIVITY, type ScopeActivity } from './scope-activity.js';
import { RunningTasksBadge } from './running-tasks-badge.js';
import { PlusIcon } from './icons.js';
import { BoardPublishingBadge, HubPublishingBadge } from './sharing/indicators.js';

export interface HubTabRowProps {
  hubs: readonly HubState[];
  activeHubId?: string;
  /** Aggregated activity per Hub id, already projected for the whole snapshot. */
  hubActivity: ReadonlyMap<string, ScopeActivity>;
  onSelectHub: (hubId: string) => void;
  onCreateHub: () => void;
  /** Publishing state per Hub, projected from the host snapshot. */
  sharing?: Readonly<Record<string, HubSharingView>>;
}

export interface BoardTabRowProps {
  /** Omitted when no Hub is active; the row renders nothing. */
  boards?: readonly Board[];
  activeHubId?: string;
  activeBoardId?: string;
  /** Aggregated activity per board id of the active Hub. */
  boardActivity: ReadonlyMap<string, ScopeActivity>;
  onSelectBoard: (hubId: string, boardId: string) => void;
  onCreateBoard: () => void;
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

/**
 * The Hub row of the header. Each row is its own landmark and tablist so the two can be
 * placed on different lines by the header and scroll on their own.
 */
export function HubTabRow({ hubs, activeHubId, hubActivity, onSelectHub, onCreateHub, sharing = {} }: HubTabRowProps) {
  return <nav className="kb-scope-row kb-hub-row" aria-label="Hubs">
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
  </nav>;
}

/** The board row of the header, scoped to the active Hub. */
export function BoardTabRow({ boards, activeHubId, activeBoardId, boardActivity, onSelectBoard, onCreateBoard, sharing = {} }: BoardTabRowProps) {
  if (boards === undefined) return null;
  return <nav className="kb-scope-row kb-board-row" aria-label="Boards">
    <div className="kb-board-tabs" role="tablist" aria-label="Boards">
      {boards.map(board => <ScopeTab
        key={board.id}
        scope="Board"
        name={board.name}
        className="kb-board-tab"
        selected={board.id === activeBoardId}
        activity={boardActivity.get(board.id) ?? EMPTY_SCOPE_ACTIVITY}
        sharing={<BoardPublishingBadge view={activeHubId === undefined || sharing[activeHubId]?.status === 'preview' ? undefined : sharing[activeHubId]} boardId={board.id} />}
        onSelect={() => { if (activeHubId !== undefined) onSelectBoard(activeHubId, board.id); }}
      />)}
      <button type="button" className="kb-tab-add" aria-label="Create board" title="Create board" onClick={onCreateBoard}><PlusIcon size={13} /></button>
    </div>
  </nav>;
}