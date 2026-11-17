# Git and Worktrees

Worktree and Git affordances exist only for Git-backed projects; a folder project uses its project path directly.

## Base project or worktree

A task can work directly in its base project. The notice above chat previews the derived branch, destination, and source and offers **Create worktree** to create immediately with those values, **Review in Git**, or **Continue in base project**. The base-project choice is persisted on the task and hides the notice; it creates no Git resources and leaves every effective directory unchanged.

While a Git-backed task has no worktree and no recorded choice, its first explicit Start or **+** is withheld: creating or attaching a ready worktree, or choosing the base project, unlocks it. The first execution from a move or the play action asks the same question before the move and then creates the worktree in the background; the creation start uses the default worktree without asking. A Git-backed project always has a derivable default destination.

Creating a worktree creates a branch and a checkout. Attaching an existing checkout remains a secondary action in the no-worktree state; attachment reuses the checkout and branch rather than creating them. Unclaimed checkouts appear as a compact warning.

## Derivation and defaults

**Configuration → General** sets an optional worktree base path, and each project's **Worktree** policy decides whether its tasks are asked about a worktree at all. Tasks of a project whose policy is **Always create** start on the derived default, **Never** tasks start in the project directory, and an always-create destination that cannot be derived fails visibly on the card instead of presenting a question.

The Git form derives a new branch name from the task title (lowercase ASCII, hyphenated, at most 48 characters, with `task` as the fallback) and prefills the destination with the base path joined to that branch; without a configured base path it prefills the repository sibling `<repository>-<branch>`. Collisions append `-2`, `-3`, and so on to both values, checking local branches and occupied destinations.

Both fields stay editable: the destination follows the branch until you edit it, and **Use default path** restores the derived destination. Existing-branch mode keeps the chosen branch and does not apply a counter. Changing or clearing the base path never moves or renames existing worktrees, and existing UUID-based branch names are left unchanged.

Worktree creation derives the collision-free branch and destination at the moment it runs when the request does not supply them, so a name that another branch or checkout took after the defaults were displayed advances instead of failing; a branch or destination the user supplied is always authoritative.

**Branch modes:** discovery and Existing branch accept only supported local heads. A remote ref may be entered as the source of a New branch, which creates an attached local branch. Remote-only existing selections fail before checkout creation.

## Effective directory

For a monorepo, the effective agent directory is:

```text
base:     <git-root>/<relative-project-path>
worktree: <worktree-root>/<relative-project-path>
```

The required subdirectory must exist. There is no fallback to the Git root or worktree root. A missing subdirectory is an error, not a reason to run at the checkout root.

## Workspaces

The first task conversation, and every later one, joins a native DSH workspace for its effective project or worktree path instead of being created with cwd only. A worktree created before the first conversation therefore gives that conversation's native session the worktree header.

The base-project workspace is shared by tasks in that project; a worktree workspace belongs to its task and uses the `project · branch` title. A pre-existing workspace is reused and never renamed.

Task worktree and session-directory workspaces are registered hidden by default when the host exposes workspace visibility; the shared base-project workspace stays visible. A pre-existing worktree workspace is hidden once when the plugin adopts it, and an owned worktree workspace is removed when its task is deleted if no session outside the task's conversation lineage uses it. Hiding is best effort and never blocks a conversation. Existing workspaces are not hidden retroactively, and a workspace revealed in the DSH sidebar is never re-hidden by startup reconciliation. On a host without workspace visibility, the plugin uses the original workspace API and every workspace remains visible.

A task's own direct and nested native subagent descendants belong to its lineage, and a fork the task adopted is another retained conversation; a fork no task adopted and unrelated sessions remain foreign.

Existing conversations keep their creation-time workspace when the effective directory changes; relative image references in those conversations can continue to resolve against that creation-time header, which is an accepted limitation. Successful native `workingDirectory` changes preserve session IDs, histories, and immutable header cwd. Native workspace grouping, Files, and the sandbox root remain tied to the original location. The effective cwd is shown in Git details, not as workspace migration or authorization.

Policy preflight plus native confinement can honestly deny out-of-root or read-only operations, including access to monorepo Git metadata. Execution guards revalidate existing canonical context after native recovery and before model use. [Boundaries](../operations/boundaries.md) states those limits.

## Removing a worktree or deleting a task

**Remove worktree** retains the card and its conversations: it returns every retained chat to the base project, then removes only the eligible bound checkout. The card, notes, native chats and histories, and the branch stay.

**Delete task** is the only task lifecycle action; there is no task archiving. A confirmed deletion is admitted from persisted state only (the task exists, its recorded worktree binding still matches the confirmation, and no other operation holds it), recorded, and then executed in the background. It returns every retained chat to the base project, removes the eligible bound worktree, removes the owned worktree workspace registration, archives native chats **without erasing histories**, and finally removes the card and notes; the branch is preserved.

Once every chat has returned to the base project, the checkout removal and the native archiving run concurrently, and the card leaves the board only when both finish. A failure names the step that produced it, and an archiving failure is the one reported when both fail, because archived native chats cannot be restored. The confirmation closes on acceptance, and the card, board notice, and drawer report queueing, progress, and failure.

A plain checkout whose project has no Git root is the exception: its chats are archived in place, the checkout stays on disk, and the result reports the retained path. An already-absent checkout is treated as already removed. Neither cleanup substitutes the base project or Git root for a missing worktree.

Target checks, shared-use protection, and additional dirty or untracked-file discard consent apply. The structured confirmation identifies an externally attached checkout and states that the checkout itself will be removed while its branch is kept.

When a deletion or worktree removal fails the sharing preflight with `SHARED_WORKTREE`, the failure surfaces offer a consented **Force remove checkout** action: it lists every affected task and native conversation, requires an explicit opt-in, and removes the shared checkout, marking other bound tasks with a persisted worktree error without rewriting their effective directory. Force bypasses only the sharing guard; host policy, discard consent, idleness, and the refusal to force while another task operates on the same checkout still apply.

A task's own retained conversations, a fork the task adopted, and their direct and nested native subagent descendants form its conversation lineage; a fork no task adopted and unrelated sessions remain foreign. Those descendants are deliberately neither archived nor moved: the pinned native host refuses to relocate a session owned by subagent routing, so a descendant whose directory is removed keeps that recorded directory and reports the missing directory when resumed instead of silently switching. Relocating such a conversation needs native host support.

A bulk selection uses one confirmation that closes on accept and leaves selection mode immediately, so the board is never held while the deletions are admitted. Every selected task is dispatched as an individual background deletion, tasks accepted by the host leave the selection, and a task whose persisted state cannot be admitted is reported as a board error. There is no bulk result dialog: later failures appear in each card's status and in the destructive-operation notice, where a busy conversation defers the deletion and local changes still require their own discard consent.

## When a project stops being Git-backed

Clearing a project's Git root makes it a folder project; the change is rejected while a task of the project has an unresolved context operation or a pending worktree request.

A checkout that loses its Git association becomes a plain checkout: its conversations keep running there, every Git action is withheld, and the checkout is never deleted by the plugin. Deleting such a task archives its conversations, removes its card and notes, leaves the checkout on disk, and reports the retained path.

Failed creation, an incomplete checkout, and an unclaimed checkout each have a recovery path in [Recovery](../operations/recovery.md).
