# Spec Delta

## REMOVED Requirements

### Requirement: The planner works without writing

**Reason**: The role no longer works without writing. A plan is a durable artifact that the person
reads later and another agent reviews and corrects, so the planner must be able to produce it as a
file. The capability list that replaces this requirement states the narrower boundary that survives:
the plan file is the only thing the planner may write.

**Migration**: The read-only pin, the filesystem tools mounted without write and edit, and the
denied shell write all remain in force and are restated by `The planner writes only plan files`.
The planner reaches its plan file through `write_plan` and `patch_plan`, which supply a sandbox
policy confined to `plans/<segment>/` for that one call. No other caller and no other path gains
write access, and the preset's own composition changes only by adding those two tool names to its
role allowlist.

## ADDED Requirements

### Requirement: The planner writes only plan files

The planner preset SHALL expose file reading, file search, and a shell tool, and SHALL NOT expose a
tool that writes, edits, or deletes anything in the conversation workspace except a plan file.
Hub team files are a separate AUTHORIZATION SCOPE rather than a location inside the conversation
workspace: the planner keeps its team-file tools, and those writes are governed by the Hub team
storage the person bound, under that storage provider rules. The guarantee this requirement states
is about the conversation workspace, where the plan is the only file the planner may write. Its only write capability SHALL be
the plan tools `write_plan` and `patch_plan`, confined to `plans/<segment>/` inside the calling
conversation's workspace. The sandbox mode of the session that owns the planner agent SHALL remain
pinned to `read-only` when that agent starts and again when it resumes; the filesystem tools SHALL
remain mounted without write and edit, and a shell command that attempts a file change SHALL continue
to be denied by the sandbox. A plan write SHALL reach its confined target through a sandbox policy the
tool supplies for that call, and that policy SHALL NOT be available to any other tool, caller, or
path. The pin SHALL be recorded on the session and SHALL NOT change the installation default. The
planner's delegated children SHALL run under the same boundary: a child started without an explicit
preset SHALL join the parent's preset revision and SHALL be pinned to `read-only` as well, and a
child SHALL therefore hold the plan tools and the same confinement without gaining any other write.
The preset SHALL NOT prevent a person from widening that session's sandbox mode through the host's own
permission control, and the pin SHALL be restored the next time the agent starts.

#### Scenario: Writing outside the plan directory is unavailable

- **WHEN** the planner's declared tool set is read
- **THEN** it contains file read and file search tools and a shell tool
- **AND** the only tools it contains that write the conversation workspace are `write_plan` and `patch_plan`
- **AND** it contains no tool that writes, edits, or deletes any other file there
- **AND** its team-file tools are authorized by the bound Hub storage provider, independent of this workspace

#### Scenario: The planner writes its plan

- **WHEN** the planner writes or patches a plan file inside `plans/<segment>/`
- **THEN** the file is created or updated at that path in the conversation's workspace
- **AND** the session's sandbox mode is still read-only afterwards

#### Scenario: A shell write stays denied

- **WHEN** the planner runs a shell command that creates or changes a file in its working directory
- **THEN** the sandbox denies the file change and reports the denial
- **AND** the session's sandbox mode remains read-only

#### Scenario: A resumed agent is pinned again

- **WHEN** a planner conversation is resumed and its agent starts
- **THEN** the session's sandbox mode is read-only for that start

#### Scenario: A delegated child inherits the boundary

- **WHEN** the planner starts a child without selecting a different preset
- **THEN** the child runs on the planner preset revision
- **AND** the child's session sandbox mode is read-only
- **AND** the child cannot write outside the plan directory

## MODIFIED Requirements

### Requirement: Each role declares the product tools it receives

Each project-role preset SHALL declare, in its own composition, the allowlist of product tool names
its role receives. Every product tool outside that allowlist SHALL be absent from that agent's
declared tool set, in the terms stated by Product tools are declared per role in `product-tools`.
The planner's allowlist SHALL cover board, card, and project reading, card creation and editing,
relations, shared notes, task messages, transitions, pause and resume, team files including deletion,
the plan file tools, and the structured-question tool. The manager's allowlist SHALL cover board,
card, and project reading, shared notes, task messages, transitions, pause and resume, and the
structured-question tool. Neither role's allowlist SHALL cover board administration or workflow
authoring, and neither SHALL include the host's native question tool, so a question to the person
goes through the structured-question tool. The manager's allowlist SHALL NOT carry the plan file
tools.

#### Scenario: A tool outside the allowlist is absent

- **WHEN** either role's declared tool set is read
- **THEN** every product tool it declares appears in that role's allowlist
- **AND** no product tool outside the allowlist is declared

#### Scenario: The manager cannot create a card

- **WHEN** the manager's allowlist is read
- **THEN** it does not contain the card creation or card editing tool names

#### Scenario: The manager cannot write a plan

- **WHEN** the manager's allowlist is read
- **THEN** it does not contain `write_plan` or `patch_plan`

#### Scenario: Questions go through the structured-question tool

- **WHEN** either role's allowlist is read
- **THEN** it contains the structured-question tool
- **AND** it does not contain the host's native question tool