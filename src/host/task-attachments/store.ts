import { mkdir, open, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { KanbanError } from '../../shared/errors.js';
import type { TaskAttachment, TaskAttachmentOrigin } from '../../shared/types.js';

/**
 * The plugin-owned directory that holds every task attachment's bytes.
 *
 * It exists because the platform attachment store is immutable and exposes no
 * deletion, while a task's files must be removable and must disappear with the
 * task. Objects are ordinary files, one per attachment, named by a sanitized
 * leaf name under their task's own directory.
 */
export interface StoredTaskFile {
  readonly attachment: TaskAttachment;
  /** Absolute host path of the stored object, readable with ordinary file tools. */
  readonly path: string;
}

/** One source a caller asked to attach, already resolved to bytes. */
export interface TaskFileSource {
  readonly data: Uint8Array;
  readonly name: string;
  readonly origin: TaskAttachmentOrigin;
}

const WINDOWS_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
/** The longest leaf name a supported filesystem accepts, in UTF-8 bytes. */
const MAX_LEAF_BYTES = 255;
/** Room reserved in every leaf for the identifier and its separator. */
const ID_BUDGET_BYTES = 40;
/** The longest display name that still leaves a storable leaf. */
export const MAX_DISPLAY_NAME_BYTES = MAX_LEAF_BYTES - ID_BUDGET_BYTES - 1;

/** Files an unusable name falls back to, only where a name was never supplied. */
const PLACEHOLDER_NAME = 'file';

/** Cut a string to a UTF-8 byte budget without splitting a code point. */
function utf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
}

/**
 * Reduce any caller-declared name to one safe path segment. A browser client may
 * report a full local path and a hosted source may report a relative one, so the
 * leaf is taken first and then stripped of everything a filesystem refuses.
 *
 * The byte budget covers the whole stored leaf rather than the display name alone:
 * the identifier and its separator share the same name, so a display name at the
 * filesystem maximum on its own would produce a name the filesystem refuses.
 *
 * @param value - caller-declared display name, possibly a full path.
 * @returns a leaf name usable on every supported filesystem, or the placeholder
 *   when nothing usable survives; callers that accept a name validate it first.
 */
/**
 * The usable leaf of a caller-declared name, or undefined when nothing usable survives.
 * Returning undefined rather than a placeholder keeps a real file named `file` distinct
 * from a name that sanitized away to nothing.
 *
 * @param value - caller-declared display name, possibly a full path.
 * @returns the leaf, or undefined when the name has no usable characters.
 */
export function usableAttachmentName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped here.
  let clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"|?*]/g, '_').trim()
    .replace(/[. ]+$/u, '');
  if (WINDOWS_DEVICE_NAMES.has(clean.toLowerCase())) clean = '_' + clean;
  clean = utf8Prefix(clean, MAX_DISPLAY_NAME_BYTES).replace(/[. ]+$/u, '');
  return clean === '' || clean === '.' || clean === '..' ? undefined : clean;
}

/**
 * A name for a stored leaf. Only a caller that never supplied a name reaches the
 * placeholder, because a caller-supplied name is validated before it is stored.
 *
 * @param value - caller-declared display name, possibly a full path.
 * @returns the usable leaf, or the placeholder when no name was supplied.
 */
export function sanitizeAttachmentName(value: string | undefined): string {
  return usableAttachmentName(value) ?? PLACEHOLDER_NAME;
}

/**
 * Why a caller-declared name cannot be stored, or undefined when it can.
 *
 * @param value - caller-declared display name, possibly a full path.
 * @returns an actionable message when the name is unusable.
 */
export function attachmentNameProblem(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return 'An attachment needs a file name.';
  if (usableAttachmentName(value) === undefined) {
    return 'The file name "' + value + '" has no usable characters.';
  }
  return undefined;
}

/**
 * The stored object's file name: one sanitized identifier, one sanitized display
 * name. The identifier is sanitized too because a caller can supply it directly,
 * and an identifier of `..` or one containing a separator would otherwise address
 * a path outside the task directory.
 */
/**
 * The stored identifier prefix, which is the whole identity part of a leaf. Both the
 * writer and the identity lookup go through this one function, so a lookup can never
 * miss an object the writer stored under an id that needed truncating.
 */
function storedIdPrefix(id: string): string {
  return utf8Prefix(sanitizeAttachmentName(id), ID_BUDGET_BYTES).replace(/[. ]+$/u, '') + '-';
}

function storageLeaf(id: string, name: string): string {
  return storedIdPrefix(id) + sanitizeAttachmentName(name);
}

