# Spec Delta

## MODIFIED Requirements

### Requirement: Scripted stage definition

A workflow SHALL support a scripted stage configured with a language of Bash or TypeScript, exactly one nonempty inline script or external file path, a working-directory choice of task or base project, a mapping of named exits to existing stages, an optional list of authorized environment-variable names, and an optional ordered list of declared parameters. A declared parameter SHALL have a unique safe name and an optional nonempty description, and SHALL NOT carry a value. The default directory SHALL be the task's effective project directory, inside its worktree when one is bound and otherwise the base-project directory. A scripted stage SHALL NOT also configure a nonempty agent entry instruction or a second allowed-transition list. Its exit mapping SHALL be the authoritative set of configured destinations; distinct exits MAY name the same destination, but an exit SHALL NOT target the source stage. A scripted stage that declares parameters SHALL be accepted as the workflow's initial stage and as an exit or transition destination. Reexecution in the current stage SHALL use Play rather than a self-transition. Existing workflows without scripted configuration SHALL retain their behavior. Saving invalid configuration SHALL fail without changing the stored workflow.

A scripted stage SHALL be authored under the `scripted:` key of its workflow stage block. A workflow that authors the legacy `deterministic:` key for a stage SHALL keep loading and SHALL be presented as a scripted stage; a write of that stage SHALL author the `scripted:` spelling, and a stage that authors both spellings at once SHALL be rejected. A stage a write does not name SHALL keep the spelling its author used.

#### Scenario: Configure either supported language and source form

- **WHEN** a user saves a scripted stage with Bash or TypeScript and exactly one inline script or external file path
- **THEN** the workflow stores that configuration under the `scripted:` key and its named exit routes
- **AND** neither saving the configuration nor opening the editor executes the script

#### Scenario: Load a stage authored with the legacy key

- **WHEN** a stored workflow authors a stage's program under the `deterministic:` key
- **THEN** the workflow loads and presents that stage as a scripted stage with the same routes and source
- **AND** the stage is rewritten under the `scripted:` key only when a write names that stage

#### Scenario: Reject both spellings on one stage

- **WHEN** a stored or composed workflow authors the `deterministic:` and `scripted:` keys on the same stage
- **THEN** the workflow is rejected with a diagnostic naming both keys
- **AND** no partial configuration is stored

#### Scenario: Reject conflicting execution and routing definitions

- **WHEN** a scripted stage also supplies an agent entry instruction, an allowed-transition list, both script source forms, or a self-targeting exit
- **THEN** saving fails with a diagnostic identifying the conflicting field
- **AND** the previous workflow remains unchanged

#### Scenario: Validate exit destinations

- **WHEN** an exit points to a stage that does not exist
- **THEN** the workflow is rejected before it can be activated

#### Scenario: Select the base project explicitly

- **WHEN** a task has a worktree but its stage selects the base-project directory
- **THEN** script execution and relative external-script paths use the base-project directory
- **AND** the input context still identifies the task's worktree separately

#### Scenario: Accept a parameterized stage as initial stage or destination

- **WHEN** a workflow marks a stage that declares parameters as its initial stage, or an exit or transition targets that stage
- **THEN** saving succeeds and the workflow keeps that composition
- **AND** no entry is started merely because the composition is stored

### Requirement: Local executable trust

An executable version SHALL require local approval before it runs. Approval SHALL be granted in exactly two ways: by an explicit review action over the reviewed inputs, or automatically when the author saves an inline program through the stage editor, where the author's own save is the review of the bytes it stores. An external file source SHALL always require the explicit review action, because the author writes the reference and not the program bytes. Parameter values, the resolved execution directory, and entry-local data SHALL NOT be part of the approved version. Approval SHALL be recorded for the board and the stable stage identity, independent of project: one approval SHALL authorize every project the board allows and every future card of that stage whose execution resolves to the same executable version. A change to any reviewed input, including the bytes read from an external primary file, SHALL create a new executable version and require exactly one new approval. Editing an entry's parameter values or changing the directory in which a task runs SHALL NOT invalidate an approval. Approval SHALL be local to the installation and SHALL NOT be granted by publishing a board, accepting a shared workflow, writing through a tool, or restoring a stored revision: those writes store the program and leave its execution waiting for review. Repeated entries, repeated executions, and restart recovery of an approved executable version SHALL NOT request approval again. Withholding approval SHALL leave the task in its current stage without executing code. Trust SHALL NOT bypass native filesystem or execution policy and SHALL NOT claim to freeze dependencies outside the captured program. An installation holding approvals recorded before the stage-scoped model SHALL NOT reuse them: after the upgrade each stage SHALL request one approval, and obsolete approval records MAY be discarded.

#### Scenario: Author's own save authorizes an inline program

- **WHEN** the user saves an inline program from the stage editor
- **THEN** the executable version that save stores is approved for the board and the stable stage identity
- **AND** the next card to enter the stage starts without an approval request
- **AND** the approval is presented as recorded by the author's save

#### Scenario: A tool write does not authorize a program

- **WHEN** an agent writes a stage's inline program through a product tool
- **THEN** the executable version that write stores is not approved
- **AND** the next requested execution waits for review

#### Scenario: An external file source always needs a review

- **WHEN** the author saves a stage whose primary source is an external file
- **THEN** the executable version is not approved by that save
- **AND** the next requested execution waits for review of the bytes it resolves

#### Scenario: Receive executable YAML from the team

