import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_TRASH_DIRECTORY } from '../../shared/types.js';
import type { TeamFileEntry, TeamFileStore, TeamFileStoreSource } from '../sharing/team-file-store.js';
import {
  TEAM_FILE_MAX_INPUT_BYTES,
  TEAM_FILE_SEARCH_DEADLINE_MS,
  TEAM_FILE_SEARCH_MAX_MATCHES,
  TEAM_FILE_SEARCH_MAX_OUTPUT_BYTES,
  TEAM_FILE_SEARCH_MAX_PATHS,
} from './limits.js';
import { matchesTeamGlob, normalizeTeamGlob } from './pattern.js';
import { renderTeamFile, truncateTeamLine, type TeamFileRender } from './render.js';
import { normalizeTeamFilePath } from './root.js';
import { assertTextContent, assertTextPath, decodeTeamFileText, isBinaryPath } from './text.js';

const MAX_EDITS = 100;
const MAX_EXISTING_TEXT_LENGTH = 20_000;

export interface TeamFileSearchRequest { path?: string; content?: string; limit?: number }

export interface TeamFileSearchResult {
  provider: string;
  label: string;
  address: string;
  /** Matching paths. With a content pattern, only the files that produced a match. */
  paths: TeamFileEntry[];
  matches: Array<{ path: string; line: number; text: string }>;
  truncated: { paths?: true; matches?: true; bytes?: true; deadline?: true };
  head?: string;
}

export interface TeamFileReadRequest { path: string; offset?: number; limit?: number }

export interface TeamFileReadResult extends TeamFileRender {
  path: string;
  size: number;
  modifiedAt: string;
  head?: string;
}

export interface TeamFileCreateRequest { path: string; content: string }

export interface TeamFileEdit { old: string; new: string }

export interface TeamFileEditRequest { path: string; edits: TeamFileEdit[] }

export interface TeamFileDeleteRequest { path: string; confirmed?: boolean }

export interface TeamFileWriteResult { path: string; size: number; head?: string; replacements?: number }

export interface TeamFileDeleteResult { path: string; trashPath: string; head?: string }

function notFound(relative: string): KanbanError {
  return new KanbanError('TEAM_FILE_NOT_FOUND', 'The team file "' + relative + '" does not exist.', { path: relative });
}

/** A file name that never collides with an earlier deletion of the same path. */
export function trashTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** The single occurrence of one existing text, or a refusal naming the replacement. */
function replaceExactlyOnce(content: string, edit: TeamFileEdit, index: number, relative: string): string {
  const first = content.indexOf(edit.old);
  const last = content.lastIndexOf(edit.old);
  if (first === -1 || first !== last) {
    const occurrences = first === -1 ? 0 : content.split(edit.old).length - 1;
    throw new KanbanError('TEAM_FILE_EDIT_CONFLICT', 'Replacement ' + (index + 1) + ' does not apply: the existing text occurs ' + occurrences + ' time(s) in "' + relative + '". Each existing text must occur exactly once.', { path: relative, index, occurrences });
  }
  // A literal splice, never String.replace, whose replacement string would
  // expand tokens such as $& and $$ instead of writing them.
  return content.slice(0, first) + edit.new + content.slice(first + edit.old.length);
}

function searchLimit(value: number | undefined): number {
  if (value === undefined) return TEAM_FILE_SEARCH_MAX_PATHS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new KanbanError('INVALID_INPUT', 'limit must be a positive whole number.');
  if (value > TEAM_FILE_SEARCH_MAX_PATHS) throw new KanbanError('INVALID_INPUT', 'limit must be at most ' + TEAM_FILE_SEARCH_MAX_PATHS + '.');
  return value;
}

function searchText(value: unknown): string {
  if (typeof value !== 'string') throw new KanbanError('INVALID_INPUT', 'A content pattern must be a string.');
  if (value.length === 0) throw new KanbanError('INVALID_INPUT', 'A content pattern is required; omit it to list paths only.');
  return value;
}

