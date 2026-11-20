# Design

## Context

See [proposal.md](proposal.md) - Why for the motivation. The constraints that shape the approach are
host facts, verified against the pinned DSH source rather than assumed:

- A preset is an agent's own plugin composition. The Kanban plugin registers its product tools in the
  application scope, and every preset inherits them, so a preset that names nothing still sees the
  whole product surface. `ctx.tools.restrict({ deny })` masks inherited tools per agent scope, and
  `ctx.tools.register(definition, { when })` declares one conditionally.
- The existing step-time gate in [`src/host/tools/index.ts`](../../../src/host/tools/index.ts) reads
  `agentPresets.presetForSession` and compares it with the hard-coded workflow architect preset.
- Sandbox policy is per session and per call. `ctx.sandboxPolicy.resolve({ session })` returns the
  session's mode; a mutating filesystem call accepts an explicit
  `SandboxExecutionPolicy { mode, workspaceRoot, additionalWritableRoots? }` for that call.
- `additionalWritableRoots` only ever WIDENS a grant. There is no host mode that permits writing
  under one directory and denies the rest of the workspace, so a plan-only write cannot be expressed
  by moving the session to `workspace-write`.
- The sandboxed filesystem checks containment on the target's fresh canonical path before delegating.
  Under `workspace-write` it also grants the platform temp areas, and a bare local backend ignores a
  per-call policy, so the host fence alone is not a plan-only boundary.
- `ctx.workingDirectory.ensure(agent, signal)` returns the conversation CURRENT directory, which the
  mounted `working_directory` tool lets a model change. It is therefore not the plan authority; the
  immutable directory recorded in the session header at creation is, because a fence computed from a
  mutable value would move with it.

## Goals / Non-Goals

**Goals:**

- One write capability for the planner, and a boundary that survives the model disagreeing with it.
- Reuse the host's filesystem provider so a plan write keeps atomic publication, canonical path
  identity, and the host's own error vocabulary.
- Reuse the existing per-preset declaration gate rather than adding a second mechanism.
- Leave the read-only pin, the filesystem tool configuration, the shell behavior, and the delegated
  child contract exactly as they are.

**Non-Goals:**

- Host support for a directory-scoped sandbox mode. This design works within the current vocabulary.
- Any UI: no drawer section, no editor, no new button. Plans are ordinary Markdown files.
- Plan discovery, listing, or deletion by the planner. Reading uses the host's own tools.
- Any Git behavior: staging, committing, ignoring, or opening a pull request for a plan file.
- Changing the manager, the architect, the operator, or the host default preset.

## Decisions

### D1. The plan tools are product tools behind a preset gate

They live in `src/host/tools/` beside the other product tools and are declared only for the planner
preset. A preset-scoped plugin was rejected: it receives no board, card, or project context, so in a
task conversation the segment would have to be an argument the model retypes every call, and two cards
for one project could land in two directories.

A product tool can resolve the owning card from the session, so the segment is derived once and the
same project always produces the same directory. The cost is the gate: the plugin declares the tools
conditionally instead of relying on composition.

### D2. The existing gate becomes a factory, not a second copy

`workflowArchitectGate` hard-codes one preset id. It becomes a parameterized factory that answers
`is this agent's preset X`, with `workflowArchitectGate` and the new planner gate built from it. The
lookup already fails closed - an unavailable projection withholds the tool - and that behavior is
what the plan tools need too, so duplicating the eight lines would duplicate the one property that
matters.

### D3. Confinement is enforced by refusing links, plus a per-call policy

The adapter does not decide containment with `realpath` and a prefix comparison. It proves
each component is the DIRECT, non-link child of its validated parent: `plans` under the
workspace, the segment under `plans`, and the file under the segment. The check uses the
host `lstat`, which is the only no-follow inspection available: `realpath` cannot tell a
missing entry from a dangling link, and it follows a link before judging where it landed.
Every part is re-validated with the domain rules themselves, because a split of
`plans/../escape.md` has three parts and a part count alone would accept a parent segment.

A link of any kind is refused rather than followed, so a repository that already contains
one cannot redirect a write. Absence is the only case that takes the creation path, and
creation happens after every check that can be made without writing; a concurrent cooperating
creator is tolerated through `EEXIST` and re-checked, and `patch_plan` never creates.

The write then supplies `{ mode: 'workspace-write', workspaceRoot: <segment directory> }` for
that call, so the host fences the mutation a second time. The policy root is the segment, the
narrowest directory holding the file. Escalation fields are absent from both tool schemas, so
there is no `sandbox_permissions` path to request.

The host fence alone would not be enough: under `workspace-write` the host also grants the
platform temp areas, and the bare local backend ignores a per-call policy. The adapter therefore
refuses to write unless the mounted backend reports a sandbox mode, which is the host capability
fact for a confining provider.
### D4. The segment is derived in a task conversation and declared in an ordinary chat

In a task conversation the segment is the slug of the owning card's title. In an ordinary chat the
caller supplies a project name and the same slug rule normalizes it. One rule produces the directory
in both cases, so `Fix login bug` and a caller's `fix login bug` resolve to `fix-login-bug`.

The slug lowercases, replaces every run of characters outside `[a-z0-9]` with a single hyphen, trims
hyphens, and refuses an empty result. It is applied to the project name only; the file name is
validated separately, which keeps a card title from deciding a file name.

This is the one place where a role preset observes a card. The preset requirement forbids a preset from
*naming* a board, card, or stage in its persona or skill; resolving the owning card at call time is not
that, and the segment is a property of the artifact rather than of the role. The design records the
distinction so a later reviewer does not read it as a violation.

