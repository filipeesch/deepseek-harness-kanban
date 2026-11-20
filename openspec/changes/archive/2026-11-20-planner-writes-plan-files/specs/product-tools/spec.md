# Spec Delta

## ADDED Requirements

### Requirement: Plan file tools write only inside the plan directory

The plugin SHALL expose `write_plan` and `patch_plan` as product tools that write a Markdown plan
file under `plans/<segment>/` inside the calling conversation's workspace, and SHALL NOT write it
anywhere else. The plugin SHALL canonicalize the resolved target and SHALL refuse a target that
resolves outside `plans/<segment>/`, including one reached through a symlink, a `..` segment, or an
absolute path supplied in the arguments. Containment SHALL be proven for the SEGMENT directory and
for the FILE itself, not only for the file parent: a symlinked segment and a symlinked plan file
both resolve elsewhere and SHALL be refused. The write SHALL be refused when the mounted filesystem backend does not confine, because a backend that ignores the per-call policy would write without a fence. Both tools SHALL accept only a file name and the plan
content, and SHALL derive the directory themselves; neither SHALL accept an escalation argument, a
sandbox mode, or a directory outside `plans/`. A refused path SHALL return an actionable problem and
SHALL write nothing.

`write_plan` SHALL create the file when it is absent and replace it entirely when it exists.
`patch_plan` SHALL require an existing file, SHALL apply each searched text that occurs exactly once,
SHALL apply all of its replacements together or none, and SHALL refuse an absent file or a searched
text that occurs zero times or more than once. Neither tool SHALL delete a plan, list a directory,
write a file whose name is not `.md`, stage a change in Git, or create a commit.

The tools SHALL be available in a task conversation and in an ordinary DSH chat. In a task
conversation the segment SHALL be derived from the owning card's title, with no argument needed; in an
ordinary DSH chat the segment SHALL come from a name the caller supplies and SHALL be normalized by
the same rule. The same project planned twice SHALL therefore land in the same directory. Writing a
plan SHALL NOT require the conversation to belong to a task, a board identifier, or a Hub.

#### Scenario: Write a plan in a task conversation

- **WHEN** an agent on the planner preset calls `write_plan` with a file name and content from a task conversation
- **THEN** the file is written under `plans/<segment>/` in the conversation's workspace, with the segment derived from the card's title
- **AND** no argument supplied the segment

#### Scenario: Write a plan in an ordinary chat

- **WHEN** an agent on the planner preset calls `write_plan` with a project name, a file name, and content from an ordinary DSH chat
- **THEN** the file is written under `plans/<segment>/` in the conversation's workspace, with the segment normalized from that name
- **AND** no board identifier or task identifier was required

#### Scenario: Escape the plan directory

- **WHEN** a call supplies a file name or segment that resolves outside `plans/<segment>/`, such as `../src/index.ts` or an absolute path
- **THEN** the tool refuses with an actionable problem
- **AND** nothing is written anywhere

#### Scenario: Replace an existing plan

- **WHEN** `write_plan` targets a file that already exists
- **THEN** the file's content is replaced by the supplied content
- **AND** the previous content is not preserved at another path

#### Scenario: Patch an existing plan

- **WHEN** `patch_plan` targets an existing file and every searched text occurs exactly once
- **THEN** all replacements are applied
- **AND** the result is reported with the file's path

#### Scenario: Refuse an ambiguous or absent patch target

- **WHEN** `patch_plan` targets an absent file, or a searched text that occurs zero times or more than once
- **THEN** the tool refuses with an actionable problem
- **AND** the file is left unchanged

#### Scenario: Refuse a non-Markdown plan

- **WHEN** a call names a file whose name does not end in `.md`
- **THEN** the tool refuses with an actionable problem
- **AND** nothing is written

#### Scenario: Leave Git alone

- **WHEN** either plan tool writes a plan file
- **THEN** no change is staged, committed, or pushed
- **AND** whether the file enters a commit stays the person's decision

## MODIFIED Requirements

### Requirement: Product tools are declared per role

The plugin SHALL declare a product tool for an agent only when that agent's preset allows it. A preset
that names a role allowlist SHALL receive exactly the product tools in that allowlist: a product tool
outside it SHALL be absent from the declared tool set and SHALL NOT be dispatchable, rather than
declared and refused at call time. `write_plan` and `patch_plan` SHALL additionally be declared only
for an agent whose preset is the project planner preset, independently of any allowlist: for every
other agent, including an agent on the host default preset, the workflow architect preset, the project
manager preset, or the workflow operator preset, they SHALL be absent from the declared tool set and
SHALL NOT be dispatchable. An agent whose preset is not a project role, including an agent on the host
default preset and the workflow architect, SHALL keep its existing product tool surface apart from the
replacement of `get_board_summary` by `get_workflow_summary`, and the workflow-architect-only
declaration stated in the product tool surface requirement SHALL remain unchanged. The allowlist SHALL
be read from the preset's own composition, so two boards that select different role presets get
different surfaces without a board setting. This restriction SHALL NOT bypass native DSH permission
behavior or any authorization the tool already enforces, and it SHALL NOT change what a product tool
does when it is declared.

#### Scenario: Select the planner's surface

- **WHEN** an agent runs on a preset that allows board reading, card creation and editing, relations, notes, messages, transitions, pause and resume, team files, the plan file tools, and the structured-question tool
- **THEN** those product tools are declared for it
- **AND** the workflow-authoring and board-administration tools are not

#### Scenario: Select the manager's surface

- **WHEN** an agent runs on a preset that allows board reading, notes, messages, transitions, pause and resume, and the structured-question tool
- **THEN** exactly those product tools are declared for it
- **AND** no card creation or card editing tool is declared
- **AND** neither plan file tool is declared

#### Scenario: Absence rather than refusal

- **WHEN** an agent on a role preset is asked about a product tool outside its allowlist
- **THEN** the tool does not appear in its declared tool set
- **AND** a call to it is reported as an unknown tool rather than as a permission refusal

#### Scenario: Withhold the plan tools from every other agent

- **WHEN** an agent whose preset is not the project planner preset receives the plugin's tool declarations
- **THEN** neither `write_plan` nor `patch_plan` is declared
- **AND** a call to either is not dispatched

#### Scenario: Leave other presets alone

- **WHEN** an agent runs on the host default preset or on the workflow architect preset
- **THEN** it keeps its existing product tool surface except for the replacement of `get_board_summary` by `get_workflow_summary`
- **AND** the workflow-architect-only declaration is unchanged