import type { Board, HubState, Workflow } from '../../shared/types.js';
import type { TransferBoard } from './document.js';
import { parseWorkflow } from '../workflow.js';
import { reconcileLocalStageIdentities } from '../stage-identity.js';
import { KanbanError } from '../../shared/errors.js';

/**
 * The import plan: what each entry of a document would do to a Hub, decided
 * before anything is written.
 *
 * Every rule here is pure. The plan is computed once against a Hub and rendered
 * by the surface that asked for it, so a person's settlement always names the
 * board they saw rather than a board the host re-derived at write time.
 */

/** How one entry would land in the destination Hub. */
export type TransferDestinationKind = 'create' | 'replace' | 'copy' | 'skip' | 'blocked';

/** Why an entry cannot be applied as it stands. */
export type TransferBlockReason =
  /** The entry's workflow document does not parse. */
  | 'invalid-workflow'
  /** The entry names a board of this Hub, so it needs a settlement. */
  | 'name-conflict'
  /** The plan the person settled no longer describes this Hub. */
  | 'stale-plan';

/** One card a replacement would strand in a stage the incoming workflow does not define. */
export interface TransferOrphan { readonly columnId: string; readonly stageIdentity: string; readonly cards: number }

/** One stage a replacement would rename while keeping its cards. */
export interface TransferRealignment { readonly from: string; readonly to: string; readonly cards: number }

/** One planned entry. */
export interface TransferEntryPlan {
  /** The name the document carries. */
  readonly name: string;
  readonly destination: TransferDestinationKind;
  /** The existing board a replacement would overwrite. */
  readonly targetBoardId: string | null;
  /** The free name proposed for a copy. */
  readonly copyName: string | null;
  /** The stages whose cards a replacement would strand. */
  readonly orphaned: readonly TransferOrphan[];
  /** The stages a replacement would rename while keeping their cards. */
  readonly realigned: readonly TransferRealignment[];
  /** The project keys the destination Hub does not hold and the import would drop. */
  readonly droppedProjectKeys: readonly string[];
  /** Whether filtering the scope emptied it, which opens it to every project. */
  readonly scopeOpened: boolean;
  /** Why the entry is blocked, when it is. */
  readonly blockReason: TransferBlockReason | null;
  /** A one-line explanation the surface presents beside the entry. */
  readonly detail: string | null;
  /** The scripted stages whose program is an external file reference, as stage:path. */
  readonly externalScriptSources: readonly string[];
}

/** Everything the import surface needs to present and then apply a document. */
export interface TransferPlan {
  readonly hubId: string;
  /** The Hub name the document states as its origin. */
  readonly origin: string;
  readonly entries: readonly TransferEntryPlan[];
}

/** The settlement one conflicting entry applies with. */
export type TransferSettlement = 'replace' | 'copy' | 'skip';

/** One conflicting entry as the surface settles it. */
export interface TransferDecision {
  readonly name: string;
  readonly settlement: TransferSettlement;
  readonly copyName?: string;
  /** The board the person saw this entry targeting; absent only for a surface that showed none. */
  readonly targetBoardId?: string | null;
}

/**
 * A free board name derived from an imported one.
 *
 * The first attempt appends a suffix; every later attempt appends a running
 * number, so two copies of the same imported name never collide and a person
 * can always see which copy is which.
 */
export function freeBoardName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(boardNameKey));
  const base = name.trim();
  for (const candidate of copyNameCandidates(base)) {
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new KanbanError('TRANSFER_NAME_EXHAUSTED', 'Could not propose a free board name for "' + base + '".');
}

/** The names a copy of one imported name tries, in order. */
function* copyNameCandidates(base: string): Generator<string> {
  yield base + ' (imported)';
  for (let index = 2; index < 1000; index++) yield base + ' (imported ' + String(index) + ')';
}

