import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScriptedApprovalOrigin, ScriptedCapture, ScriptedDefinition } from '../../shared/scripted.js';
import { PARAMETER_LIMITS } from '../../domain/scripted-definition.js';
import { declaredParameterNames } from '../../domain/scripted-parameters.js';
import type { CapturePlan, CaptureRequest, ScriptedApprovalRecord, ScriptedApprovalScope, ScriptedPolicyPort, ScriptedTrust } from './ports.js';
import { failure } from './ports.js';
import { approvalScopeKey } from './variables.js';
import { SOURCE_MAX_BYTES, validateVariableName } from './safety.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
/**
 * The approved version excludes execution context: the resolved directory and the
 * resolved primary path. Two entries of the same board and stage that read the
 * same authored source and capabilities therefore share it.
 */
function versionContent(content: Omit<ScriptedCapture, 'sourceRef' | 'fingerprint'>): Omit<ScriptedCapture, 'sourceRef' | 'fingerprint' | 'executionDirectory'> {
  const { executionDirectory: _executionDirectory, source, ...version } = content;
  return { ...version, source: source.kind === 'file' ? { kind: 'file' as const, ...(source.reference === undefined ? {} : { reference: source.reference }) } : { kind: 'inline' as const } };
}
function fingerprint(content: Omit<ScriptedCapture, 'sourceRef' | 'fingerprint'>, code: string): string {
  return digest(canonical({ ...versionContent(content), format: content.language === 'typescript' ? 'function-body' : 'bash-stdin-json', code }));
}
/** The pre-upgrade hash trusted the execution directory and the resolved path. */
function legacyFingerprint(content: Omit<ScriptedCapture, 'sourceRef' | 'fingerprint'>, code: string): string {
  return digest(canonical({ ...content, format: content.language === 'typescript' ? 'function-body' : 'bash-stdin-json', code }));
}
function hash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) failure('CAPTURE_CORRUPT', 'The private execution reference is invalid; restore the capture or explicitly Play a reviewed version.');
  return value;
}
/** Immutable content-addressed bytes are ancillary; task transactions retain all control authority. */
export class ScriptedCaptureStore {
  private readonly uncommitted = new Map<string, number>();
  constructor(private readonly root: string, private readonly policy: ScriptedPolicyPort) {}
  private async immutable(path: string, text: string): Promise<void> {
    await mkdir(join(this.root, 'sources'), { recursive: true, mode: 0o700 });
    let file;
    try { file = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await readFile(path, 'utf8') !== text) failure('CAPTURE_CORRUPT', 'An immutable capture already exists with different bytes.');
      return;
    }
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  }
  /**
   * The capture one definition resolves to, computed without storing anything.
   *
   * A write report asks what a proposed executable would fingerprint to, and that
   * answer must be the bytes the capturing path would authorize. Sharing this
   * computation is what keeps the answer honest; the store keeps only the
   * immutable write and its verification.
   */
  async plan(request: CaptureRequest): Promise<CapturePlan> {
    request.signal?.throwIfAborted();
    const definition = request.definition;
    if ((definition.code === undefined) === (definition.file === undefined)) failure('SOURCE_INVALID', 'Select exactly one inline code or primary file source.');
    if (definition.language !== 'typescript' && definition.language !== 'bash') failure('LANGUAGE_UNSUPPORTED', 'Select Bash or function-body TypeScript.');
    const directory = definition.directory ?? 'task';
    if (directory !== 'task' && directory !== 'project') failure('DIRECTORY_INVALID', 'Select task or project execution scope.');
    const selected = directory === 'project' ? request.projectDirectory : request.taskDirectory ?? request.projectDirectory;
    const executionDirectory = await this.policy.directory(selected, request.signal);
    const primary = definition.file === undefined ? undefined : await this.policy.source(definition.file, executionDirectory, request.signal);
    const code = primary?.code ?? definition.code ?? '';
    if (!code.trim() || Buffer.byteLength(code) > SOURCE_MAX_BYTES) failure('SOURCE_INVALID', 'Primary source must be nonempty and at most 128 KiB.');
    const env = [...new Set(definition.env ?? [])].sort();
    if (env.length > 64) failure('INVALID_VARIABLE', 'At most 64 authorized variables are supported.');
    env.forEach(validateVariableName);
    const params = [...new Set(declaredParameterNames(definition.params))].sort();
    if (params.length > PARAMETER_LIMITS.count) failure('INVALID_PARAMETERS', 'At most ' + PARAMETER_LIMITS.count + ' parameters are supported.');
    const exits = structuredClone(request.exits);
    if (Object.keys(definition.exits).length === 0 || canonical(Object.keys(definition.exits).sort()) !== canonical(Object.keys(exits).sort())) failure('ROUTES_INVALID', 'Every authored exit must resolve to a stable destination.');
    for (const [name, target] of Object.entries(exits)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || !target.columnId || !target.stageIdentity || definition.exits[name] !== target.columnId) failure('ROUTES_INVALID', 'Captured exits must match reviewed authored destinations and stable identities.');
    }
    const content = { language: definition.language, directory, executionDirectory,
      source: primary ? { kind: 'file' as const, path: primary.path, ...(definition.file === undefined ? {} : { reference: definition.file }) } : { kind: 'inline' as const },
      env, params, exits };
    return { content, code, fingerprint: fingerprint(content, code) };
  }

  /** Store one planned capture as the immutable bytes an approval names. */
  async capture(request: CaptureRequest): Promise<ScriptedCapture> {
    const plan = await this.plan(request);
    const blob = canonical({ version: 1, content: plan.content, code: plan.code, fingerprint: plan.fingerprint });
    const sourceRef = digest(blob);
    this.uncommitted.set(sourceRef, (this.uncommitted.get(sourceRef) ?? 0) + 1);
    try {
      request.signal?.throwIfAborted();
      await this.immutable(join(this.root, 'sources', sourceRef + '.json'), blob);
      const capture: ScriptedCapture = { ...plan.content, fingerprint: plan.fingerprint, sourceRef };
      await this.load(capture);
      return capture;
    } catch (error) { this.releaseSource(sourceRef); throw error; }
  }
  /** Drop a transient capture pin once its admission or preview has settled. */
  releaseSource(sourceRef: string): void {
    const ref = hash(sourceRef); const count = this.uncommitted.get(ref) ?? 0;
    if (count > 1) this.uncommitted.set(ref, count - 1); else this.uncommitted.delete(ref);
  }
  /** Call only with the complete durable reference set, after affected processes drain. */
  async collectSources(referenced: readonly string[]): Promise<void> {
    const retained = new Set(referenced.map(hash));
    let files: string[];
    try { files = await readdir(join(this.root, 'sources')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || retained.has(name.slice(0, -5)) || this.uncommitted.has(name.slice(0, -5))) continue;
      try { await unlink(join(this.root, 'sources', name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  async load(capture: ScriptedCapture): Promise<string> {
    let text: string;
    try {
      const path = join(this.root, 'sources', hash(capture.sourceRef) + '.json');
      if ((await stat(path)).size > SOURCE_MAX_BYTES * 8) failure('CAPTURE_CORRUPT', 'The private source capture exceeds its storage bound.');
      text = await readFile(path, 'utf8');
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') failure('CAPTURE_MISSING', 'The reviewed private source capture is missing; restore it or explicitly Play a newly reviewed version.');
      throw error;
    }
    if (digest(text) !== capture.sourceRef || Buffer.byteLength(text) > SOURCE_MAX_BYTES * 8) failure('CAPTURE_CORRUPT', 'The reviewed private source capture failed integrity verification.');
    let blob: { version?: number; content?: unknown; code?: unknown; fingerprint?: string };
    try { blob = JSON.parse(text) as typeof blob; } catch { return failure('CAPTURE_CORRUPT', 'Private source capture is not valid JSON.'); }
    const { sourceRef: _ref, fingerprint: fp, ...content } = capture;
    if (blob.version !== 1 || typeof blob.code !== 'string' || canonical(content) !== canonical(blob.content)) failure('CAPTURE_CORRUPT', 'Private source capture does not match the durable reviewed authority.');
    if ((fingerprint(content, blob.code) !== fp && legacyFingerprint(content, blob.code) !== fp) || blob.fingerprint !== fp) failure('CAPTURE_CORRUPT', 'Private source capture does not match the durable reviewed authority.');
    return blob.code;
  }
  /**
   * Persist the current version identity for a verified legacy capture without
   * rereading the primary source. A new immutable blob carries the normalized
   * metadata and fingerprint; the task adopts the new reference in its own
   * transaction, and the superseded blob becomes collectable.
   */
  async normalize(capture: ScriptedCapture, definition: ScriptedDefinition): Promise<ScriptedCapture> {
    const code = await this.load(capture);
    const normalized = normalizeCapture(capture, definition, code);
    if (normalized.fingerprint === capture.fingerprint && normalized.source.reference === capture.source.reference) return capture;
    const { sourceRef: _sourceRef, fingerprint: _fingerprint, ...content } = normalized;
    const text = canonical({ version: 1, content, code, fingerprint: normalized.fingerprint });
    const sourceRef = digest(text);
    if (Buffer.byteLength(text) > SOURCE_MAX_BYTES * 8) failure('CAPTURE_CORRUPT', 'The normalized private source capture exceeds its storage bound.');
    this.uncommitted.set(sourceRef, (this.uncommitted.get(sourceRef) ?? 0) + 1);
    try {
      await this.immutable(join(this.root, 'sources', sourceRef + '.json'), text);
      const adopted = { ...normalized, sourceRef };
      await this.load(adopted);
      return adopted;
    } catch (error) { this.releaseSource(sourceRef); throw error; }
  }
}
interface StoredApproval { version?: number; scope?: string; fingerprint?: string; approved?: boolean; approvedAt?: string; origin?: string }

/**
 * Read one recorded approval, rejecting a record that does not describe this exact
 * scope and version. A record written before the origin existed was an explicit
 * review, which is what it was.
 */
function readApproval(text: string, scope: ScriptedApprovalScope, fingerprintValue: string): ScriptedApprovalRecord | undefined {
  let record: StoredApproval;
  try { record = JSON.parse(text) as StoredApproval; } catch { return undefined; }
  if (record.version !== 1 || record.scope !== approvalScopeKey(scope) || record.fingerprint !== fingerprintValue || record.approved !== true) return undefined;
  if (typeof record.approvedAt !== 'string' || record.approvedAt.length === 0) return undefined;
  const origin: ScriptedApprovalOrigin = record.origin === 'author-save' ? 'author-save' : 'review';
  return { origin, approvedAt: record.approvedAt };
}

function approvalRecord(scope: ScriptedApprovalScope, fingerprintValue: string, approvedAt: string, origin: ScriptedApprovalOrigin): string {
  return canonical({ version: 1, scope: approvalScopeKey(scope), fingerprint: fingerprintValue, approved: true, approvedAt, origin });
}
/**
 * Rewrite a verified stored capture into the current version identity without
 * rereading the primary source. A pre-upgrade capture keeps its bytes and
 * execution directory; only the authority changes.
 */
export function normalizeCapture(capture: ScriptedCapture, definition: ScriptedDefinition, code: string): ScriptedCapture {
  const source = capture.source.kind === 'file'
    ? { kind: 'file' as const, ...(capture.source.path === undefined ? {} : { path: capture.source.path }), ...(definition.file === undefined ? {} : { reference: definition.file }) }
    : { kind: 'inline' as const };
  const content = { ...capture, source };
  const { sourceRef: _sourceRef, fingerprint: _fingerprint, ...hashed } = content;
  return { ...content, fingerprint: fingerprint(hashed, code) };
}
export function createScriptedTrust(root: string): ScriptedTrust {
  const path = (scope: ScriptedApprovalScope, fp: string) => join(root, 'trust', approvalScopeKey(scope) + '-' + hash(fp) + '.json');
  const read = async (scope: ScriptedApprovalScope, fp: string): Promise<ScriptedApprovalRecord | undefined> => {
    try { return readApproval(await readFile(path(scope, fp), 'utf8'), scope, fp); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  return {
    async isApproved(scope, fp) { return await read(scope, fp) !== undefined; },
    approval: (scope, fp) => read(scope, fp),
    // A caller outside this build may still name only the scope and the version;
    // such an approval was an explicit review, which is what the record says.
    async approve(scope, fp, origin: ScriptedApprovalOrigin = 'review') {
      await mkdir(join(root, 'trust'), { recursive: true, mode: 0o700 });
      const text = approvalRecord(scope, fp, new Date().toISOString(), origin);
      let file;
      try { file = await open(path(scope, fp), 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') { if (await this.isApproved(scope, fp)) return; failure('TRUST_CORRUPT', 'Remove the corrupt local approval and review this version again.'); } throw error; }
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    },
  };
}
