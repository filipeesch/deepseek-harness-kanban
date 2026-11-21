# Stage Orientation

## Purpose

Tell every agent which stage a task is in, what that stage is responsible for, and where the task may go next, using neutral facts derived from the live workflow.

## Requirements

### Requirement: Stage orientation is derived from the live workflow

The plugin SHALL derive, from the workflow that is active at the moment of use, a neutral orientation of a stage: its identifier and name; its kind, which is one of decision, scripted, agent-instruction, or no-instruction; its responsibility, which is the stage's authored description and is absent when none is authored; its routing policy, which is one of unrestricted, empty, configured, scripted, or decision; and its exits. An exit SHALL carry its destination's identifier, name, kind, and responsibility when authored. A configured exit SHALL carry its authored condition when one exists, a scripted exit SHALL carry its exit name, and a decision option SHALL carry its identifier and title and SHALL NOT answer the decision. A stage that authors no transition restriction SHALL list every other stage as an exit. Exits say where a task may move; they do not widen what a transition declaration may name. The orientation SHALL contain no entry instruction, script code, authored YAML, parameter value, or decision option description, and conditions SHALL remain documentary rather than executable. Every surface that reports a stage's kind or routing policy SHALL report the same classification, so two surfaces never disagree about what a stage is.

#### Scenario: Orient a stage with configured transitions

- **WHEN** a stage configures two transitions and only one authors a condition
- **THEN** its orientation lists both exits with destination identifiers, names, kinds, and responsibilities when authored
- **AND** only the exit that authors a condition carries one

#### Scenario: Orient an unrestricted stage

- **WHEN** a stage authors no transition restriction
- **THEN** its orientation reports an unrestricted routing policy
- **AND** it lists every other stage of the workflow as an exit
- **AND** transition discovery reports the same policy with no target a declaration may name

#### Scenario: Orient a scripted stage

- **WHEN** a stage is scripted
- **THEN** its orientation reports the scripted kind with each named exit and its destination
- **AND** it carries no script code

#### Scenario: Orient a decision stage

- **WHEN** a stage authors a decision
- **THEN** its orientation reports the decision kind with each option's identifier, title, and destination
- **AND** it neither answers the decision nor carries option descriptions

#### Scenario: Leave an absent responsibility absent

- **WHEN** a stage has no authored description
- **THEN** its orientation reports no responsibility
- **AND** no text is invented for it

#### Scenario: Agree across surfaces

- **WHEN** the same stage is reported by the workflow summary, the transition discovery tool, and an orientation block
- **THEN** all three report the same kind and routing policy

### Requirement: Every stage instruction delivery opens with an orientation block

When the host delivers a stage's entry instruction to a conversation, the delivered message SHALL begin with an orientation block placed before the entry instruction. The block SHALL state the stage's name and identifier, its kind, and its responsibility, or state that none is authored, and SHALL list the stage's exits with their conditions as defined by the orientation. It SHALL include each exit destination's responsibility while the block stays within 4 KiB. When it would exceed that size, the block SHALL keep every exit's name, identifier, and condition, SHALL omit the destinations' responsibilities, and SHALL say that they were omitted and where to read them. The 4 KiB budget governs the destinations' responsibilities only: the current stage's responsibility and every condition SHALL appear in full, whatever their size. The block SHALL contain facts only and SHALL NOT direct the agent to perform, refrain from, or route any work. It SHALL be derived from the workflow that is active at the moment of delivery, composed again synchronously right after the delivery's final authority check, SHALL have the same form for every preset, and SHALL appear on every delivery path: the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, and the first execution of a task created by an agent.

#### Scenario: Place the block before the instruction

- **WHEN** the host delivers the entry instruction of any stage
- **THEN** the delivered message begins with the orientation block
- **AND** the entry instruction follows it

#### Scenario: Orient a stage without exits

- **WHEN** the host delivers the entry instruction of a stage that has no exits
- **THEN** the orientation block states that the stage has no exits

#### Scenario: Report an absent responsibility

- **WHEN** the delivered stage has no authored description
- **THEN** the orientation block states that no responsibility is authored

#### Scenario: Bound the destinations' responsibilities

- **WHEN** the exit destinations' responsibilities would push the block beyond 4 KiB
- **THEN** every exit keeps its name, identifier, and condition
- **AND** the destinations' responsibilities are omitted with a statement that says so and where to read them
- **AND** the current stage's responsibility and every condition remain in full

#### Scenario: Describe, never command

- **WHEN** an orientation block is delivered to any preset
- **THEN** it states facts about the stage and its exits
- **AND** it contains no directive to perform, refrain from, or route work

#### Scenario: Derive the block at send time

- **WHEN** the workflow changes between the admission of an instruction and its delivery
- **THEN** the block reflects the workflow at the moment of delivery

#### Scenario: Compose again after the final authority check

