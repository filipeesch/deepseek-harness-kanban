/**
 * The plan-file tools. They are the planner's only write capability: the role
 * mounts no general write or edit tool and its session starts confined, so these
 * two names are the whole surface through which a plan becomes a file.
 *
 * Both tools accept a file name and nothing resembling a path, derive the plan
 * directory themselves, and delegate every confinement decision to the port. A
 * caller therefore cannot name a directory, request a sandbox mode, or widen the
 * grant by argument.
 * @module host/tools/plan-files
 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { PlanFilePort } from '../../shared/ports.js';
import { invariant } from '../../shared/errors.js';
import { planFileName, planRelativePath, planSegment } from '../../domain/plan-path.js';
import { normal, text } from './support.js';
import { taskContext, type TaskScopeSource, type ToolArgs } from './scope.js';
import type { LocatedTask } from '../hub-repository.js';

/** What the plan tools need: the card lookup, the port, and nothing else. */
export interface PlanToolDeps {
  readonly source: TaskScopeSource;
  readonly plans: PlanFilePort;
  /** Read the directory the conversation was created in; the plan authority anchors there. */
  readonly origin: (session: unknown) => string | undefined;
  /** Read a session parent, so a delegated child resolves the task that owns it. */
  readonly parentOf: (session: unknown) => string | undefined;
  /** Load a session by identifier when the host can, so a deeper lineage still resolves. */
  readonly sessionById?: (sessionId: string) => unknown;
}

const PROJECT_NAME_ARGUMENT = 'Name of the project being planned, used as the plan directory. Required in an ordinary chat, where no card supplies it.';
const FILE_NAME_ARGUMENT = 'Bare plan file name ending in .md. The directory is derived: plans/<segment>/.';

/**
 * The segment one call writes under: the owning card's title, or the name the
 * caller supplied when the conversation belongs to no card.
 * @param deps - the card lookup and the tool arguments.
 * @param args - the call arguments, which may carry a project name.
 * @param exec - the calling execution, whose agent identifies the task.
 * @returns the normalized segment.
 */
/**
 * The task that owns a delegated descendant, found through verified parent links.
 * @param deps - the card lookup and the parent reader.
 * @param exec - the calling execution.
 * @returns the owning task, or undefined for a session with no task ancestor.
 */
function ancestryTask(deps: PlanToolDeps, exec: ToolRunContext): LocatedTask | undefined {
  let parentId = deps.parentOf(exec.agent?.session);
  // A bounded walk keeps a corrupt lineage from looping forever. Every identifier
  // comes from the immutable parent link, so the walk does not depend on a live
  // session being loaded.
  for (let depth = 0; depth < 32 && parentId !== undefined; depth += 1) {
    const located = deps.source.locator.bySession(parentId);
    if (located !== undefined) return located;
    const next = deps.sessionById?.(parentId);
    parentId = next === undefined ? undefined : deps.parentOf(next);
  }
  return undefined;
}

function segmentOf(deps: PlanToolDeps, args: ToolArgs & { project?: string }, exec: ToolRunContext): string {
  // A delegated child is not registered on the card itself, so the owning task is
  // found by walking verified parent links. Without this the child would fall through
  // to the declared-name branch and could write a sibling segment its task parent
  // cannot target, which is an authorization expansion rather than a naming choice.
  const direct = taskContext(deps.source, exec);
  const located = direct ?? ancestryTask(deps, exec);
  // A session that HAS a parent is a delegated descendant, so its owning card must be
  // resolvable. Falling back to a declared name there would let a child choose a
  // segment its task parent cannot target, so an unverified lineage fails closed.
  invariant(
    located !== undefined || direct !== undefined || deps.parentOf(exec.agent?.session) === undefined,
    'PLAN_OWNER_UNVERIFIED',
    'This conversation was started by another conversation, and the card that owns it could not be verified. Write the plan from that card or its own conversation.',
  );
  const fromCard = located === undefined ? undefined : planSegment(located.task.title);
  const declared = args.project === undefined ? undefined : planSegment(args.project);
  const segment = fromCard ?? declared;
  invariant(segment !== undefined, 'PLAN_SEGMENT_REQUIRED',
    'Name the project being planned with a project argument, or call this from the conversation of a card whose title names it.');
  return segment;
}

export function planTools(deps: PlanToolDeps): ToolDefinition[] {
  return [
    normal('write_plan', 'Create or replace a Markdown plan file under plans/<segment>/ in this conversation workspace. The segment is the card title in a task conversation, or the project name you supply in an ordinary chat. Use it when the plan you agreed with the person is ready to become a file. It never stages, commits, or pushes anything: whether the plan enters a commit is the person decision.', {
      project: text(PROJECT_NAME_ARGUMENT),
      file: text(FILE_NAME_ARGUMENT, true),
      content: text('Complete Markdown content of the plan.', true),
    }, async (args, exec) => {
      const name = planFileName(args.file);
      const segment = segmentOf(deps, args as ToolArgs & { project?: string }, exec);
      invariant(exec.agent !== undefined, 'MISSING_SESSION', 'Writing a plan requires an owning native conversation.');
      const outcome = await deps.plans.write({ agent: exec.agent, session: exec.agent.session, origin: deps.origin, relativePath: planRelativePath(segment, name), content: args.content });
      return { path: outcome.path, segment, file: name, operation: outcome.operation };
    }),
    normal('patch_plan', 'Apply literal replacements to an existing plan file under plans/<segment>/ in this conversation workspace. Each searched text must occur exactly once; the whole call applies or nothing does. Use it to correct a plan instead of rewriting it. It never stages, commits, or pushes anything.', {
      project: text(PROJECT_NAME_ARGUMENT),
      file: text(FILE_NAME_ARGUMENT, true),
      edits: {
        type: 'array' as const,
        required: true as const,
        description: 'Replacements applied together; each searched text must occur exactly once.',
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            old: text('Existing text to replace; must occur exactly once in the plan.', true),
            new: text('Replacement text; an empty string deletes the matched text.', true),
          },
        },
      },
    }, async (args, exec) => {
      const name = planFileName(args.file);
      const segment = segmentOf(deps, args as ToolArgs & { project?: string }, exec);
      invariant(exec.agent !== undefined, 'MISSING_SESSION', 'Patching a plan requires an owning native conversation.');
      invariant(Array.isArray(args.edits) && args.edits.length > 0, 'INVALID_INPUT', 'Provide at least one replacement; use write_plan to rewrite a whole plan.');
      const outcome = await deps.plans.patch({ agent: exec.agent, session: exec.agent.session, origin: deps.origin, relativePath: planRelativePath(segment, name), edits: args.edits });
      return { path: outcome.path, segment, file: name, operation: outcome.operation, edits: args.edits.length };
    }),
  ];
}