/** The directory one task's attachment objects live in. */
function taskDirectory(root: string, taskId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(taskId)) {
    throw new KanbanError('INVALID_ID', 'Task ID must be a nonempty safe identifier.');
  }
  return join(root, taskId);
}

export class TaskAttachmentStore {
  /**
   * @param root - the plugin's private attachments directory, absolute and outside
   *   every project checkout so the files never enter version control.
   */
  constructor(private readonly root: string) {}

  /**
   * The absolute path of one attachment's stored object. Both the identifier and
   * the name are reduced to a single safe segment, so no caller-supplied value can
   * address anything outside this task's directory.
   *
   * @param taskId - owning task identity.
   * @param attachment - the recorded metadata naming the object.
   * @returns the absolute path of the stored bytes.
   */
  pathOf(taskId: string, attachment: Pick<TaskAttachment, 'id' | 'name'>): string {
    return join(taskDirectory(this.root, taskId), storageLeaf(attachment.id, attachment.name));
  }

  /**
   * Store one file for a task and return its metadata.
   *
   * @param taskId - owning task; its directory is created on first use.
   * @param source - resolved bytes, display name, and origin.
   * @param id - the attachment identity the caller allocated.
   * @returns the stored attachment and the absolute path of its bytes.
   */
  async store(taskId: string, source: TaskFileSource, id: string): Promise<StoredTaskFile> {
    // A name that sanitizes to nothing is refused rather than filed under a
    // placeholder the person never chose.
    const problem = attachmentNameProblem(source.name);
    if (problem !== undefined) throw new KanbanError('ATTACHMENT_NAME_INVALID', problem, { name: source.name });
    const directory = taskDirectory(this.root, taskId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const attachment: TaskAttachment = {
      id,
      name: sanitizeAttachmentName(source.name),
      bytes: source.data.byteLength,
      origin: source.origin,
    };
    const path = this.pathOf(taskId, attachment);
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(source.data);
      await file.sync();
    } catch (error) {
      // A partial object is worse than none: it would be indistinguishable from a
      // complete one of the wrong length, so the failed write removes itself.
      await file.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    } finally {
      await file.close().catch(() => undefined);
    }
    return { attachment, path };
  }