- **WHEN** an edit that keeps the stage entry changes the stage's responsibility or exits after the delivery's awaited reads and before its final authority check
- **THEN** the delivered block and briefing reflect the edit

#### Scenario: Keep the current stage's text whole over budget

- **WHEN** the current stage's own responsibility alone exceeds 4 KiB
- **THEN** it appears in full and only the destinations' responsibilities are omitted, with a statement that says so

#### Scenario: Include the block on every send path

- **WHEN** a stage instruction is delivered by the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent
- **THEN** the delivered message begins with the orientation block

### Requirement: A stage change without a delivered instruction is announced once

When a task's current stage entry differs from the entry that a task conversation was last told about, and the host delivers no stage instruction for the current entry, the plugin SHALL inject one stage notice, an announcement, before the next input the conversation receives, so the conversation never keeps acting on an earlier stage without being told. An announcement SHALL carry the orientation block of the current stage and one status line that says why no instruction accompanied the change: the stage has no entry instruction, the stage is a decision gate that waits for a person, the stage is scripted, or the entry instruction has not been delivered yet. It SHALL NOT contain the entry instruction text. A stage notice SHALL be a plugin-sourced native message that identifies the stage entry it concerns, SHALL NOT be recorded or presented as user input, SHALL NOT count as pending user work, SHALL NOT derive a conversation title, and SHALL NOT start a turn by itself. A conversation SHALL receive at most one announcement per stage entry. The entries a conversation has been told about, in any order, are those named by the messages its durable history appended as the first-turn context, a stage instruction, or a stage notice; an inbox insertion that a cancel kept from ever being appended does not count, because the conversation never saw it. What a step carries tells the conversation about an entry only once the history records it, so an announcement the history never records, because the step was aborted first, SHALL be made again. Every step that carries a message naming an entry SHALL be confirmed against the history before the next decision, whichever entry the message names, and a message that names an older entry than the current one, because the task moved after the message was composed, SHALL NOT make the conversation count as told about the current entry. An announcement SHALL describe the entry the task holds when it is built, not the entry it held before a read or a move. A conversation whose history records no entry identity SHALL receive no notice, so earlier conversations are not backfilled. An announcement SHALL NOT be injected when the last stage message of the input being delivered is the stage instruction or notice of the current entry. Each conversation of a task SHALL be told independently. A stage notice SHALL be presented as one collapsed context row in the transcript, wherever the task conversation is rendered, with an inline fallback that preserves its text.

When the last stage message of an input names an earlier entry than the current one, the plugin SHALL also add a correction after it, even when the conversation was already told about the current entry or the same input carries that entry's instruction earlier, so the last stage statement the conversation reads is always the current one. A correction is a stage notice that names the current stage, carries its orientation block, states that the stage message just before it names an earlier entry and is out of date, carries no status line, and does not count against the limit on announcements. When the conversation had not been told about the current entry, the notice SHALL be an announcement that also carries that sentence. The plugin SHALL NOT drop or edit any message the host queued.

#### Scenario: Announce a manual move

- **WHEN** the user moves a task card to another stage and then sends a message in an existing conversation of that task
- **THEN** the conversation receives a stage notice naming the new stage before that message
- **AND** the user's message contains only the text the user sent

#### Scenario: Announce a stage without an entry instruction

- **WHEN** a task enters a stage that has no entry instruction and the conversation receives its next input
- **THEN** the stage notice carries the orientation block and states that the stage has no entry instruction

#### Scenario: Announce a decision gate or a scripted stage

- **WHEN** a task enters a decision stage or a scripted stage and the conversation receives its next input
- **THEN** the stage notice states that the stage waits for a person or runs a program
- **AND** it does not state or imply that the agent routes out of it

#### Scenario: Announce an instruction that was not delivered yet

- **WHEN** a task is moved into a stage with an entry instruction that has not been run and the conversation receives its next input
- **THEN** the stage notice states that the entry instruction has not been delivered
- **AND** it contains no text of the instruction

#### Scenario: Announce once per entry

- **WHEN** a conversation receives several inputs during the same stage entry after its notice
- **THEN** no further notice is injected for that entry
- **AND** a later entry into the same stage is announced as a new entry

#### Scenario: Skip the notice when the instruction is the input

- **WHEN** the input that reaches the conversation is the stage instruction of the current entry, possibly beside an older one
- **THEN** no stage notice is injected

#### Scenario: Announce again after a step that never reached the log

- **WHEN** a step carried the current entry's instruction or notice and was aborted before its messages were appended
- **THEN** the conversation's next input is preceded by a stage notice for that entry

#### Scenario: Announce again after a canceled delivery

- **WHEN** the stage instruction for the current entry was admitted to the inbox and a cancel kept it from ever being appended to the conversation
- **THEN** the conversation's next input is preceded by a stage notice for that entry

