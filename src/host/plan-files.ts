/**
 * The host adapter for the confined plan-file port. It is the only place in the
 * plugin that reaches the host filesystem and the sandbox policy, so the plan
 * tools depend on a port instead of on host internals, and every confinement
 * decision stays in one file.
 *
 * A plan write is fenced twice on purpose. This adapter canonicalizes the target
 * and refuses one outside the plan directory, which produces an actionable
 * problem for a plain argument mistake; the host's sandboxed filesystem then
 * re-fences the mutation on a freshly resolved path, which is what also catches a
 * symlink ancestor swapped between the two checks. Neither check is trusted alone.
 *
 * The host fence is necessary but not sufficient here. Under `workspace-write` the
 * host also grants the platform temp areas and only fences the target path, and a
 * bare local backend ignores the per-call policy entirely. This adapter therefore
 * refuses to write at all unless the mounted backend confines, and it validates
 * the file itself rather than only its parent.
 * @module host/plan-files
 */
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { PlanEditRequest, PlanFileOutcome, PlanFilePatch, PlanFilePort, PlanFileWrite } from '../shared/ports.js';
import { KanbanError, invariant } from '../shared/errors.js';
import { applyPlanEdits, planFileName, PLAN_DIRECTORY, planSegment } from '../domain/plan-path.js';
import { isWithinPath } from './paths.js';
import { optionalService } from './scripted/native-policy.js';

/** The host filesystem surface one plan mutation needs. */
type HostFileSystem = Pick<FileSystem, 'resolve' | 'lstat' | 'stat' | 'readText' | 'writeText'> & { readonly sandboxMode?: string | undefined };

/** How long one workspace lookup may take before the call reports an unavailable directory. */
const WORKSPACE_LOOKUP_TIMEOUT_MS = 30_000;

/** The segment and file parts a plan path carries, once the domain rule has normalized them. */
interface PlanParts { readonly segment: string; readonly file: string }

function unavailable(detail: string): KanbanError {
  return new KanbanError('PLAN_FILES_UNAVAILABLE', detail);
}

/**
 * Split a validated workspace-relative plan path back into its two parts.
 * @param relativePath - the path the domain rule built: plans/<segment>/<file>.
 * @returns the segment and the file name.
 */
function planParts(relativePath: string): PlanParts {
  const parts = relativePath.split('/');
  invariant(parts.length === 3 && parts[0] === PLAN_DIRECTORY,
    'PLAN_PATH_REFUSED',
    'A plan path is ' + PLAN_DIRECTORY + '/<segment>/<file>.md and nothing else.');
  const segment = parts[1]!;
  const file = parts[2]!;
  // Each part is re-validated with the domain rule rather than trusted by shape:
  // a split of "plans/../escape.md" has three parts, so a count alone would accept
  // a parent segment and join it onto the trusted root.
  invariant(planSegment(segment) === segment,
    'PLAN_PATH_REFUSED',
    'A plan segment is a lowercase slug of letters, digits, and single hyphens.');
  invariant(planFileName(file) === file,
    'PLAN_PATH_REFUSED',
    'A plan file is a bare Markdown file name.');
  return { segment, file };
}

/**
 * Prove one entry is the direct child of a validated parent and is not a link.
 *
 * `lstat` is the only reliable no-follow check: `realpath` cannot tell a missing
 * entry from a dangling link, and it follows a link before judging where it lands.
 * A link of any kind is refused, so nothing below can be redirected after this
 * point; an absent entry is the one case that may be created.
 * @param fs - the host filesystem.
 * @param parent - the absolute parent the entry must sit directly under.
 * @param name - the entry name.
 * @returns whether the entry exists.
 */
async function assertDirectEntry(fs: HostFileSystem, parent: string, name: string): Promise<boolean> {
  const entry = await fs.lstat(path.join(parent, name));
  invariant(
    entry === undefined || (entry.type !== 'symlink' && entry.type !== 'other'),
    'PLAN_PATH_REFUSED',
    'A plan path entry is a link or a special file. Replace it with a real directory or file before writing a plan.',
  );
  invariant(
    entry === undefined || entry.type === 'directory' || entry.type === 'file',
    'PLAN_PATH_REFUSED',
    'A plan path entry is neither a directory nor a file.',
  );
  return entry !== undefined;
}