/** A board name as the Hub compares it: trimmed and case-folded, never altered on the way out. */
export function boardNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Whether two board names are the same within a Hub, compared as the Hub compares them. */
export function sameBoardName(left: string, right: string): boolean {
  return boardNameKey(left) === boardNameKey(right);
}

/** The identity a stage of a stored board holds, from its association or its authored key. */
function identityOf(board: Board, columnId: string): string | undefined {
  return board.localStageIdentities?.[columnId] ?? board.workflow.columns.find(column => column.id === columnId)?.key;
}

/**
 * The stable identity every stage of an incoming workflow would hold.
 *
 * A document may carry associations the workflow does not author as `key` (the
 * source installation recorded them locally), so both sources are read here. The
 * association wins over the authored key, exactly as the board resolves a stage
 * identity at runtime (`localStageIdentities` before `key`); reading them in the
 * opposite order would validate one map and persist another.
 * An association naming a stage the workflow does not define, or two stages
 * resolving to the same identity, is refused: either would make a captured
 * destination ambiguous on the board this import creates.
 */
export function incomingIdentities(workflow: Workflow, associations: Readonly<Record<string, string>> | null): Map<string, string> {
  const identities = new Map<string, string>();
  for (const column of workflow.columns) if (column.key !== undefined) identities.set(column.id, column.key);
  for (const [columnId, identity] of Object.entries(associations ?? {})) {
    if (!workflow.columns.some(column => column.id === columnId)) {
      throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'The document associates an identity with stage "' + columnId + '", which its workflow does not define.');
    }
    identities.set(columnId, identity);
  }
  const used = new Map<string, string>();
  for (const [columnId, identity] of identities) {
    const owner = used.get(identity);
    if (owner !== undefined) {
      throw new KanbanError('TRANSFER_INVALID_DOCUMENT', 'Stages "' + owner + '" and "' + columnId + '" would share the stage identity "' + identity + '".');
    }
    used.set(identity, columnId);
  }
  return identities;
}

/** Whether a workflow authors a scripted stage whose program is an external file reference. */
function externalSources(yaml: string): string[] {
  try {
    return parseWorkflow(yaml).columns.flatMap(column => (column.scripted?.file === undefined ? [] : [column.id + ':' + column.scripted.file]));
  } catch { return []; }
}

/**
 * What a replacement would do to the cards of the board it overwrites.
 *
 * A card whose stage identifier the incoming workflow does not define is
 * resolved by identity: an incoming stage carrying the identity the card's stage
 * held is the same stage under another identifier, so the card follows it. Only
 * a card whose stage identity no incoming stage carries is stranded.
 */
export function replacementOutcome(input: {
  readonly stored: Board;
  readonly incoming: string;
  readonly cards: ReadonlyMap<string, number>;
  /** The associations the document carries; they resolve a rename the workflow only keys locally. */
  readonly associations?: Readonly<Record<string, string>> | null;
}): { stranded: TransferOrphan[]; realigned: TransferRealignment[] } {
  const workflow = parseWorkflow(input.incoming);
  const incomingById = new Set(workflow.columns.map(column => column.id));
  const incomingByIdentity = new Map<string, string>();
  for (const [columnId, identity] of incomingIdentities(workflow, input.associations ?? null)) incomingByIdentity.set(identity, columnId);
  const stranded: TransferOrphan[] = [];
  const realigned: TransferRealignment[] = [];
  for (const [columnId, cards] of input.cards) {
    if (incomingById.has(columnId)) continue;
    const identity = identityOf(input.stored, columnId);
    const target = identity === undefined ? undefined : incomingByIdentity.get(identity);
    if (target === undefined) stranded.push({ columnId, stageIdentity: identity ?? columnId, cards });
    else realigned.push({ from: columnId, to: target, cards });
  }
  return { stranded, realigned };
}