### D5. Two tools, two contracts, no mode flag and no delete

`write_plan` replaces the whole file; `patch_plan` requires an existing file and applies all its
replacements or none. A single tool with a mode would need two mutually exclusive argument sets and a
validator that rejects the wrong pairing, for no gain to the caller.

Neither tool deletes. Deleting a plan is a separate intent that no stage asks for, and a delete tool
would be the one operation that can destroy a plan with a typo. A person who wants the file gone removes
it with an ordinary editor, where the action is visible.

`patch_plan` matches `old` literally and requires exactly one occurrence per replacement, in the
shape the host's own `edit` tool already uses. Requiring the file to exist is what makes `patch_plan`
the safe path: it cannot create a file by accident, so a mistyped file name fails instead of writing.

### D6. A missing plan directory is created only after every check that needs no write

The first write into `plans/<segment>/` may be the call that creates it. Because the
confining check needs the entry to exist before it can prove what it is, creation happens as
late as possible: the workspace, `plans`, and the segment are each inspected first, and only an
absent entry is created, one level at a time, with no-recursive `mkdir`. A cooperating call that
created the same directory in the meantime is tolerated through `EEXIST` and the entry is
inspected again, so a winner that wrote a link or a file is still refused.

`patch_plan` never creates anything: it resolves with creation disabled, so an absent plan or
plan directory reports `PLAN_NOT_FOUND` and leaves the workspace untouched.
### D7. Reading reuses the host tools

No read tool ships. The planner already holds `read`, `glob`, and `grep`, and reading is never denied
by the read-only mode. A plugin read tool would only duplicate them, and the confinement value it could
add is already covered because reading the plan is not a write.

### D8. The pin keeps its behavior and loses its misleading name

The read-only pin's contract is unchanged: the planner's session still starts and resumes confined, and
its file tools still mount without write and edit. Only the role's description of itself changes, so
`READ_ONLY_PRESET_IDS` and `createPresetReadOnlyPin` are renamed to state what they do - confine the
start of a role that writes nothing outside its own artifacts - instead of promising a role with no
write at all. Behavior-preserving rename, no logic change, so the existing pin tests keep passing
unchanged in intent.

## Risks / Trade-offs

- **A person can widen the planner session's sandbox mode, and the plan tools still work** → documented
  as a person-owned action, as the pin already is. Widening grants the shell and file tools more than
  they had; it does not extend the plan tools, whose policy is built per call and never read from the
  session.
- **A link inside the repository would redirect a write** → every plan path component is inspected with
  `lstat` and any link is refused before the write, including a dangling one. The host then re-fences the
  resolved target under the segment root, and the mounted backend must report a sandbox mode or the write
  is refused outright.
- **A non-cooperating process can swap a path component between the check and the syscall** → the plugin
  refuses every link with `lstat` before writing and the host re-fences the target, but neither closes a
  concurrent tree replacement by an outside process. Recording that residual here rather than claiming it
  closed: these tools defend against the model, its arguments, and a repository that already contains links,
  not against an attacker racing the filesystem.
- **Two cooperating calls can create the same directory at once** → creation is non-recursive, `EEXIST` is
  tolerated, and the entry is inspected again, so the loser of the race continues only when the winner
  produced the expected directory.
- **`ctx.fs` or `ctx.sandboxPolicy` may be absent in a narrow composition** → both tools report an
  actionable problem naming the missing capability instead of falling back to `node:fs`. The preset
  mounts the host filesystem, so this is a diagnostic, not a supported mode.
- **A card title that slugs to nothing, such as a title of only punctuation** → the tool refuses with an
  actionable problem asking for a project name, rather than inventing a directory. In a task
  conversation the fallback is the project name argument, which the tool accepts when the derived
  segment is empty.
- **A resumed conversation may run in a different directory than where the plan was written** → the
  authority is the directory recorded in the session header at creation, not the current one. A resumed
  session whose mutable directory differs is refused with `PLAN_WORKSPACE_CHANGED` instead of writing
  somewhere new, and the plan stays where it was written.
- **A delegated child inherits the workspace but not the card** → the owning task is resolved through
  durable parent identifiers read from the session headers, so a child writes its card segment and
  cannot target a sibling. A session that HAS a parent and whose owning task cannot be resolved is
  refused with `PLAN_OWNER_UNVERIFIED`; it does not fall back to a declared name. The declared-name
  branch exists only for a conversation with no task ancestor at all, such as an ordinary chat.
- **A plan is not tracked by anything** → by design. The file is written to the checkout and entering
  it in a commit stays the person's decision, so a plan can be lost by a checkout operation. The
  alternative - the plugin staging or ignoring the file - would take a decision that belongs to the
  person.
- **Persona and skill text disagreeing with the new capability** → the persona currently says the role
  cannot write at all. Both are updated in this change, and the composition test asserts the plan tools
  appear in the planner's allowlist, so a later edit that removes them fails a test rather than silently
  reintroducing the old promise.

## Migration Plan

No data migration and no stored state. The tools are additive, and a preset that does not receive them
behaves exactly as before.

Rollback is removing the two names from the planner's allowlist and the gate registration: the tools
then disappear, and the role returns to having no write capability, with the pin and file-tool
configuration never having changed.

An installed bundle picks the change up the same way as any preset edit: build, then update or
reconcile the bundle through the normal install flow. New agents use the updated declaration; running
agents keep their existing composition, which is why the update note belongs in
[`docs/user/presets.md`](../../../docs/user/presets.md) where the existing update rule already lives.