/**
 * Resolve one plan path inside a workspace and prove it belongs to the plan
 * directory before anything is written.
 *
 * Every component is checked as a direct, non-link entry of its validated parent,
 * so a link can neither redirect the write nor hide a redirect from a later check:
 * the plans directory, the segment, and the file. Only a genuinely absent
 * component takes the creation path, and creation happens after every check that
 * can be made without writing.
 * @param fs - the host filesystem.
 * @param workspace - the conversation absolute workspace directory.
 * @param relativePath - the validated workspace-relative plan path.
 * @param create - whether a missing plan directory may be created.
 * @returns the absolute target path and the canonical segment directory.
 */
async function confinedTarget(fs: HostFileSystem, workspace: string, relativePath: string, create: boolean): Promise<{ target: string; planRoot: string }> {
  const { segment, file } = planParts(relativePath);
  let workspaceRoot: string;
  try { workspaceRoot = await realpath(workspace); }
  catch { throw unavailable('The conversation workspace could not be resolved.'); }
  const plansRoot = path.join(workspaceRoot, PLAN_DIRECTORY);
  // Each level is proven a real directory BEFORE the next level is inspected, because
  // an lstat of a child follows the link of an ancestor: a link at plans/ would make
  // every check below it describe a directory outside the fence.
  await requireOrCreateDirectory(fs, workspaceRoot, PLAN_DIRECTORY, plansRoot, create);
  const segmentRoot = path.join(plansRoot, segment);
  await requireOrCreateDirectory(fs, plansRoot, segment, segmentRoot, create);
  const leaf = path.join(segmentRoot, file);
  await assertDirectEntry(fs, segmentRoot, file);
  return { target: leaf, planRoot: segmentRoot };
}

/**
 * The policy one plan mutation runs under. The root is the plan segment, never
 * the session's own workspace, so this call grants one directory and nothing the
 * session standing mode would grant.
 */
function planPolicy(segmentRoot: string): SandboxExecutionPolicy {
  return { mode: 'workspace-write', workspaceRoot: segmentRoot };
}

/** The edit collection the domain rule applies, in the shape it declares. */
function asPlanEdits(edits: readonly PlanEditRequest[]): readonly { old: string; new: string }[] {
  return edits.map(edit => ({ old: edit.old, new: edit.new }));
}

/**
 * Require one plan path level to be a real directory, creating it when allowed.
 * @param fs - the host filesystem.
 * @param parent - the validated absolute parent.
 * @param name - the directory entry name under the parent.
 * @param absolute - the absolute path of that entry.
 * @param create - whether an absent entry may be created.
 */
async function requireOrCreateDirectory(fs: HostFileSystem, parent: string, name: string, absolute: string, create: boolean): Promise<void> {
  if (!(await assertDirectEntry(fs, parent, name))) {
    invariant(create, 'PLAN_NOT_FOUND', 'That plan directory does not exist yet. Create it with write_plan first.');
    await createDirectory(absolute);
  }
  // Read the entry again after creation, so a cooperating creator that produced a
  // link or a file instead of a directory is refused here rather than below.
  const info = await fs.lstat(absolute);
  invariant(info?.type === 'directory', 'PLAN_PATH_REFUSED',
    'A plan path level is not a directory, so no plan can be written inside it.');
}

/**
 * Create one plan directory that was observed absent.
 *
 * Two cooperating calls in the same workspace can both observe the directory
 * missing and both try to create it. Only an `EEXIST` from that race is
 * tolerated: the caller re-checks the entry right after, so a non-directory or a
 * link written by the winner is still refused there.
 * @param directory - the absolute directory to create.
 */
