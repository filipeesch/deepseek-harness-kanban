# Spec Delta

## ADDED Requirements

### Requirement: Recoverable creation attempt state

A worktree creation SHALL record, before invoking Git, the canonical destination and the branch mode it will use, and SHALL record the source commit it resolved. When a creation fails after Git may have written, the host SHALL record the observed destination state as one of: directory absent, directory present and empty, or directory present with content, together with the registration state: registered, orphan, or none. The recorded state SHALL be revalidated before any recovery action is decided, and the record SHALL be updated from that revalidation. An attempt recorded before the source commit was persisted SHALL resolve the source once from its recorded source branch, otherwise the project's configured default branch, otherwise HEAD, in that order.

#### Scenario: Record the attempt before Git runs

- **WHEN** a new-branch creation is about to invoke Git
- **THEN** the attempt records its canonical destination, branch mode, branch name, and resolved source commit before the command runs

#### Scenario: Classify a partial checkout

- **WHEN** a creation fails while the destination directory exists and no registered worktree claims it
- **THEN** the recorded state is directory present with content and registration none

#### Scenario: Classify a vanished destination

- **WHEN** a creation fails while the destination directory no longer exists but a registration for it remains
- **THEN** the recorded state is directory absent and registration orphan

#### Scenario: Resolve a record written before the source commit existed

- **WHEN** a failed creation was recorded without a source commit
- **THEN** recovery resolves it once from the recorded source branch, otherwise the configured default branch, otherwise HEAD
- **AND** the attempt is updated with the resolved commit

### Requirement: Recovery when a failed creation left no effect

A failed creation whose destination directory does not exist and whose registration is absent or orphaned SHALL NOT keep an unverifiable attempt. The host SHALL clear the attempt and SHALL make Retry, Return, and task deletion available as if no attempt had been retained, including for a journal recorded before this rule existed. Clearing an attempt SHALL NOT create, adopt, move, or delete a branch, and SHALL NOT be reported as a successful creation.

#### Scenario: An absent destination frees recovery

- **WHEN** a failed creation has no destination directory and no registration
- **THEN** retrying the creation clears the retained attempt and starts a new attempt
- **AND** returning the conversations to the base project is available

#### Scenario: A vanished destination frees deletion

- **WHEN** the user confirms deleting a task whose failed creation left no directory and no registration
- **THEN** the deletion proceeds under its own confirmations instead of being refused by the retained attempt

#### Scenario: An already stuck journal heals without manual work

- **WHEN** a task carries a failed creation recorded before this behavior existed and its destination no longer exists
- **THEN** the next recovery action clears the attempt instead of failing again
- **AND** no manual directory, branch, or registration change is required

#### Scenario: Clearing an attempt has no Git effect

- **WHEN** an attempt is cleared because it left no effect
- **THEN** no branch is created, adopted, moved, or deleted
- **AND** the outcome is not presented as a successful creation

### Requirement: Discard an incomplete checkout and retry

For a failed creation whose destination is present and is not a registered worktree, the host SHALL offer one recovery action that discards the incomplete checkout and retries the same creation. It SHALL require explicit confirmation before anything is removed, and the confirmation SHALL name the canonical destination, every empty parent directory the discard may remove, and the branch the retry will reuse. The discard SHALL remove the canonical destination only when it is not a registered worktree and is not the base project path, the Git root, or an ancestor of either. It SHALL clear an orphan registration for that exact destination. It SHALL then remove each empty directory above the destination, from the deepest upward, stopping before the configured worktree base path. When no worktree base path is configured, it SHALL remove no parent directory. The retry SHALL run as part of the same accepted action and SHALL be recorded as a new attempt.

#### Scenario: The confirmation describes the consequence

- **WHEN** the user opens the discard action for an incomplete checkout
- **THEN** the confirmation names the destination, the empty parent directories it may remove, and the branch the retry will reuse
- **AND** nothing is removed until the user confirms

#### Scenario: Discard removes the destination and the empty parents

- **WHEN** the user confirms the discard for a destination whose parents became empty
- **THEN** the destination and every empty directory above it are removed, from the deepest upward, stopping before the configured base path

#### Scenario: The configured base is never removed

- **WHEN** removing an empty directory above the destination would target the configured worktree base path
- **THEN** that directory is kept

#### Scenario: No parent cleanup without a configured base

