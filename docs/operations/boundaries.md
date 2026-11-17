# Boundaries

This document states how a project, its Git repository, the agent's working directory, native workspaces, and native policy relate. It exists because those paths are distinct and because the plugin cannot grant access that native policy denies.

## Four paths stay distinct

For a Git-backed project, keep four paths distinct: the **base project path**, the **Git root**, the **worktree root**, and the **effective agent cwd**. The effective cwd is exposed only in the Git section's secondary details; the drawer header and Info do not repeat it. A folder project has no Git section and runs at its project path or a retained checkout.

The effective directory must contain the project's own subdirectory; [Git and worktrees](../user/git-worktrees.md) states the derivation and the "no fallback to the Git root" rule.

The committed **effective cwd**, not the mere presence of a retained ready worktree binding, selects the active context: after an explicit return, chats and new tabs use the base even if the old checkout remains bound.

## Workspaces

A conversation joins the native workspace of its effective project or worktree path; the registration is bookkeeping, not an access grant. The shared base-project workspace stays visible, a task worktree workspace belongs to its task, and worktree and session-directory workspaces are registered hidden by default with best-effort hiding that never blocks a conversation.

[Git and worktrees](../user/git-worktrees.md) owns the workspace model, adoption, and removal rules; [Conversations](../user/conversations.md) owns branch adoption.

## Native policy and confinement

[The native adapter](<../../src/host/native.ts>) resolves actual participant policies. Write preflight checks canonical paths against those policies; required Git commands use native confinement unless every participant already has an applicable full-access policy. It does not manufacture a union root, call idle GUI approval as a persistent grant, or auto-escalate to full access. Missing or incomplete confinement and incompatible participant policies fail visibly. Preflight is diagnostic, not a replacement for actual confinement or a race-free authorization guarantee.

Expected denials include read-only creation or removal and writes outside an original workspace root. Monorepo Git metadata can itself lie outside a subproject's permitted root even when its effective cwd exists. A prior successful Git create does not promise subsequent conversation access or future write permission.

[Task execution guards](<../../src/index.ts>) validate the existing canonical expected and observed directories before send, at native pre-step, and at the public model boundary after request configuration and before the request is sent. A changed or missing directory refuses the send. A deny is not a reason to widen the profile, disable a check, or edit the host.

Native workspace grouping, Files, and the sandbox root remain tied to the original location when the effective cwd changes; a displayed cwd or an attached checkout is not an access grant. Relative image references in an existing conversation can continue to resolve against its creation-time workspace header, which is an accepted limitation.

## Coordination and idle state

The all-idle coordinator waits for **every** associated conversation, including closed tabs and known native jobs, descendants, schedules, and pending interactions. Partial switches are journaled, not represented as an atomic all-session transaction. An explicit return can retain a checkout binding while the active effective cwd is the base project; the retained checkout is not automatically active again.

**Unclaimed worktrees** are diagnostic-only paths left on disk, never active or destructive targets; task deletion leaves them untouched.

Relocating a session owned by subagent routing needs native host support. Such a descendant whose directory is removed keeps that recorded directory and reports the missing directory when resumed instead of silently switching.

## Drawer right Sidebar panel

The drawer presents the host's panel only when the host reports the capability and exposes a per-Session panel; the plugin adds no panel state of its own and claims no navigation the host does not prove. Navigation classification reads the host's `retainedBy.mainView` reference and fails closed, so a changed host leaves the host's native navigation in place. [Conversations](../user/conversations.md) owns the open, close, width, docking, and limit behavior.

## One writer per profile

The supported boundary is one active host and profile writer. Mutations are serialized and revision checked, but there is no multi-host replication guarantee. Backups and schema recovery belong to [Recovery](recovery.md).