function normalizeEdits(value: unknown): TeamFileEdit[] {
  if (!Array.isArray(value) || value.length === 0) throw new KanbanError('INVALID_INPUT', 'At least one replacement is required.');
  if (value.length > MAX_EDITS) throw new KanbanError('INVALID_INPUT', 'A call can apply at most ' + MAX_EDITS + ' replacements.');
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new KanbanError('INVALID_INPUT', 'Replacement ' + (index + 1) + ' must be an object with an existing text and a new text.');
    const record = item as { old?: unknown; new?: unknown };
    if (typeof record.old !== 'string' || record.old.length === 0) throw new KanbanError('INVALID_INPUT', 'Replacement ' + (index + 1) + ' needs a non-empty existing text.');
    if (record.old.length > MAX_EXISTING_TEXT_LENGTH) throw new KanbanError('INVALID_INPUT', 'Replacement ' + (index + 1) + ' existing text is longer than ' + MAX_EXISTING_TEXT_LENGTH + ' characters.');
    if (typeof record.new !== 'string') throw new KanbanError('INVALID_INPUT', 'Replacement ' + (index + 1) + ' needs a new text; use an empty string to delete.');
    return { old: record.old, new: record.new };
  });
}

/** Indentation and separators the tool's pretty-printed JSON adds around one item. */
const PRETTY_ITEM_OVERHEAD = 20;
/** How often a long file scan re-checks the deadline. */
const DEADLINE_LINE_STRIDE = 256;

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8') + PRETTY_ITEM_OVERHEAD;
}

async function headOf(store: TeamFileStore): Promise<string | undefined> {
  return store.head === undefined ? undefined : store.head();
}

async function withHead(store: TeamFileStore): Promise<{ head?: string }> {
  const head = await headOf(store);
  return head === undefined ? {} : { head };
}

/**
 * Team file semantics: the path gate, the text rules, search, the trash layout,
 * and the typed failures. It knows nothing about a transport, so the same rules
 * hold for a Git clone, a local folder, and a Drive folder. Every mutation runs
 * inside one lane acquisition that covers the whole read-modify-write, so two
 * callers can never both pass the same existence or uniqueness check.
 */
export class TeamFiles {
  constructor(private readonly source: TeamFileStoreSource) {}