/** Every stage the stored board currently occupies, counting cards per stage. */
function cardsOf(hub: HubState, boardId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of hub.tasks) {
    if (task.boardId !== boardId) continue;
    counts.set(task.columnId, (counts.get(task.columnId) ?? 0) + 1);
  }
  return counts;
}

/** The project keys the destination Hub does not hold, and whether that empties the scope. */
function scopeOutcome(entry: TransferBoard, held: ReadonlySet<string>): { dropped: string[]; opened: boolean } {
  if (entry.projectKeys === null) return { dropped: [], opened: false };
  const dropped = entry.projectKeys.filter(key => !held.has(key));
  return { dropped, opened: entry.projectKeys.length > 0 && dropped.length === entry.projectKeys.length };
}

/** One conflicting entry before any settlement names it. */
export function conflictingEntry(input: { readonly entry: TransferBoard; readonly stored: Board; readonly hub: HubState; readonly taken: readonly string[] }): TransferEntryPlan {
  const cards = cardsOf(input.hub, input.stored.id);
  const scope = scopeOutcome(input.entry, new Set(input.hub.projects.map(project => project.projectKey)));
  // A conflict whose document cannot be read is reported as unreadable, exactly
  // as an unopposed entry would be: a name clash must not hide a worse problem.
  const unreadable = entryRefusal(input.entry);
  if (unreadable !== null) {
    return {
      name: input.entry.name, destination: 'blocked', targetBoardId: input.stored.id, copyName: null,
      orphaned: [], realigned: [], droppedProjectKeys: scope.dropped, scopeOpened: scope.opened,
      blockReason: 'invalid-workflow', detail: unreadable, externalScriptSources: [],
    };
  }
  // The identities the applied board will hold, computed with the same rule the save
  // applies: a stored association follows a rename by authored key, and an imported
  // association then wins. The plan and the write must disagree about nothing here, or
  // the plan would announce a realignment the write cannot perform.
  let outcome: { stranded: TransferOrphan[]; realigned: TransferRealignment[] };
  try {
    const projected = structuredClone(input.stored);
    reconcileLocalStageIdentities(projected, parseWorkflow(input.entry.workflowYaml));
    const associations: Record<string, string> = { ...(projected.localStageIdentities ?? {}), ...(input.entry.stageIdentities ?? {}) };
    outcome = replacementOutcome({ stored: input.stored, incoming: input.entry.workflowYaml, cards, associations: Object.keys(associations).length === 0 ? null : associations });
  } catch (error) {
    // An identity conflict this board cannot resolve blocks THIS entry and nothing
    // else: a document carrying one unusable board must still apply the others.
    return {
      name: input.entry.name, destination: 'blocked', targetBoardId: input.stored.id, copyName: null,
      orphaned: [], realigned: [], droppedProjectKeys: scope.dropped, scopeOpened: scope.opened,
      blockReason: 'invalid-workflow', detail: error instanceof Error ? error.message : 'The board cannot take these stage identities.', externalScriptSources: [],
    };
  }
  return {
    name: input.entry.name,
    destination: 'blocked',
    targetBoardId: input.stored.id,
    copyName: freeBoardName(input.entry.name, input.taken),
    orphaned: outcome.stranded,
    realigned: outcome.realigned,
    droppedProjectKeys: scope.dropped,
    scopeOpened: scope.opened,
    blockReason: 'name-conflict',
    detail: 'A board with this name already exists in this Hub.',
    externalScriptSources: externalSources(input.entry.workflowYaml),
  };
}

/** One entry whose name the Hub does not hold, or which cannot be read at all. */
export function newEntry(input: { readonly entry: TransferBoard; readonly hub: HubState; readonly invalid: string | null }): TransferEntryPlan {
  const scope = scopeOutcome(input.entry, new Set(input.hub.projects.map(project => project.projectKey)));
  if (input.invalid !== null) {
    return {
      name: input.entry.name, destination: 'blocked', targetBoardId: null, copyName: null,
      orphaned: [], realigned: [], droppedProjectKeys: scope.dropped, scopeOpened: scope.opened,
      blockReason: 'invalid-workflow', detail: input.invalid, externalScriptSources: [],
    };
  }
  return {
    name: input.entry.name, destination: 'create', targetBoardId: null, copyName: null,
    orphaned: [], realigned: [], droppedProjectKeys: scope.dropped, scopeOpened: scope.opened,
    blockReason: null, detail: null, externalScriptSources: externalSources(input.entry.workflowYaml),
  };
}

