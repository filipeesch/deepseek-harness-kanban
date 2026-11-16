# Spec Delta

## ADDED Requirements

### Requirement: Board MCP tool allowlist

Each board's workflow SHALL accept an optional root `mcp` list that names the MCP servers and MCP
tools the board's conversations may use. Each entry SHALL be nonempty text of either one segment,
which names a server and allows every tool that server offers, or two segments separated by `/`,
which names one `server/tool` entry and allows only that tool. A list entry that is empty, blank, or
carries more than two segments SHALL be rejected as an invalid workflow, and the last valid workflow
SHALL remain in effect. A workflow that carries no `mcp` field SHALL keep the current behavior and
leave every configured MCP server visible to that board's conversations. An empty list SHALL hide
every MCP server from them, and that SHALL be a different authored state from an absent field. The
board's stored parsed workflow and its authored YAML SHALL agree on the field. The field SHALL be part
of the workflow's meaning and SHALL NOT be part of its layout, and it SHALL be stored in the board's
workflow and SHALL NOT be stored in a board setting outside it.

Every agent of a task conversation on that board SHALL have the MCP tools it inherits masked to that
allowlist: a masked tool SHALL be absent from that agent's declared tool set and SHALL NOT be
dispatchable. The mask SHALL apply to an agent created for that conversation later by resume or fork,
and SHALL be refreshed when the tool catalog changes, so a server that connects after the agent
started is masked to the same allowlist and a server that is disconnected when the agent starts does
not fail the conversation. The mask SHALL NOT change the tool surface of an ordinary DSH chat, which
belongs to no board, and SHALL NOT change another board's conversations. Editing the field SHALL
affect the next agent start of that board's conversations, not an agent already running.

#### Scenario: Accept a server entry

- **WHEN** a workflow configures `mcp` with the entry `atlassian`
- **THEN** the configuration is accepted
- **AND** the board's conversations may use every tool that server offers

#### Scenario: Accept a single-tool entry

- **WHEN** a workflow configures `mcp` with the entry `atlassian/search`
- **THEN** the configuration is accepted
- **AND** those conversations may use that tool and no other tool of that server

#### Scenario: Keep every server when the field is absent

- **WHEN** a workflow configures no `mcp` field
- **THEN** the configuration is accepted
- **AND** every configured MCP server stays visible to that board's conversations

#### Scenario: Hide every server with an empty list

- **WHEN** a workflow configures `mcp` as an empty list
- **THEN** the configuration is accepted
- **AND** no MCP tool is declared for that board's conversation agents

#### Scenario: Reject a malformed entry

- **WHEN** a workflow configures an `mcp` entry that is blank or names more than one tool segment
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count an allowlist change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in its `mcp` list
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

#### Scenario: Mask a conversation agent

- **WHEN** an agent starts for a task conversation whose board allows only the `atlassian` server
- **THEN** that agent's declared tool set contains no tool of any other MCP server

#### Scenario: Mask an agent created later

- **WHEN** a task conversation on that board is resumed or forked and a new agent starts
- **THEN** that agent's declared tool set is masked to the same allowlist

#### Scenario: Follow the tool catalog

- **WHEN** an MCP server connects after the conversation agent started
- **THEN** its tools are masked to the board's allowlist on the next catalog change
- **AND** the conversation is not failed because the server was disconnected when the agent started

#### Scenario: Leave an ordinary chat unchanged

- **WHEN** an ordinary DSH chat that belongs to no board runs
- **THEN** the board's allowlist does not change that chat's declared tool set

### Requirement: Board MCP tool allowlist configuration

The Defaults sub-section of the board configuration SHALL present the board's MCP allowlist together
with the board's default model and default agent preset, following the patterns those controls already
establish. The control SHALL distinguish keeping every server, which removes the root `mcp` field from
the board's authored workflow YAML, from an explicit selection, which authors the list and MAY be
empty to allow none. The control SHALL offer the servers the host currently reports, and SHALL allow
authoring an entry the list does not offer, including a `server/tool` entry, so a disconnected server
or a single tool can still be selected. It SHALL present every stored entry the host does not report
as a kept entry with its unavailable state. The choice SHALL be saved in the single guarded workflow
write defined by Board default model configuration, preserving the text and comments outside the
rewritten root fields, and a document that is invalid at save time SHALL NOT replace the stored
workflow. When the host reports no MCP server service, the control SHALL still present the stored
entries and SHALL allow keeping or clearing them.

#### Scenario: Present the live servers

- **WHEN** the user opens the Defaults sub-section and the host reports configured MCP servers
- **THEN** the control presents those servers as selectable entries

#### Scenario: Save a selection

- **WHEN** the user selects the `atlassian` server and saves
- **THEN** the board's authored workflow YAML carries `mcp` with that entry
- **AND** the text and comments outside that field are unchanged

#### Scenario: Keep every server

- **WHEN** the user chooses to keep every server and saves
- **THEN** the board's authored workflow YAML carries no root `mcp` field
- **AND** the board's conversations keep every MCP server visible

#### Scenario: Allow no server

- **WHEN** the user chooses an explicit selection with nothing selected and saves
- **THEN** the board's authored workflow YAML carries an empty `mcp` list

#### Scenario: Keep a stored server the host does not report

- **WHEN** the stored allowlist names a server the host does not report
- **THEN** the control presents that entry and states that it is unavailable
- **AND** the stored entry is neither removed nor rewritten without the user's change

#### Scenario: Save with the other board defaults

- **WHEN** the user saves a model, preset, and allowlist change together
- **THEN** all three are written in one guarded workflow write
- **AND** a document that is invalid at save time does not replace the stored workflow
