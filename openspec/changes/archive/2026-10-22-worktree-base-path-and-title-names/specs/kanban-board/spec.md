# Spec Delta

## ADDED Requirements

### Requirement: General board configuration with worktree base path
The board configuration experience SHALL include a General section that is presented first and opened by default. The General section SHALL provide an optional worktree base path used as the parent directory for future task worktree destinations. A non-empty worktree base path SHALL be an absolute path; saving SHALL require it to resolve to an existing directory and SHALL retain that canonical directory. Saving an empty worktree base path SHALL remove the configured value. Changing or clearing the worktree base path SHALL NOT move, remove, or rename any existing worktree or branch.

#### Scenario: Save a worktree base path
- **WHEN** the user saves an existing absolute directory as the worktree base path
- **THEN** the canonical directory is retained as the board's worktree base path
- **AND** future task worktree destinations use it as their default parent

#### Scenario: Reject a non-existent worktree base path
- **WHEN** the user saves a worktree base path that does not resolve to an existing directory
- **THEN** the setting is not saved and the user sees an actionable error

#### Scenario: Clear the worktree base path
- **WHEN** the user saves the General section with an empty worktree base path
- **THEN** the board has no configured worktree base path
- **AND** task worktree destinations are not derived from a board base path

#### Scenario: Existing worktrees survive a base path change
- **WHEN** the user changes or clears the worktree base path while tasks have existing worktrees
- **THEN** every existing worktree, branch, and recorded destination remains unchanged