/**
 * The refusal one unreadable entry produces, or null when it can be read.
 *
 * Both a workflow that does not parse and a stage-identity map that names a stage
 * the workflow lacks, or that gives two stages one identity, are refused here, so
 * the plan reports one blocked row instead of failing the whole document.
 */
export function entryRefusal(entry: TransferBoard): string | null {
  try {
    const workflow = parseWorkflow(entry.workflowYaml);
    incomingIdentities(workflow, entry.stageIdentities);
    return null;
  } catch (error) { return error instanceof Error ? error.message : 'The workflow document cannot be read.'; }
}

/**
 * Compute what one document would do to one Hub.
 *
 * A name the Hub already holds is a conflict and blocks the entry until a
 * settlement names it, because the plan never guesses which board the person
 * meant. A workflow that does not parse blocks the entry outright. Copy names
 * are claimed as the plan walks, so two copies of the same name never receive
 * the same proposal.
 */
export function planTransfer(input: { readonly hub: HubState; readonly boards: readonly TransferBoard[]; readonly hubId: string; readonly origin: string }): TransferPlan {
  const byName = new Map(input.hub.boards.map(board => [boardNameKey(board.name), board]));
  const taken = input.hub.boards.map(board => board.name);
  const entries = input.boards.map(entry => {
    const stored = byName.get(boardNameKey(entry.name));
    const planned = stored === undefined
      ? newEntry({ entry, hub: input.hub, invalid: entryRefusal(entry) })
      : conflictingEntry({ entry, stored, hub: input.hub, taken });
    // A proposal a later entry could reuse would make two copies collide, so the
    // plan claims it as it goes.
    if (planned.copyName !== null) taken.push(planned.copyName);
    return planned;
  });
  return { hubId: input.hubId, origin: input.origin, entries };
}

/**
 * Settle one planned entry.
 *
 * The settlement is applied to the calculated plan rather than recomputed from
 * the Hub, so a replacement reports the strandings measured against the board
 * the person saw.
 */
export function settleEntry(input: { readonly entry: TransferEntryPlan; readonly decision: TransferDecision }): TransferEntryPlan {
  const { entry, decision } = input;
  if (entry.destination !== 'blocked' || entry.blockReason !== 'name-conflict') return entry;
  if (decision.settlement === 'skip') {
    return { ...entry, destination: 'skip', orphaned: [], realigned: [], detail: 'This board is left unchanged.' };
  }
  if (decision.settlement === 'copy') {
    return { ...entry, destination: 'copy', copyName: decision.copyName ?? entry.copyName, orphaned: [], realigned: [], detail: null };
  }
  // A replacement that would strand a card keeps the entry blocked, naming the
  // stages behind it, so the surface can explain what the person must move.
  if (entry.orphaned.length > 0) {
    return {
      ...entry,
      destination: 'blocked',
      blockReason: 'invalid-workflow',
      detail: 'The imported workflow does not define ' + orphanedText(entry.orphaned) + ', so those cards would have nowhere to go.',
    };
  }
  return { ...entry, destination: 'replace', blockReason: null, detail: null };
}

/** One sentence naming the stranded stages and their card counts. */
export function orphanedText(orphaned: readonly TransferOrphan[]): string {
  return orphaned.map(entry => 'stage "' + entry.columnId + '" with ' + String(entry.cards) + ' card' + (entry.cards === 1 ? '' : 's')).join(' and ');
}