async function createDirectory(directory: string): Promise<void> {
  try { await mkdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/**
 * Whether two paths name the same directory once links are resolved.
 * @param left - one absolute path.
 * @param right - another absolute path.
 * @returns true when both resolve to the same directory.
 */
async function sameDirectory(left: string, right: string): Promise<boolean> {
  try { return (await realpath(left)) === (await realpath(right)); }
  catch { return false; }
}

/**
 * Bind the plan-file port to one host context.
 * @param ctx - the plugin context holding the filesystem, the sandbox policy, and the workspace service.
 * @returns the port the plan tools call.
 */
export function createPlanFilePort(ctx: Context): PlanFilePort {
  const filesystem = (): HostFileSystem => {
    const fs = optionalService<HostFileSystem>(ctx, 'fs');
    if (fs === undefined) throw unavailable('This host mounts no filesystem capability, so it cannot write a plan file.');
    return fs;
  };
  /**
   * Confine or refuse. Two conditions have to hold for the per-call policy to mean
   * anything: a policy service must exist to build it, and the mounted filesystem
   * must be the confining backend. The bare local backend reports no sandbox mode
   * and ignores a per-call policy, so writing through it would be unconfined.
   */
  const requireConfinement = (fs: HostFileSystem): void => {
    if (optionalService<unknown>(ctx, 'sandboxPolicy') === undefined) {
      throw unavailable('This host mounts no sandbox policy, so a plan write cannot be confined and is refused.');
    }
    if (fs.sandboxMode === undefined) {
      throw unavailable('This host mounts a filesystem backend that does not confine, so a plan write cannot be bounded to its directory and is refused.');
    }
  };
  /**
   * The workspace a plan write is authorized under: the directory recorded when the
   * conversation was created, never the current one.
   *
   * The mounted working-directory tool lets a model change a session's directory, and
   * a fence computed from that mutable value would move with it: a model that entered
   * another directory could then write plans inside it. The plan is bound to the
   * origin instead, and a session whose current directory differs is refused rather
   * than silently written elsewhere.
   */
  const workspaceOf = async (request: PlanFileWrite | PlanFilePatch): Promise<string> => {
    const origin = request.origin(request.session);
    if (origin === undefined) throw unavailable('This plan call cannot read the directory the conversation was created in, so no plan can be written.');
    const service = optionalService<{ ensure(agent: never, signal?: AbortSignal): Promise<string> }>(ctx, 'workingDirectory');
    if (service !== undefined) {
      const current = await service.ensure(request.agent as never, AbortSignal.timeout(WORKSPACE_LOOKUP_TIMEOUT_MS));
      // Compare filesystem identity, not spellings: returning to the origin through
      // an equivalent path must not read as leaving it.
      const same = await sameDirectory(current, origin);
      invariant(
        same,
        'PLAN_WORKSPACE_CHANGED',
        "This conversation left the directory it was created in, and a plan is written only there. Return to " + origin + " before writing a plan.",
      );
    }
    return origin;
  };
  /** Resolve one plan target, creating a missing directory only when allowed. */
  const targetFor = async (fs: HostFileSystem, request: PlanFileWrite | PlanFilePatch, create: boolean) =>
    confinedTarget(fs, await workspaceOf(request), request.relativePath, create);

  return {
    async write(request: PlanFileWrite): Promise<PlanFileOutcome> {
      const fs = filesystem();
      requireConfinement(fs);
      const { target, planRoot } = await targetFor(fs, request, true);
      const resolved = await fs.resolve(target);
      // Unconditional but atomic: write_plan replaces the file on purpose, and the
      // confinement above decides WHICH file may be replaced.
      const outcome = await fs.writeText(resolved, request.content, undefined, undefined, planPolicy(planRoot));
      return { operation: outcome.operation, path: target };
    },
    async patch(request: PlanFilePatch): Promise<PlanFileOutcome> {
      const fs = filesystem();
      requireConfinement(fs);
      const { target, planRoot } = await targetFor(fs, request, false);
      const resolved = await fs.resolve(target);
      const existing = await fs.stat(resolved);
      invariant(existing?.type === 'file', 'PLAN_NOT_FOUND', 'That plan file does not exist yet. Create it with write_plan first.');
      // The whole batch lands in one write, so the file never holds half of the
      // replacements. The version guard turns a concurrent change into a refusal
      // instead of a lost update.
      const patched = applyPlanEdits(await fs.readText(resolved), asPlanEdits(request.edits));
      const outcome = await fs.writeText(
        resolved,
        patched,
        { kind: 'replaceIfVersion', version: existing.version },
        undefined,
        planPolicy(planRoot),
      );
      return { operation: outcome.operation, path: target };
    },
  };
}