#### Scenario: Announce the current entry beside an older message

- **WHEN** a step carries a first-contact context or instruction that names an older entry because the task moved after it was composed
- **THEN** a stage notice for the current entry follows it
- **AND** the step is confirmed against the history before the next decision

#### Scenario: Order the notice after an older instruction

- **WHEN** a queued stage instruction for an earlier entry reaches a conversation whose task now holds a later entry, with or without the person's input
- **THEN** the instruction stays in the input, the notice for the current entry follows it, and the notice states that the stage message just before it names an earlier entry and is out of date
- **AND** the person's input keeps its text and position among the messages that are not stage messages

#### Scenario: Correct an older instruction after the entry was announced

- **WHEN** an older stage instruction is the last stage message of an input and the conversation was already told about the current entry, or the same input carries that entry's instruction before it
- **THEN** a correction follows the older instruction, names the current stage, states that the older stage message just before it is out of date, and carries no status line

#### Scenario: Describe the entry held after a move

- **WHEN** the task changes entry while the host reads the conversation's history
- **THEN** the notice describes the entry the task holds after the read

#### Scenario: Do not backfill an earlier conversation

- **WHEN** a conversation's durable history records no stage entry identity
- **THEN** it receives no stage notice

#### Scenario: Tell each conversation independently

- **WHEN** a task with two conversations changes stage
- **THEN** each conversation receives its own notice before its own next input

#### Scenario: Keep the notice out of user input

- **WHEN** a stage notice is injected
- **THEN** no user message records it and it does not count as pending user work
- **AND** no conversation title is derived from it and no turn starts because of it

### Requirement: The first-contact workflow map is complete within its own budget

The workflow snapshot in a conversation's first-turn context SHALL be a compact workflow map rather than paged records. The map SHALL give the workflow's name and description when authored, the board and Hub, the initial stage, the board's project scope and sharing status, and the task's automatic-mode enabled, paused, and held state when known. It SHALL contain one entry per stage in workflow order, carrying its identifier, name, kind, routing policy, responsibility when authored, and its exits with their conditions, named script exits, or decision options as defined by the orientation, and it SHALL mark the task's current stage. The map SHALL have its own budget of 16 KiB in UTF-8, separate from the task-attachment listing's budget, and SHALL be labeled as a first-contact snapshot that is not live. When the complete map exceeds its budget, it SHALL keep the workflow header and the current stage first, then the stages the current stage's exits lead to, then the remaining stages in workflow order. A stage that does not fit SHALL be omitted whole rather than truncated, and the map SHALL state the exact number of stages omitted, name the leading omitted stages by identifier and name for as long as each label fits whole in a fixed 1 KiB name allowance, further limited to the room the kept stages leave, and at most 40 are named, give the count of the rest, and name the workflow summary tool as the way to read them. The map SHALL reserve the most that closing line can take before it keeps an optional stage. The header, the current stage, and the shortest closing line (the exact count and the pointer to the summary tool) are always written whole, so only they can take the map past its budget; the map stays within its budget whenever they fit. An individual description or condition SHALL NOT be truncated. The map SHALL contain no entry instruction, script code, or authored YAML.

#### Scenario: Carry a large workflow whole

- **WHEN** a workflow has 22 stages whose descriptions are up to 300 characters
- **THEN** the map lists all 22 stages with their exits within 16 KiB

#### Scenario: Mark the task's stage

- **WHEN** the map is rendered for a task
- **THEN** the stage that holds the task is marked as current

#### Scenario: Omit a stage whole when over budget

- **WHEN** the complete map exceeds 16 KiB
- **THEN** every stage that does not fit is omitted whole and no description or condition is truncated
- **AND** the map states the number of omitted stages, lists as many leading omitted stages by identifier and name as fit its name allowance, and names the workflow summary tool

#### Scenario: Preserve the current stage when over budget

- **WHEN** the complete map exceeds 16 KiB
- **THEN** the workflow header and the current stage are kept, and the stages the current stage's exits lead to are considered before any other optional stage and kept only if they fit

#### Scenario: Keep mandatory content whole

- **WHEN** the header and the current stage alone exceed 16 KiB
- **THEN** both appear in full and every other stage is omitted whole
- **AND** the closing line states the exact count and the summary tool without naming stages

#### Scenario: Bound the names of omitted stages

- **WHEN** more than 40 stages are omitted, or their labels do not all fit the 1 KiB name allowance
- **THEN** the closing line names only the leading omitted stages whose labels fit whole, at most 40, and states how many more were omitted
- **AND** the map stays within 16 KiB when the header, the current stage, and the shortest closing line fit, including for long or multibyte names, and the names it lists shrink to what the kept stages leave

#### Scenario: Keep the budgets separate

- **WHEN** a task carries a long attachment listing
- **THEN** the listing does not reduce the space available to the workflow map
