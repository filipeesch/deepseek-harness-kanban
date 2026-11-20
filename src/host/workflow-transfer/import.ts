import type { HubRepository } from '../hub-repository.js';
import type { Board, HubState } from '../../shared/types.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { decodeTransferDocument, describeSize } from './archive.js';
import { TRANSFER_MAX_COMPRESSED_BYTES } from '../../domain/workflow-transfer/document.js';
import {
  boardNameKey, planTransfer, settleEntry,
  type TransferDecision, type TransferEntryPlan, type TransferPlan,
} from '../../domain/workflow-transfer/plan.js';

/** One entry whose settled destination no longer describes this Hub. */
function staleEntry(entry: TransferEntryPlan, detail: string): TransferEntryPlan {
  return { ...entry, destination: 'blocked', blockReason: 'stale-plan', detail, orphaned: [], realigned: [] };
}
import type { TransferBoard, TransferDocument } from '../../domain/workflow-transfer/document.js';

/**
 * Import: read a document against a Hub, settle its conflicts, and apply what it
 * can.
 *
 * Reading and applying are separate on purpose. The read returns the plan the
 * surface renders, the person settles each conflict, and the apply receives those
 * settlements. Nothing is re-derived at write time, so the surface and the host
 * cannot disagree about which board a decision named.
 */

/** One import request, as the surface submits it. */
export interface ImportRequest {
  readonly hubId: string;
  /** The exact compressed bytes the person chose, base64-encoded for the wire. */
  readonly archive: string;
}

/** One apply request: the document plus the settlements the person made. */
export interface ApplyRequest extends ImportRequest { readonly decisions: readonly TransferDecision[] }

/**
 * Read one document and state what each of its entries would do.
 *
 * The read writes nothing. A document that cannot be decoded or parsed fails as
 * a whole; a single entry whose workflow cannot be read is reported as blocked
 * and does not fail the entries around it.
 */
export function analyzeTransfer(hubs: HubRepository, request: ImportRequest): TransferPlan {
  const hub = hubs.requireHub(request.hubId);
  const document = decodeTransferDocument(decodeBase64(request.archive));
  return planTransfer({ hub, boards: document.boards, hubId: hub.id, origin: document.origin.hubName });
}

/**
 * The bytes a base64 field carries, refused before it is allocated.
 *
 * Base64 expands by four thirds, so the accepted text length is checked before
 * `Buffer.from` so a request cannot make the host allocate far more than the
 * accepted document size.
 */
export function decodeBase64(value: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'No document was supplied.');
  const limit = Math.ceil(TRANSFER_MAX_COMPRESSED_BYTES / 3) * 4;
  if (value.length > limit) throw new KanbanError('TRANSFER_TOO_LARGE', 'The supplied document is larger than the ' + describeSize(TRANSFER_MAX_COMPRESSED_BYTES) + ' a workflow export may occupy.', { limit: TRANSFER_MAX_COMPRESSED_BYTES });
  const buffer = Buffer.from(value, 'base64');
  if (buffer.byteLength === 0) throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'The supplied document carries no bytes.');
  return buffer;
}

/**
 * Apply the settlements to a plan.
 *
 * The plan is recomputed from the document so the entry a decision names is
 * always the entry the document carries, and each decision is then applied to
 * that calculated entry. A decision that names no entry is refused, because a
 * surface and a document that disagree is a bug the person cannot act on.
 */
export function settlePlan(hubs: HubRepository, request: ApplyRequest): { hub: HubState; entries: TransferEntryPlan[]; document: TransferDocument; boards: Map<string, TransferBoard> } {
  const hub = hubs.requireHub(request.hubId);
  const document = decodeTransferDocument(decodeBase64(request.archive));
  const plan = planTransfer({ hub, boards: document.boards, hubId: hub.id, origin: document.origin.hubName });
  const byName = new Map(plan.entries.map(entry => [boardNameKey(entry.name), entry]));
  const decisions = new Map(request.decisions.map(decision => [boardNameKey(decision.name), decision]));
  for (const name of decisions.keys()) invariant(byName.has(name), 'TRANSFER_UNKNOWN_ENTRY', 'The settlement names a board the document does not carry: ' + name + '.');
  const entries = plan.entries.map(entry => {
    const decision = decisions.get(boardNameKey(entry.name));
    if (decision === undefined) return entry;
    // The plan is recomputed from the Hub as it is now, so a settlement is applied
    // only when the entry still describes the destination the person saw. When it
    // does not, the entry is reported as stale: a rename, a removal, or a new board
    // holding the name must never reclassify a settlement onto another board.
    const settled = settleEntry({ entry, decision });
    if (settled.destination !== 'create' && settled.destination !== 'copy' && settled.destination !== 'replace') return settled;
    if (decision.settlement === 'skip' && entry.destination === 'create') {
      return staleEntry(entry, 'A board with this name exists now, so skipping it would leave an unrelated board behind. Read the file again.');
    }
    if (decision.settlement !== 'skip') {
      const approved = decision.targetBoardId ?? null;
      if (approved !== entry.targetBoardId) return staleEntry(entry, 'The board this entry targets changed while the import was being prepared. Read the file again.');
    }
    return settled;
  });
  const boards = new Map(document.boards.map(board => [boardNameKey(board.name), board]));
  return { hub, entries, document, boards };
}

/** One board's authored document as the apply writes it. */
export function boardOfWorkflow(entry: TransferEntryPlan, boards: ReadonlyMap<string, TransferBoard>): TransferBoard {
  const board = boards.get(boardNameKey(entry.name));
  invariant(board, 'TRANSFER_UNKNOWN_ENTRY', 'The document no longer carries board "' + entry.name + '".');
  return board;
}

/**
 * The project scope an apply writes, aligned with the destination Hub.
 *
 * Three cases stay distinct, because they mean three different things to a board:
 * an absent scope accepts every project, an empty list keeps the board closed to
 * creation, and a list keeps exactly the keys the destination Hub holds. Only a
 * scope that arrived nonempty and lost every key becomes open, which is what
 * dropping an unknown key means; an authored empty list is preserved as empty.
 */
export function scopeOf(board: TransferBoard, hub: HubState): string[] | undefined {
  if (board.projectKeys === null) return undefined;
  if (board.projectKeys.length === 0) return [];
  const held = new Set(hub.projects.map(project => project.projectKey));
  const kept = board.projectKeys.filter(key => held.has(key));
  return kept.length === 0 ? undefined : kept;
}

