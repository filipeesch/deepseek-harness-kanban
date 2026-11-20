import type { HubRepository } from '../hub-repository.js';
import type { Board, HubState } from '../../shared/types.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { parseWorkflow } from '../../domain/workflow.js';
import { TRANSFER_FORMAT, TRANSFER_MAX_COMPRESSED_BYTES, TRANSFER_VERSION, transferBoard, type TransferBoard, type TransferDocument } from '../../domain/workflow-transfer/document.js';
import { describeSize, encodeTransferDocument, suggestedFileName } from './archive.js';

/**
 * Export: read a chosen set of a Hub's boards and produce one compressed document.
 *
 * Nothing here writes. The chosen boards are projected into the transfer shape,
 * the document is serialized deterministically, and the bytes are returned with
 * the advisories a person needs before downloading.
 */

/** One board an export reports as carrying content it cannot transport. */
export interface TransferAdvisory {
  readonly boardName: string;
  readonly reason: 'external-script-source';
  readonly detail: string;
}

/** One export as the surface receives it. */
export interface ExportResult {
  /** The exact compressed bytes, base64-encoded for the wire. */
  readonly archive: string;
  readonly fileName: string;
  readonly boardCount: number;
  readonly advisories: readonly TransferAdvisory[];
}

export interface ExportRequest { readonly hubId: string; readonly boardIds: readonly string[] }

/** The stage identities of one board, as the document carries them. */
function identitiesOf(board: Board): Record<string, string> | undefined {
  const authored = Object.fromEntries(board.workflow.columns.flatMap(column => (column.key === undefined ? [] : [[column.id, column.key]])));
  const merged = { ...authored, ...board.localStageIdentities };
  return Object.keys(merged).length === 0 ? undefined : merged;
}

/** The workflow stages whose program is an external file reference. */
function externalSources(board: Board): string[] {
  try { return parseWorkflow(board.workflowYaml).columns.flatMap(column => (column.scripted?.file === undefined ? [] : [column.name + ' reads ' + column.scripted.file])); }
  catch { return []; }
}

/** One stored board as the document entry that carries it. */
export function exportEntry(board: Board): TransferBoard {
  const identities = identitiesOf(board);
  return transferBoard({
    name: board.name,
    workflowYaml: board.workflowYaml,
    ...(board.defaultPresetMode === undefined ? {} : { presetMode: board.defaultPresetMode }),
    ...(board.allowedProjectKeys === undefined ? {} : { projectKeys: board.allowedProjectKeys }),
    ...(identities === undefined ? {} : { stageIdentities: identities }),
  });
}

/**
 * The document one Hub's chosen boards produce.
 *
 * The entries follow Hub order rather than the selection order, so two exports of
 * the same boards produce the same bytes whichever way the person ticked them.
 */
export function exportDocument(hub: HubState, boardIds: readonly string[]): TransferDocument {
  invariant(boardIds.length > 0, 'TRANSFER_NOTHING_SELECTED', 'Select at least one board to export.');
  const chosen = new Set(boardIds);
  for (const boardId of chosen) {
    if (!hub.boards.some(board => board.id === boardId)) throw new KanbanError('BOARD_NOT_FOUND', 'Board "' + boardId + '" does not exist in this Hub.', { boardId });
  }
  const ordered = hub.boards.filter(board => chosen.has(board.id));
  return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: hub.name }, boards: ordered.map(exportEntry) };
}

/** Read the chosen boards and produce the bytes the browser downloads. */
export function exportBoards(hubs: HubRepository, request: ExportRequest, now: Date = new Date()): ExportResult {
  const hub = hubs.requireHub(request.hubId);
  const document = exportDocument(hub, request.boardIds);
  const archive = encodeTransferDocument(document);
  // An export the import surface would refuse is not worth downloading, so the same
  // limit is measured here and the refusal names what to do about it.
  if (archive.byteLength > TRANSFER_MAX_COMPRESSED_BYTES) {
    throw new KanbanError('TRANSFER_TOO_LARGE', 'The chosen boards compress to ' + describeSize(archive.byteLength) + ', larger than the ' + describeSize(TRANSFER_MAX_COMPRESSED_BYTES) + ' one document may occupy. Export fewer boards at a time.', { size: archive.byteLength, limit: TRANSFER_MAX_COMPRESSED_BYTES });
  }
  const chosen = new Set(request.boardIds);
  const advisories: TransferAdvisory[] = [];
  for (const board of hub.boards) {
    if (!chosen.has(board.id)) continue;
    for (const detail of externalSources(board)) advisories.push({ boardName: board.name, reason: 'external-script-source', detail });
  }
  return { archive: archive.toString('base64'), fileName: suggestedFileName(hub.name, now), boardCount: document.boards.length, advisories };
}

