import type { HubSharingView, SharingBoardState, SharingHubStatus } from '../../shared/types.js';

export const HUB_STATUS_LABEL: Record<SharingHubStatus, string> = {
  'not-published': 'Not published',
  preview: 'Review the connection',
  published: 'Published to team',
  'updates-available': 'Updates available',
  'needs-review': 'Needs review',
  unavailable: 'Updates unavailable',
};

export const BOARD_STATE_LABEL: Record<SharingBoardState, string> = {
  'in-sync': 'Up to date',
  draft: 'Draft',
  'updates-available': 'Updates available',
  'needs-review': 'Needs review',
  orphan: 'Removed by the team',
};

export function boardSharing(view: HubSharingView | undefined, boardId: string): HubSharingView['boards'][number] | undefined {
  return view?.boards.find(board => board.boardId === boardId);
}

export function isPubliclyEditable(view: HubSharingView | undefined): boolean {
  return view !== undefined && view.status !== 'not-published' && view.status !== 'preview';
}

/** Sharing is available only when the comparison has nothing blocking or unapplied. */
export function canShareFromEditor(view: HubSharingView | undefined, boardId: string): boolean {
  if (!isPubliclyEditable(view)) return false;
  if (view!.updates > 0 || view!.conflicts > 0 || view!.blockers.length > 0) return false;
  return view!.boards.find(board => board.boardId === boardId)?.state !== 'orphan';
}
