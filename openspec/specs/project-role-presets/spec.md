# project-role-presets Specification

## Purpose

Ship two agent presets for the two project roles: one that investigates and plans a project without
writing to its repositories, and one that orchestrates a project's cards while writing nothing on
them.

## Requirements

### Requirement: Two project-role presets ship with the bundle

The bundle SHALL declare two agent presets, `kanban-project-planner` with the display name
`Kanban Project Planner` and `kanban-project-manager` with the display name `Kanban Project
Manager`, each with a description that states its role. Both SHALL appear in the host preset roster
whenever the bundle is active, in the same way the shipped workflow architect preset does. Each
preset's composition SHALL be its own: neither SHALL mount the Kanban host plugin, so a board that
selects it still reaches the product tools the host already declares. A preset SHALL NOT depend on a
board, a Hub, a project, a repository, a stage name, or any other authored workflow detail, and SHALL
NOT name one in its persona or its skill.

#### Scenario: Both roles are offered by the roster

- **WHEN** the bundle is active and the host lists its agent presets
- **THEN** the roster offers `kanban-project-planner` and `kanban-project-manager` with their names and descriptions

#### Scenario: A role preset composes without remounting the product host

- **WHEN** a new conversation starts on either project-role preset
- **THEN** that agent's composition comes from the preset alone
- **AND** the preset does not declare the Kanban host plugin

#### Scenario: A role preset names no workflow detail

- **WHEN** either preset's persona and skill are read
- **THEN** they name no board, Hub, project, stage, or route of any authored workflow
- **AND** the behavior a project needs is left to the stage instructions of the board that selects the preset

### Requirement: The planner works without writing

The planner preset SHALL expose file reading and file search and SHALL NOT expose a tool that
writes, edits, or deletes a file. It SHALL expose a shell tool, and the sandbox mode of the session
that owns the planner agent SHALL be pinned to `read-only` when that agent starts and again when it
resumes, so a shell command that attempts a file change is denied by the sandbox instead of relying
on the agent's obedience. The planner's delegated children SHALL run under the same boundary: a child
started without an explicit preset SHALL join the parent's preset revision, and that child's session
SHALL be pinned to `read-only` as well. Pinning SHALL be recorded on the session and SHALL NOT
change the installation default. The preset SHALL NOT prevent a person from widening that session's
sandbox mode through the host's own permission control, and the pin SHALL be restored the next time
the agent starts.

#### Scenario: Writing through the file tools is unavailable

- **WHEN** the planner's declared tool set is read
- **THEN** it contains file read and file search tools
- **AND** it contains no tool that writes, edits, or deletes a file

#### Scenario: A shell write is denied

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

### Requirement: The manager surface stays inside the board

The manager preset SHALL expose no file tool, no shell tool, no web tool, and no delegation tool. Its
composable tools SHALL be the product tools its role allows, the structured-question tool, and the
tools its own skill loading needs. It SHALL NOT write a card: the manager SHALL have no tool that
creates, edits, or relates a card, and a planning change of scope or requirements SHALL therefore be
requested from the planner rather than applied by the manager. The manager MAY write a shared task
note, send a message to another task, declare its own task's next transition, and pause or resume its
own task's automatic advance. The manager SHALL NOT be composed with the tools of any MCP server, so
every server stays out of its reach unless a future change composes one deliberately.

#### Scenario: No repository capability

- **WHEN** the manager's declared tool set is read
- **THEN** it contains no file, shell, web, or delegation tool
- **AND** it contains no tool whose name belongs to an MCP server

#### Scenario: Card writes are unavailable

- **WHEN** the manager attempts to change a card's title, description, or relations
- **THEN** no tool for that change exists in its declared tool set

#### Scenario: Notes, messages, routing, and the pause control remain

- **WHEN** the manager's declared tool set is read
- **THEN** it contains the note tools, `send_task_message`, `list_allowed_transitions`, `set_next_transition`, `pause_task`, and `resume_task`

### Requirement: Each role declares the product tools it receives

Each project-role preset SHALL declare, in its own composition, the allowlist of product tool names
its role receives. Every product tool outside that allowlist SHALL be absent from that agent's
declared tool set, in the terms stated by Product tools are declared per role in `product-tools`.
The planner's allowlist SHALL cover board, card, and project reading, card creation and editing,
relations, shared notes, task messages, transitions, pause and resume, team files including deletion,
and the structured-question tool. The manager's allowlist SHALL cover board, card, and project
reading, shared notes, task messages, transitions, pause and resume, and the structured-question
tool. Neither role's allowlist SHALL cover board administration or workflow authoring, and neither
SHALL include the host's native question tool, so a question to the person goes through the
structured-question tool.

#### Scenario: A tool outside the allowlist is absent

- **WHEN** either role's declared tool set is read
- **THEN** every product tool it declares appears in that role's allowlist
- **AND** no product tool outside the allowlist is declared

#### Scenario: The manager cannot create a card

- **WHEN** the manager's allowlist is read
- **THEN** it does not contain the card creation or card editing tool names

#### Scenario: Questions go through the structured-question tool

- **WHEN** either role's allowlist is read
- **THEN** it contains the structured-question tool
- **AND** it does not contain the host's native question tool

### Requirement: Each role ships its own skill

Each project-role preset SHALL mount the bundle's skill directory and SHALL ship one skill of its
own, one per role, each with its own file tree rather than a shared document. A role skill SHALL
describe the role, the tools the role holds and the ones it does not, how it investigates or observes,
when it asks the person instead of assuming, and the conventions for the messages and notes it writes.
A role skill SHALL NOT define a workflow: it SHALL NOT prescribe stages, a handoff sequence, an
approval gate, or a scope-change cycle, because those belong to the stage instructions of the board
that selects the preset. Each persona SHALL stay within the bundle's persona size ceiling, and each
skill file SHALL stay within the bundle's skill size ceiling.

#### Scenario: One independent skill per role

- **WHEN** the two presets' skill trees are read
- **THEN** each preset ships its own skill document
- **AND** neither skill is the other's file

#### Scenario: A role skill leaves the workflow to the board

- **WHEN** either role skill is read
- **THEN** it states the role, its tool boundary, its investigation or observation discipline, when it asks the person, and its writing conventions
- **AND** it does not name a stage, a handoff sequence, an approval gate, or a scope-change cycle
