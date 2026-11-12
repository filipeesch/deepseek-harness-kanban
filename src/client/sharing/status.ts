import type { HubSharingView, SharingBoardState, SharingChangeSummary, SharingHubStatus } from '../../shared/types.js';

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
  draft: 'Changes not sent',
  'updates-available': 'Team changes to get',
  'needs-review': 'Needs a choice',
  'update-required': 'Plugin update required',
  orphan: 'Removed by the team',
};

export function boardSharing(view: HubSharingView | undefined, boardId: string): HubSharingView['boards'][number] | undefined {
  return view?.boards.find(board => board.boardId === boardId);
}

export function isPubliclyEditable(view: HubSharingView | undefined): boolean {
  return view !== undefined && view.status !== 'not-published' && view.status !== 'preview';
}

/** Publishing is available only when the board has no unapplied team change. */
export function canPublishBoard(view: HubSharingView | undefined, boardId: string): boolean {
  if (!isPubliclyEditable(view)) return false;
  // Another board's review never blocks this one; only a storage-wide failure does.
  if (view!.blockers.length > 0) return false;
  const board = boardSharing(view, boardId);
  if (board === undefined) return false;
  return board.state !== 'updates-available' && board.state !== 'needs-review' && board.state !== 'orphan' && board.state !== 'update-required';
}

/** What a change does, in the product's own vocabulary. */
export function describeChange(change: SharingChangeSummary): string {
  switch (change.kind) {
    case 'workflow.replaced': return 'The workflow is replaced as a whole';
    case 'workflow.field-changed': return change.field === 'name' ? 'The workflow name changed' : 'The default view changed';
    case 'workflow.initial-changed': return 'The initial stage changed to “' + change.columnId + '”';
    case 'stage.created': return 'Stage “' + change.name + '” added';
    case 'stage.field-changed': return change.field === 'name' ? 'Stage “' + change.stage + '” renamed' : 'Stage “' + change.stage + '” changed its ' + fieldLabel(change.field);
    case 'stage.id-changed': return 'Stage “' + change.from + '” renamed to “' + change.to + '”';
    case 'stage.removed': return 'Stage “' + change.stage + '” removed';
    case 'stage.layout-set': return 'Stage “' + change.stage + '” moved or resized';
    case 'group.created': return 'Group “' + change.name + '” added';
    case 'group.field-changed': return change.field === 'name' ? 'Group “' + change.id + '” renamed' : 'Group “' + change.id + '” changed its stages';
    case 'group.removed': return 'Group “' + change.id + '” removed';
    case 'connection.set': return 'Connection “' + change.from + '” → “' + change.to + '” set';
    case 'connection.removed': return 'Connection “' + change.from + '” → “' + change.to + '” removed';
    case 'board.renamed': return 'Board renamed to “' + change.name + '”';
    case 'board.scope-changed': return change.closed ? 'Board closed for new tasks' : change.projects === 0 ? 'Board now accepts every project' : 'Board project scope changed to ' + change.projects + (change.projects === 1 ? ' project' : ' projects');
    case 'board.rank-changed': return 'Board position changed';
    case 'board.removed': return 'Board removed for the team';
    default: return 'Board changed';
  }
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'onEnterPrompt': return 'entry instruction';
    case 'allowedTransitions': return 'allowed transitions';
    case 'deterministic': return 'script';
    default: return field;
  }
}

/** A compact count label, so the tab never shows an unexplained dot. */
export function countLabel(count: number, singular: string, plural: string): string {
  return count + ' ' + (count === 1 ? singular : plural);
}
