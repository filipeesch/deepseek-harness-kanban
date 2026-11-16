# Spec Delta

## ADDED Requirements

### Requirement: Program output contract

The host SHALL read a TypeScript program's captured output from the ordered text and image entries the current program runtime publishes, and SHALL also accept the earlier per-call text list that a supported host of the previous vintage publishes, so a program that returns settles as completed on either host. When a host publishes both, the ordered entries SHALL be preferred. Adjacent ordered text entries SHALL be concatenated in emission order without inserting a separator, because each entry already retains its emitted line breaks; the earlier per-call list SHALL keep one line per entry, its own historical shape. An inspected image SHALL be represented as one bounded textual marker that counts the omitted images, so an inspection is never silently discarded.

The captured output SHALL remain bounded and redacted before it is persisted, displayed, delivered, or returned to a caller, and exceeding its bound SHALL remain a contract failure. A host that publishes neither contract, or whose published entries cannot be read, SHALL be refused as a `configuration` failure whose diagnosis names the shape and the entry types the host returned, and that refusal SHALL NOT be reported or classified as an executor or provider defect. Any failure raised while reading the result SHALL settle as that same named refusal rather than as an unclassified execution failure.

A host that publishes only the earlier per-call list SHALL be reported once, stating that the contract in use is the earlier one and that its support ends when the declared host floor rises. The same captured output SHALL be reported for an isolated test execution as for a real execution.

#### Scenario: Read the text a program emitted

- **WHEN** a program emits text and returns a mapped exit on a host that publishes ordered entries
- **THEN** the execution settles as completed with that exit and message
- **AND** its diagnostics carry the emitted text with the emitted line breaks and no separator inserted between adjacent entries

#### Scenario: Read a program on a host that publishes only the earlier list

- **WHEN** a program returns on a host that publishes the earlier per-call text list and no ordered entries
- **THEN** the execution settles as completed with that exit and message
- **AND** its diagnostics carry one line per published entry

#### Scenario: Count an inspected image instead of dropping it

- **WHEN** a program inspects an image before it returns
- **THEN** its captured output carries one bounded marker that counts the omitted images
- **AND** the marker stays inside the captured-output size bound

#### Scenario: Refuse a host whose output cannot be read

- **WHEN** the program runtime publishes neither contract, or publishes entries that cannot be read
- **THEN** the execution settles as a `configuration` failure whose diagnosis names the shape and entry types it observed
- **AND** the entry stays in its stage with Play and no destination is chosen

#### Scenario: Report the earlier contract once

- **WHEN** a host publishes only the earlier per-call text list
- **THEN** the host is reported once with the contract in use and the fact that its support ends when the declared host floor rises
- **AND** the report is not repeated for every execution on that host

#### Scenario: Bound and redact captured output

- **WHEN** the captured output contains a resolved secret value or exceeds its size bound
- **THEN** the value is redacted before persistence and display
- **AND** an over-bound output is reported as a contract failure instead of being stored in full

#### Scenario: Report the same output for an isolated test execution

- **WHEN** an agent tests a stage program that emits text and inspects an image
- **THEN** the test result reports the same captured text and image marker a real execution would report
- **AND** no card, stage entry, execution record, or history row is created

### Requirement: Failure escalation guidance

Every settled scripted failure SHALL end its delivered message with guidance that names who must correct it, and SHALL NOT leave the reader without an owner. A `script` or `contract` failure SHALL state that the user must correct the program or its completion and that the reader SHALL escalate it to the user instead of working around it. An `infrastructure` failure SHALL state that it is a defect of the DeepSeek Harness or of the Kanban plugin to be addressed by their developers, SHALL state that it is not a problem with the work, and SHALL also direct the reader to escalate it to the user. A refusal of a host that does not publish a readable program-output contract SHALL name the host build as what must change and SHALL direct the same escalation.

A parameter refusal SHALL keep its repair-and-Play path and SHALL also name the step that owed the missing value, derived from the entry's recorded origin: the agent declaration, the scripted result that supplied only some names, the automatic advance, or the manual entry the user must complete. Every other `configuration` failure SHALL keep the repair guidance that returns the entry to a runnable state and SHALL NOT direct escalation of a problem the stage or entry can repair.

The generated guidance SHALL remain bounded, SHALL contain no stack trace and no local filesystem path, and SHALL NOT replace the root-cause code or the recorded origin.

#### Scenario: Escalate a program failure

- **WHEN** an execution settles with a `script` origin
- **THEN** the delivered message keeps the program's own words and states that the user must correct it
- **AND** it directs the reader to escalate the problem to the user

#### Scenario: Escalate a rejected completion

- **WHEN** an execution settles with a `contract` origin
- **THEN** the delivered message states that the completion was rejected and that the user must correct it
- **AND** it directs the reader to escalate the problem to the user

#### Scenario: Escalate a host failure to the application owners

- **WHEN** an execution settles with an `infrastructure` origin
- **THEN** the delivered message states the origin, where the detail lives, and that the problem is a defect of the DeepSeek Harness or the Kanban plugin
- **AND** it directs the reader to escalate the problem to the user

#### Scenario: Name the host build for an unreadable output contract

- **WHEN** an execution is refused because the host does not publish a readable program-output contract
- **THEN** the delivered message names the required host build as what must change
- **AND** it contains no stack trace and no local filesystem path

#### Scenario: Name the step that owed a missing parameter

- **WHEN** an entry whose stage declares parameters is refused because a declared name has no value
- **THEN** the delivered message names the missing names and the origin of the entry that owed them
- **AND** the entry stays in its stage with Play and editable values
- **AND** no destination is chosen

#### Scenario: Keep repair guidance for a configuration the stage can fix

- **WHEN** an execution settles with a `configuration` origin that the stage or the entry can repair
- **THEN** the delivered message names the repair and Play
- **AND** it does not tell the reader to escalate a problem the entry can repair