  /**
   * Read one attachment's exact stored bytes.
   *
   * @param taskId - owning task.
   * @param attachment - the recorded metadata, which names the object.
   * @returns the stored bytes.
   * @throws KanbanError when the object is missing or its length no longer matches.
   */
  async read(taskId: string, attachment: Pick<TaskAttachment, 'id' | 'name' | 'bytes'>): Promise<Uint8Array> {
    const path = this.pathOf(taskId, attachment);
    let handle;
    try { handle = await open(path, 'r'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new KanbanError('ATTACHMENT_MISSING', 'The attachment "' + attachment.name + '" is not present on this host.', { name: attachment.name });
    }
    try {
      // The handle is the object that was opened, so a path replaced between the
      // stat and the read cannot redirect these bytes to another file.
      const info = await handle.stat();
      if (!info.isFile()) throw new KanbanError('ATTACHMENT_NOT_A_FILE', 'The attachment "' + attachment.name + '" is not a regular file.', { name: attachment.name });
      const data = await handle.readFile();
      if (data.byteLength !== attachment.bytes) {
        throw new KanbanError('ATTACHMENT_CORRUPT', 'The attachment "' + attachment.name + '" does not match its recorded length.', { name: attachment.name, expected: attachment.bytes, actual: data.byteLength });
      }
      return data;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * Delete one attachment's bytes. A missing object is already gone, so it is not a
   * failure: the removal asked for the bytes to be absent, and they are.
   *
   * @param taskId - owning task.
   * @param attachment - the recorded metadata naming the object to delete.
   */
  async remove(taskId: string, attachment: Pick<TaskAttachment, 'id' | 'name'>): Promise<void> {
    try { await unlink(this.pathOf(taskId, attachment)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  /**
   * Delete every object of one task and its directory. Deleting a task removes its
   * files; an already-absent directory is not a failure.
   *
   * @param taskId - the task whose files are being removed.
   */
  async removeAll(taskId: string): Promise<void> {
    await rm(taskDirectory(this.root, taskId), { recursive: true, force: true });
  }

  /**
   * Read one source file from the host filesystem.
   *
   * @param path - absolute path of the source file.
   * @returns its exact bytes and display name.
   * @throws KanbanError when the path is not absolute, is missing, is not a regular
   *   file, or cannot be read.
   */
  static async readSourcePath(path: string): Promise<{ data: Uint8Array; name: string }> {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new KanbanError('ATTACHMENT_PATH_INVALID', 'An attachment path must be an absolute path.', { path });
    }
    if (path.includes(String.fromCharCode(0))) {
      throw new KanbanError('ATTACHMENT_PATH_INVALID', 'An attachment path cannot contain a NUL byte.', { path });
    }
    let info;
    try { info = await stat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new KanbanError('ATTACHMENT_UNREADABLE', 'The file "' + path + '" could not be read.', { path });
      }
      throw new KanbanError('ATTACHMENT_NOT_FOUND', 'The file "' + path + '" does not exist.', { path });
    }
    if (!info.isFile()) {
      throw new KanbanError('ATTACHMENT_NOT_A_FILE', 'The path "' + path + '" is not a regular file.', { path });
    }
    try {
      const data = await readFile(path);
      return { data, name: path.slice(path.lastIndexOf('/') + 1) };
    } catch (error) {
      throw new KanbanError('ATTACHMENT_UNREADABLE', 'The file "' + path + '" could not be read.', { path, cause: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Whether this task's directory currently holds any object; used by tests and diagnostics. */
  async list(taskId: string): Promise<string[]> {
    try { return await readdir(taskDirectory(this.root, taskId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }

  /**
   * Read one object of an owner by its identifier alone, deriving the display name and
   * the byte length from what is actually on disk. A caller-supplied name or length is
   * never trusted for this: the reference a client holds is an identity, not proof of
   * the object it names.
   *
   * @param ownerId - the owning task or conversation identity.
   * @param attachmentId - the identity the caller received when the object was stored.
   * @returns the stored bytes with the name and length the host recorded.
   * @throws KanbanError when no object of this owner carries that identity, or when
   *   more than one does.
   */
  async readOwned(ownerId: string, attachmentId: string): Promise<{ data: Uint8Array; attachment: TaskAttachment }> {
    const directory = taskDirectory(this.root, ownerId);
    const prefix = storedIdPrefix(attachmentId);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new KanbanError('ATTACHMENT_MISSING', 'That file is no longer stored for this conversation.', { attachmentId });
    }
    const matches = entries.filter(entry => entry.startsWith(prefix));
    if (matches.length === 0) {
      throw new KanbanError('ATTACHMENT_MISSING', 'That file is no longer stored for this conversation.', { attachmentId });
    }
    if (matches.length > 1) {
      throw new KanbanError('ATTACHMENT_AMBIGUOUS', 'More than one stored file matches that reference.', { attachmentId });
    }
    const leaf = matches[0]!;
    const handle = await open(join(directory, leaf), 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new KanbanError('ATTACHMENT_NOT_A_FILE', 'The stored attachment is not a regular file.', { attachmentId });
      const data = await handle.readFile();
      // The recorded name and length come from the host, so a tampered reference cannot
      // widen what is returned or relabel the file.
      const name = leaf.slice(prefix.length);
      return { data, attachment: { id: attachmentId, name, bytes: data.byteLength, origin: 'upload' } };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  /**
   * Delete every stored object of one owner that the caller no longer references. The
   * caller passes the identities that survive, so this never needs to understand the
   * record that named them; an object whose identity is absent is unreachable and is
   * removed.
   *
   * @param ownerId - the owning conversation or task identity.
   * @param keep - identities the caller still references.
   */
  async removeUnreferenced(ownerId: string, keep: ReadonlySet<string>): Promise<void> {
    const directory = taskDirectory(this.root, ownerId);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    // Each surviving identity contributes exactly the prefix its object was stored under.
    const prefixes = new Set([...keep].map(kept => storedIdPrefix(kept)));
    const failures: string[] = [];
    for (const entry of entries) {
      if ([...prefixes].some(prefix => entry.startsWith(prefix))) continue;
      try { await unlink(join(directory, entry)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        failures.push(entry);
      }
    }
    // A failure is reported rather than dropped: the caller must not claim a clean sweep.
    if (failures.length > 0) {
      throw new KanbanError('ATTACHMENT_DELETE_FAILED', 'Some stored files could not be deleted.', { failed: failures.length });
    }
  }

  /**
   * Delete exactly the named identities of one owner, leaving every other object alone.
   *
   * @param ownerId - the owning conversation or task identity.
   * @param ids - the identities whose bytes must be removed.
   */
  async removeIds(ownerId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const directory = taskDirectory(this.root, ownerId);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    // Each identity was stored under exactly the prefix this computes, so the match is
    // the same one the writer used.
    const prefixes = ids.map(id => storedIdPrefix(id));
    for (const entry of entries) {
      if (!prefixes.some(prefix => entry.startsWith(prefix))) continue;
      try { await unlink(join(directory, entry)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
    }
  }
}
