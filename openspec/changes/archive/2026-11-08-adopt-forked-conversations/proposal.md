# Proposal

## Why

Forking (branching) a task conversation through the native DSH turn-tail action creates a new independent session whose header records the source session and the fork marker, but no subagent origin. The Kanban plugin only follows subagent lineage, so the fork is treated as foreign: the task never shows it as another conversation, and the stray native session later blocks shared-worktree cleanup as an external session. A fork of a task conversation is still a conversation of that task and should appear as one.

## What Changes

- Add host-side fork adoption: when a native DSH agent is created for a session whose header records a direct parent session and no subagent origin, and that parent is a conversation of a task, attach the child session to that same task as a new conversation.
- Adopt on fork creation and on resume of an unattached fork. Adoption is idempotent: an already-associated session, a fork of a subagent descendant, and a fork of a session that no task retains are left unchanged.
- Align the adopted conversation's effective directory with the task's effective directory before attaching, and never attach a conversation that cannot execute in the task directory.
- Retry adoption for a short bounded window while the task has a pending context operation; report the failure and leave the fork foreign afterwards.
- The adopted conversation is an open conversation even when the source conversation is closed. It is appended to the task's conversation order without auto-selecting it, and the native DSH navigation that follows a branch is unchanged.
- **BREAKING** for the conversation-lineage semantics: an adopted fork becomes an owned task conversation for deletion counting and archiving and for shared-worktree protection. A fork that is not adopted remains foreign.
- Update the specs, README, and operations documentation that currently state every fork is foreign.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `task-conversations`: add a requirement for adopting a fork of a task conversation, and revise Native conversation lineage so adopted forks are task conversations while unadopted forks remain foreign.
- `worktree-management`: revise Protect worktrees shared outside the task conversation lineage so an adopted fork belongs to the lineage and only an unadopted fork stays foreign.
- `task-lifecycle`: state that a fork adopted by a task is among the conversations counted by the deletion confirmation and archived by a successful deletion.

## Impact

- Host: a new fork-adoption coordinator with injected ports, plus its registration in the plugin entry and a domain-level fork predicate.
- Native ports: read a conversation's effective directory and set it during adoption; attach the session through the existing task transaction that adds a conversation.
- Client: no new UI. The adopted conversation appears in the existing conversation tab strip when the board snapshot advances.
- Specs and docs: `task-conversations`, `worktree-management`, `task-lifecycle`, `README.md`, `docs/operations.md`, and `docs/scenario-evidence.md`.
- No new dependency and no DSH change.
