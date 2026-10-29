# Spec Delta

## ADDED Requirements

### Requirement: Task card layout

The board SHALL render each task as a card composed of distinct regions in a fixed order: a title region, a context region, an activity region, and a status region. The context region SHALL present the task's project name together with its unread, awaiting-reply, and failure attention indicators. The activity region SHALL present turn execution, background activity, and the stage run action defined by Run a stage instruction from a card. The status region SHALL present unresolved context-operation and confirmed-transition state as defined by Task card status strip.

The project name SHALL remain visible on every card, SHALL be visually quieter than the title, and SHALL expose the complete name when the available width truncates it. The title SHALL NOT be clamped to a fixed number of lines. In selection mode the card SHALL present its selection control at the leading edge of the context region. The whole card surface SHALL remain activatable as defined by Open a task drawer, except for nested controls, which SHALL perform their own action without opening the drawer.

#### Scenario: Present the card regions in order

- **WHEN** a task card renders
- **THEN** the title, the context region, the activity region, and the status region appear in that order
- **AND** the project name and the attention indicators are in the context region, not the activity region
- **AND** turn execution and background activity are in the activity region, not the context region

#### Scenario: Keep a long title readable

- **WHEN** a task title is wider than the card
- **THEN** the title wraps onto additional lines without a fixed line clamp
- **AND** the complete title remains available to assistive technology

#### Scenario: Keep a long project name available

- **WHEN** a project name is wider than the context region
- **THEN** the context region truncates the visible name
- **AND** the complete project name is available on hover and to assistive technology

#### Scenario: Place the selection control

- **WHEN** the board is in selection mode
- **THEN** each card presents its selection control at the leading edge of the context region
- **AND** the card does not overlay the control on the title region

#### Scenario: Omit an empty status region

- **WHEN** a card has no unresolved context operation, confirmed transition, or run-action failure
- **THEN** the card presents no status-region content

### Requirement: Single-line activity strip on task cards

The card's activity region SHALL keep its content on one line. When the task owns exactly one background activity kind, the background indicator SHALL present that kind's label and count. When the task owns more than one background kind, the indicator SHALL present the total number of unsettled activities instead of per-kind text, and SHALL expose every activity label on hover and to assistive technology. The card SHALL reserve the activity region's height in every task state, so that starting or ending a turn, changing the background count, or showing the run action SHALL NOT change the card's height. The run action and its countdown control SHALL render at the trailing edge of the activity region and SHALL NOT add a separate action row.

#### Scenario: Label a single background kind

- **WHEN** a task owns unsettled activities of exactly one kind
- **THEN** its card's background indicator presents that kind's count and label
- **AND** the activity region stays on one line

#### Scenario: Aggregate multiple background kinds

- **WHEN** a task owns unsettled activities of more than one kind
- **THEN** its card's background indicator presents the total number of unsettled activities
- **AND** the indicator does not present per-kind counts
- **AND** every activity label is available on hover and to assistive technology
- **AND** the activity region stays on one line

#### Scenario: Keep the card height stable

- **WHEN** a turn starts or ends, the background count changes, or the run action appears or disappears while no status is shown
- **THEN** the card keeps the same height
- **AND** the activity region keeps one line

#### Scenario: Present execution and background together

- **WHEN** a task is running a turn and also owns unsettled background work
- **THEN** the working indicator and the background indicator both appear in the activity region
- **AND** the activity region stays on one line

#### Scenario: Place the run action in the activity region

- **WHEN** a card exposes the run action or its countdown control
- **THEN** the control appears at the trailing edge of the activity region
- **AND** the card does not add a separate action row

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation and confirmed transition in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A status SHALL remain visible while its operation or transition is unresolved. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

#### Scenario: Report a failed operation

- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending transition

- **WHEN** a card's task has a confirmed transition that is not settled
- **THEN** the status region presents a pending-toned status naming the pending confirmation

#### Scenario: Present multiple statuses together

- **WHEN** a task has both an unresolved operation and a confirmed transition
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Report a run-action admission failure

- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the status region reports the failure
- **AND** the run action remains available for the same entry

#### Scenario: Clear a resolved status

- **WHEN** the operation or confirmed transition resolves
- **THEN** the corresponding status is no longer presented in the status region

## MODIFIED Requirements

### Requirement: Visible execution state on task cards

A task card SHALL present turn execution through a visible working indicator and a distinct card accent rather than a text label alone. The indicator SHALL remain legible in the host's light and dark appearances and SHALL follow the host theme. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping the indicator and accent visible without animation. When the task owns background activity, the card SHALL present a separate background indicator that shows the number of unsettled activities and makes their labels available on hover and to assistive technology. The background indicator SHALL be visually quieter than the working indicator, and it SHALL be present on its own when no turn is running. The working and background indicators SHALL be presented in the card's activity region defined by Single-line activity strip on task cards, separate from the project name and attention indicators.

#### Scenario: Card shows a running turn

- **WHEN** a task is running an assistant turn
- **THEN** its card shows the working indicator and the card accent
- **AND** the working state is announced once to assistive technology

#### Scenario: Card shows background work only

- **WHEN** a task's turn has ended and it still owns unsettled background work
- **THEN** its card shows the background indicator with the activity count and no working indicator

#### Scenario: Background labels are available

- **WHEN** the user points at or focuses the background indicator
- **THEN** the labels of the task's unsettled activities are available
- **AND** the labels are exposed to assistive technology

#### Scenario: Activity is separate from identity

- **WHEN** a card presents a working indicator or a background indicator
- **THEN** those indicators are in the activity region
- **AND** the project name and attention indicators are in the context region

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** the working indicator and card accent remain visible without animation

#### Scenario: Theme appearance

- **WHEN** the host application uses its light or dark appearance
- **THEN** the working and background indicators remain legible and use host theme colors