  async search(hubId: string, request: TeamFileSearchRequest = {}): Promise<TeamFileSearchResult> {
    const resolved = this.source.store(hubId);
    const pattern = request.path === undefined ? undefined : normalizeTeamGlob(request.path);
    const content = request.content === undefined ? undefined : searchText(request.content);
    const limit = searchLimit(request.limit);
    const deadline = Date.now() + TEAM_FILE_SEARCH_DEADLINE_MS;
    const truncated: TeamFileSearchResult['truncated'] = {};
    // The listing itself cannot be interrupted; the deadline is checked the
    // moment it returns and again throughout the scan.
    const entries = await resolved.store.list();
    if (Date.now() > deadline) return { provider: resolved.provider, label: resolved.label, address: resolved.address, paths: [], matches: [], truncated: { deadline: true }, ...(await withHead(resolved.store)) };
    const candidates = entries.filter(entry => pattern === undefined || matchesTeamGlob(pattern, entry.path));
    const matches: TeamFileSearchResult['matches'] = [];
    const matchedEntries: TeamFileEntry[] = [];
    if (content === undefined) {
      const paths = candidates.slice(0, limit);
      if (candidates.length > paths.length) truncated.paths = true;
      return { provider: resolved.provider, label: resolved.label, address: resolved.address, paths, matches, truncated, ...(await withHead(resolved.store)) };
    }
    let outputBytes = 0;
    let stop = false;
    for (const entry of candidates) {
      if (matches.length >= TEAM_FILE_SEARCH_MAX_MATCHES) { truncated.matches = true; break; }
      if (Date.now() > deadline) { truncated.deadline = true; break; }
      if (isBinaryPath(entry.path)) continue;
      let file;
      try { file = await resolved.store.read(entry.path, { maxBytes: TEAM_FILE_MAX_INPUT_BYTES }); }
      catch (error) {
        // A file that cannot be text is skipped, not reported as a match.
        if (error instanceof KanbanError && (error.code === 'TEAM_FILE_TOO_LARGE' || error.code === 'TEAM_FILE_BINARY')) continue;
        throw error;
      }
      if (file === null) continue;
      let text: string;
      try { text = decodeTeamFileText(file.bytes, entry.path); }
      catch (error) {
        if (error instanceof KanbanError && error.code === 'TEAM_FILE_BINARY') continue;
        throw error;
      }
      let produced = false;
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (index % DEADLINE_LINE_STRIDE === 0 && Date.now() > deadline) { truncated.deadline = true; stop = true; break; }
        const line = lines[index] ?? '';
        if (!line.includes(content)) continue;
        const match = { path: entry.path, line: index + 1, text: truncateTeamLine(line) };
        if (outputBytes + serializedBytes(match) > TEAM_FILE_SEARCH_MAX_OUTPUT_BYTES) { truncated.bytes = true; stop = true; break; }
        outputBytes += serializedBytes(match);
        if (!produced) { produced = true; matchedEntries.push(entry); outputBytes += serializedBytes(entry); }
        matches.push(match);
        if (matches.length >= TEAM_FILE_SEARCH_MAX_MATCHES) { truncated.matches = true; stop = true; break; }
      }
      if (stop) break;
    }
    const paths = matchedEntries.slice(0, TEAM_FILE_SEARCH_MAX_PATHS);
    if (matchedEntries.length > paths.length) truncated.paths = true;
    return {
      provider: resolved.provider,
      label: resolved.label,
      address: resolved.address,
      paths,
      matches,
      truncated,
      ...(await withHead(resolved.store)),
    };
  }

  async read(hubId: string, request: TeamFileReadRequest): Promise<TeamFileReadResult> {
    const resolved = this.source.store(hubId);
    const relative = normalizeTeamFilePath(request.path);
    const file = await resolved.store.read(relative, { maxBytes: TEAM_FILE_MAX_INPUT_BYTES });
    if (file === null) throw notFound(relative);
    assertTextPath(relative);
    const text = decodeTeamFileText(file.bytes, relative);
    const rendered = renderTeamFile(text, { offset: request.offset, limit: request.limit });
    return { path: relative, ...rendered, size: file.size, modifiedAt: file.modifiedAt, ...(await withHead(resolved.store)) };
  }

  async create(hubId: string, request: TeamFileCreateRequest): Promise<TeamFileWriteResult> {
    const relative = normalizeTeamFilePath(request.path);
    assertTextPath(relative);
    if (typeof request.content !== 'string') throw new KanbanError('INVALID_INPUT', 'The team file content must be a string.');
    assertTextContent(request.content, relative);
    return this.source.exclusive(hubId, async () => {
      const resolved = this.source.store(hubId);
      await resolved.store.ensure();
      // The transport refuses a replacement itself, so a spelling the listing
      // never showed cannot be overwritten.
      const written = await resolved.store.create(relative, request.content);
      const head = written.head ?? (await headOf(resolved.store));
      return { path: relative, size: written.size, ...(head === undefined ? {} : { head }) };
    });
  }

  async edit(hubId: string, request: TeamFileEditRequest): Promise<TeamFileWriteResult> {
    const relative = normalizeTeamFilePath(request.path);
    const edits = normalizeEdits(request.edits);
    return this.source.exclusive(hubId, async () => {
      const resolved = this.source.store(hubId);
      const existing = await resolved.store.read(relative, { maxBytes: TEAM_FILE_MAX_INPUT_BYTES });
      if (existing === null) throw notFound(relative);
      assertTextPath(relative);
      const text = decodeTeamFileText(existing.bytes, relative);
      let next = text;
      for (const [index, edit] of edits.entries()) next = replaceExactlyOnce(next, edit, index, relative);
      assertTextContent(next, relative);
      await resolved.store.ensure();
      const written = await resolved.store.write(relative, next, { operation: 'edit' });
      const head = written.head ?? (await headOf(resolved.store));
      return { path: relative, size: written.size, replacements: edits.length, ...(head === undefined ? {} : { head }) };
    });
  }

  async remove(hubId: string, request: TeamFileDeleteRequest): Promise<TeamFileDeleteResult> {
    const relative = normalizeTeamFilePath(request.path);
    if (request.confirmed !== true) throw new KanbanError('CONFIRMATION_REQUIRED', 'Deleting the team file "' + relative + '" requires confirmed: true.', { path: relative });
    const trashPath = normalizeTeamFilePath(TEAM_FILES_TRASH_DIRECTORY + '/' + relative + '.' + trashTimestamp(), { allowTrash: true });
    return this.source.exclusive(hubId, async () => {
      const resolved = this.source.store(hubId);
      // The move is the existence check: a deletion never loads the file.
      const moved = await resolved.store.move(relative, trashPath, { operation: 'delete' });
      return { path: relative, trashPath: moved.path, ...(await withHead(resolved.store)) };
    });
  }
}