- **WHEN** a shared update introduces or changes a scripted script
- **THEN** accepting the update does not authorize it locally
- **AND** the next requested execution waits for approval of the captured executable version

#### Scenario: Recover an approved execution

- **WHEN** the host restarts a run with the same executable version and a valid local approval
- **THEN** it does not ask for the same approval again

#### Scenario: Change a primary file between review and launch

- **WHEN** the source file changes after the user reviews its captured contents
- **THEN** the launch uses the reviewed captured bytes or requires another approval
- **AND** it never launches changed bytes under the earlier approval

#### Scenario: Change a declared parameter name requires a new approval

- **WHEN** the saved declaration adds or removes a parameter name after the executable version was approved
- **THEN** the next execution requires a new local review
- **AND** changing only a value for an approved version does not

#### Scenario: Approve once for every project of the board

- **WHEN** the same approved executable version is executed by cards in two projects the board allows
- **THEN** neither project requests approval again
- **AND** each project still resolves its own local variable values

#### Scenario: A different worktree does not request approval again

- **WHEN** a second card enters the same stage with a different execution directory and the same executable version
- **THEN** the card starts without a new approval request

#### Scenario: An approved version is requested only once per change

- **WHEN** the saved program changes while several cards wait in the stage
- **THEN** the stage is unapproved once
- **AND** one approval satisfies every card whose execution resolves to that changed version

#### Scenario: An upgrade does not reuse a project-scoped approval

- **WHEN** the installation holds an approval recorded before the stage-scoped model
- **THEN** the stage requests one approval
- **AND** the old record neither authorizes nor blocks execution

### Requirement: Stage-scoped approval request

A pending executable-version approval SHALL be a board-and-stage fact shared by every entry of that stage that resolves to the same executable version. The host SHALL present one pending approval for that board, stage, and executable version rather than one request per card. The pending approval SHALL be presented on the waiting card, in a board queue, and in the stage editor's Approval tab. Approving SHALL resume every waiting entry of that board, stage, and executable version whose captured execution context is still valid, and SHALL leave the others waiting with their own state. An approval SHALL be rejected with an actionable diagnostic when the stage's executable version changed after the review; the user SHALL review the current version. Accepting a shared update, publishing a board, writing through a tool, or restoring a stated revision SHALL NOT approve an executable version; the author's own save is the single stored-write case that does, and only for an inline program. The host SHALL NOT approve an executable version automatically after a timeout or a restart. The product SHALL NOT present a separate revocation action: changing a reviewed input is what requests a new approval.

#### Scenario: Share one approval with waiting cards

- **WHEN** several cards of the same board and stage wait for the same executable version
- **THEN** the board presents one pending approval for that version
- **AND** approving it resumes every waiting entry whose execution context remains valid

#### Scenario: Approve from a waiting card

- **WHEN** the user activates the approval action on a waiting card and approves the current version
- **THEN** that card's execution starts
- **AND** every other card waiting for the same version also starts

#### Scenario: Approve from the board queue

- **WHEN** the user approves a queued stage version
- **THEN** the queue removes that item once no card remains waiting for it
- **AND** the approval applies to every project the board allows

#### Scenario: Approve before the first card enters

- **WHEN** the stage editor approves the stored executable version before any card enters the stage
- **THEN** the next entry of that stage starts without an approval request
- **AND** no card, conversation, worktree, or execution is created by the approval

#### Scenario: Reject an approval for a replaced version

- **WHEN** the executable version changes while the review is open and the user submits the approval
- **THEN** the approval is rejected
- **AND** the interface asks the user to review the current version
- **AND** no code runs under the earlier review

#### Scenario: Saving or publishing does not approve

- **WHEN** the user saves a workflow document, accepts a shared update, publishes the board, or writes the stage through a tool
- **THEN** the executable version is not approved
- **AND** the next execution still waits for approval

#### Scenario: An author save replaces the pending request

- **WHEN** a stage waits for approval of a version and the author then saves an inline program that changes it
- **THEN** no pending approval remains for the replaced version
- **AND** the approved version is the one that save stored

#### Scenario: A relative source that resolves different bytes per directory

- **WHEN** the primary source is an external file resolved relative to a task or project directory and two directories produce different primary bytes
- **THEN** each resolved result is its own executable version and needs its own approval
- **AND** the stage editor approves only the version it can resolve from the authored configuration and reports the remaining versions as needing approval when they are captured

## ADDED Requirements

### Requirement: Approval origin

Every approval SHALL record where it came from: an explicit review action, or the author's save of an inline program in the stage editor. The recorded origin SHALL be presented wherever the stage reports its approved state, including the editor's Approval tab and the board's approval surfaces. A write that is not the author's editor save SHALL record no approval, so restoring a stored revision or writing through a tool never turns into an author approval. An approval record that carries no origin SHALL be presented as an explicit review rather than as an author save.

#### Scenario: Present where an approval came from

- **WHEN** a stage's executable version is approved and the user reads its approved state
- **THEN** the state names the origin of the approval as either an explicit review or the author's save
- **AND** it names the moment the approval was recorded

#### Scenario: A restored revision records no approval

- **WHEN** the user restores a stored board revision whose scripted stage changed
- **THEN** the restore records no approval and no author-save origin
- **AND** a version whose bytes were never approved returns to review

#### Scenario: Record no approval for a write that is not an author save

- **WHEN** any surface other than the stage editor writes a stage's program
- **THEN** no approval record is created for the resulting executable version
- **AND** the version stays pending review