- **WHEN** no worktree base path is configured and the discard removes the destination
- **THEN** no parent directory is removed

#### Scenario: A registered checkout is not discarded

- **WHEN** the destination is a registered worktree
- **THEN** the discard action is not offered for it

#### Scenario: The retry follows the discard

- **WHEN** the discard completes
- **THEN** the same creation is retried without another action from the user
- **AND** its outcome is recorded as a new attempt

### Requirement: Clear an orphan worktree registration

When a worktree creation fails and a registration for its destination remains while the destination directory does not exist, the host SHALL clear that registration by targeting the exact recorded destination. It SHALL NOT remove any other registration and SHALL NOT require user confirmation, because only repository metadata is removed. The host SHALL NOT use a repository-wide prune for this cleanup.

#### Scenario: Only the attempt's registration is cleared

- **WHEN** an orphan registration exists for the attempt's destination
- **THEN** that registration is cleared
- **AND** every other registration in the repository is unchanged

#### Scenario: No repository-wide prune

- **WHEN** the host clears an orphan registration
- **THEN** it does not run a repository-wide prune

#### Scenario: No files are removed

- **WHEN** only an orphan registration remains
- **THEN** clearing it removes no working directory and deletes no branch

### Requirement: Reuse the branch a failed creation left

A retry of a failed creation SHALL reuse the branch the attempt created instead of failing because the branch already exists, when the branch tip equals the source commit the attempt recorded. When the attempt was released because it left no effect, the retry SHALL compare against the source commit it resolves from its recorded source branch, otherwise the configured default branch, otherwise HEAD. The retry SHALL then create the checkout for that branch and the operation status SHALL state that it reuses the branch. When the branch tip differs from the recorded commit, the host SHALL refuse the reuse with a distinct failure naming the branch and the expected commit, and SHALL NOT move, reset, or delete the branch. Reuse SHALL NOT apply to a creation request that supplied an existing branch.

#### Scenario: Reuse requires the recorded tip

- **WHEN** a retry finds the attempt's branch at the recorded source commit
- **THEN** it creates the checkout for that branch and succeeds

#### Scenario: A released attempt still reuses its branch

- **WHEN** a failed creation was released because its destination disappeared, and the branch it created still points at the source the retry resolves
- **THEN** the retry reuses that branch instead of failing because it exists
- **AND** the checkout is created for that branch

#### Scenario: Reuse is visible

- **WHEN** a retry reuses a branch left by the failed attempt
- **THEN** the operation status states that the branch is reused

#### Scenario: A moved branch is refused

- **WHEN** the branch tip no longer equals the recorded source commit
- **THEN** the retry fails with a distinct error naming the branch and the expected commit
- **AND** the branch is not moved, reset, or deleted

#### Scenario: Existing-branch creation is unaffected

- **WHEN** the failed creation supplied an existing branch
- **THEN** retry resolves that branch by its recorded name and the reuse rule does not apply

### Requirement: Creation deadline and explicit cancellation

A Git command that creates or removes a checkout, or that reads the working tree of a checkout, SHALL run under a deadline class separate from the short read deadline. Such a command SHALL NOT be terminated by the short read deadline. While such a command runs, the user SHALL be able to cancel the operation. Cancelling SHALL abort only that command, SHALL record the operation as failed with OPERATION_CANCELLED, and SHALL make the same recovery actions available as any other failure of that operation. Cancelling SHALL NOT delete a branch, reset a registration, or report the operation as completed.

#### Scenario: A long checkout is not killed by the read deadline

- **WHEN** creating a checkout takes longer than the short read deadline
- **THEN** the command continues until it completes or reaches its own deadline

#### Scenario: Cancel aborts only the running command

- **WHEN** the user cancels a running checkout
- **THEN** that command is aborted and no other operation is interrupted

#### Scenario: Cancel records a recovery state

- **WHEN** a cancelled command settles
- **THEN** the operation is recorded as failed with OPERATION_CANCELLED
- **AND** the recovery actions of that operation remain available

#### Scenario: Cancel does not undo Git's work

- **WHEN** a cancel leaves a partial checkout behind
- **THEN** no branch is deleted and no registration is reset
- **AND** the operation is not reported as completed

#### Scenario: Short reads keep the short deadline

- **WHEN** the host runs a Git read that does not touch a checkout's working tree
- **THEN** the short read deadline still applies
