# Spec Delta

## ADDED Requirements

### Requirement: Project worktree policy

Each registered project SHALL carry a worktree policy that answers the worktree decision its tasks face before their first execution. The policy SHALL be one of `Ask`, `Always create`, or `Never`, and SHALL be `Ask` for a project saved without one and for every project stored before this policy existed. `Ask` SHALL keep that decision per task, `Always create` SHALL start a task's first execution on its derived default worktree without asking, and `Never` SHALL start it in the base project directory without asking and without creating a worktree.

The policy SHALL be local to this installation: it SHALL NOT be part of a published board, SHALL NOT be received from a team layout, and SHALL NOT change the behavior of another installation that references the same project key. The policy SHALL be editable in the project editor. It SHALL be kept when the project is renamed, given a new key, or relocated, and a save that does not send a policy SHALL leave the stored policy unchanged. A save SHALL reject a policy value other than the three states. A folder project SHALL keep its stored policy and SHALL NOT apply it, because its tasks have no worktree decision.

#### Scenario: Default a project to Ask

- **WHEN** a project is saved without a worktree policy
- **THEN** it is stored with the Ask policy
- **AND** its tasks keep the per-task worktree decision

#### Scenario: Choose a policy in the project editor

- **WHEN** the user chooses Always create in the project editor and saves
- **THEN** the project is stored with that policy
- **AND** a later first execution of one of its tasks creates the default worktree without asking

#### Scenario: Keep the policy when the project changes identity or location

- **WHEN** the user renames, re-keys, or relocates a project whose worktree policy is Never
- **THEN** the stored policy remains Never
- **AND** no task of the project gains a per-task worktree choice from the change

#### Scenario: Reject an unknown policy value

- **WHEN** a save sends a worktree policy that is not one of the three defined states
- **THEN** the save is rejected with an actionable problem
- **AND** the stored project is unchanged

#### Scenario: Keep the policy out of the published layout

- **WHEN** a board of the Hub is published
- **THEN** the project's worktree policy is not part of the published content
- **AND** another installation that references the same project key keeps its own policy

#### Scenario: A folder project keeps an inapplicable policy

- **WHEN** a project with a stored worktree policy is stored as a folder project
- **THEN** the policy remains stored
- **AND** its tasks are never asked about a worktree and never create one
