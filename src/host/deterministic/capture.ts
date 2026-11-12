import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeterministicCapture } from '../../shared/deterministic.js';
import { PARAMETER_LIMITS } from '../../domain/deterministic-definition.js';
import { declaredParameterNames } from '../../domain/deterministic-parameters.js';
import type { CaptureRequest, DeterministicPolicyPort, DeterministicScope, DeterministicTrust } from './ports.js';
import { failure } from './ports.js';
import { scopeKey } from './variables.js';
import { SOURCE_MAX_BYTES, validateVariableName } from './safety.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function fingerprint(content: Omit<DeterministicCapture, 'sourceRef' | 'fingerprint'>, code: string): string {
  return digest(canonical({ ...content, format: content.language === 'typescript' ? 'function-body' : 'bash-stdin-json', code }));
}
function hash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) failure('CAPTURE_CORRUPT', 'The private execution reference is invalid; restore the capture or explicitly Play a reviewed version.');
  return value;
}
/** Immutable content-addressed bytes are ancillary; task transactions retain all control authority. */
export class DeterministicCaptureStore {
  private readonly uncommitted = new Map<string, number>();
  constructor(private readonly root: string, private readonly policy: DeterministicPolicyPort) {}
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
  async capture(request: CaptureRequest): Promise<DeterministicCapture> {
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
    const content = { language: definition.language, directory, executionDirectory, source: primary ? { kind: 'file' as const, path: primary.path } : { kind: 'inline' as const }, env, params, exits };
    const fp = fingerprint(content, code);
    const blob = canonical({ version: 1, content, code, fingerprint: fp });
    const sourceRef = digest(blob);
    this.uncommitted.set(sourceRef, (this.uncommitted.get(sourceRef) ?? 0) + 1);
    try {
      request.signal?.throwIfAborted();
      await this.immutable(join(this.root, 'sources', sourceRef + '.json'), blob);
      const capture = { ...content, fingerprint: fp, sourceRef };
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
  async load(capture: DeterministicCapture): Promise<string> {
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
    if (blob.version !== 1 || typeof blob.code !== 'string' || canonical(content) !== canonical(blob.content) || fingerprint(content, blob.code) !== fp || blob.fingerprint !== fp) failure('CAPTURE_CORRUPT', 'Private source capture does not match the durable reviewed authority.');
    return blob.code;
  }
}
export function createDeterministicTrust(root: string): DeterministicTrust {
  const path = (scope: DeterministicScope, fp: string) => join(root, 'trust', scopeKey(scope) + '-' + hash(fp) + '.json');
  return {
    async isApproved(scope, fp) {
      try { return await readFile(path(scope, fp), 'utf8') === canonical({ scope: scopeKey(scope), fingerprint: fp, approved: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    },
    async approve(scope, fp) {
      await mkdir(join(root, 'trust'), { recursive: true, mode: 0o700 });
      const text = canonical({ scope: scopeKey(scope), fingerprint: fp, approved: true });
      let file;
      try { file = await open(path(scope, fp), 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') { if (await this.isApproved(scope, fp)) return; failure('TRUST_CORRUPT', 'Remove the corrupt local approval and review this version again.'); } throw error; }
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    },
    async reject(scope, fp) { try { await unlink(path(scope, fp)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } },
  };
}
