# Spec Delta

## MODIFIED Requirements

### Requirement: Shared worktree creation defaults
The notice and the Git section SHALL present the same derived branch, destination, and source defaults for the same task. A source branch MAY be omitted, in which case the host SHALL use the project's configured default branch or HEAD. A draft edited in the Git section SHALL remain authoritative when the notice creates from it, and SHALL NOT be silently renamed. A new-branch creation request MAY also omit the branch and the destination; the host SHALL then derive the collision-free title defaults at the moment creation runs, using the same derivation, collision avoidance, and destination rules as the Git section, and SHALL create the checkout with the values it derived. A branch or destination supplied by the request SHALL remain authoritative and SHALL NOT be replaced by a derived value.

#### Scenario: Consistent defaults across surfaces
- **WHEN** the notice has loaded its derived defaults and the user opens the Git section without editing them
- **THEN** the Git section shows the same branch, destination, and source

#### Scenario: Empty source branch
- **WHEN** the project has no configured default branch and creation is requested without a source branch
- **THEN** the host uses HEAD as the source

#### Scenario: Manual draft remains authoritative
- **WHEN** the user edits the branch or destination in the Git section and then creates from the notice
- **THEN** the edited values are used rather than silently restored to the title-derived defaults

#### Scenario: Creation derives the defaults it uses
- **WHEN** a new-branch creation request omits both the branch and the destination
- **THEN** the host derives the collision-free title defaults at creation time
- **AND** the created checkout uses exactly that branch and destination
- **AND** the task's conversations follow the normal worktree creation flow

#### Scenario: A name occupied before creation runs
- **WHEN** a new-branch creation request omits the branch and the derived name became occupied after the defaults were last displayed
- **THEN** the host advances the derived branch and destination together under the collision rule before creating
- **AND** the creation does not fail because of the newly occupied name

#### Scenario: Supplied values are never replaced
- **WHEN** a creation request supplies a branch and a destination that differ from the derived defaults
- **THEN** the host creates the checkout with the supplied values
- **AND** a collision on a supplied value is reported as a Git failure instead of being silently renamed
