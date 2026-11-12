# Spec Delta

## Purpose

Lets an agent measure how a board's workflow is actually used and inspect the diagram that workflow produces, without reading conversations and without opening the graphical board.

## ADDED Requirements

### Requirement: Route usage statistics

`get_route_stats` SHALL be read-only and SHALL accept one board, an optional time window that defaults to the last 90 days, and an optional project filter. Over the tasks the board currently holds, it SHALL report: each drawn transition by origin and destination with its number of uses and the origin of each use, distinguishing an operator move, a declared transition, an automatic advance, a named script exit, and the reserved error route; each configured script exit with its number of uses, including configured exits that were never used; each stage with its number of entries, the mean and ninetieth-percentile time a task spent in it, and the cards currently in it with how long each has been there; each card's number of traversals around a repeated route with the mean and maximum; and every configured route and exit with no use in the window. The payload SHALL carry identifiers, counts, durations, and labels only, and SHALL NOT carry a card title, description, note, task message, or conversation content.

#### Scenario: Count one transition

- **WHEN** an agent asks for a board's route usage over a window in which a transition was used
- **THEN** the report names that origin and destination with the number of uses in the window
- **AND** uses outside the window are excluded

#### Scenario: Distinguish how a transition was used

- **WHEN** the same transition was used by an operator move, by a declared transition, by an automatic advance, and by a named script exit
- **THEN** the report separates those uses by origin
- **AND** a named script exit use names the exit

#### Scenario: Count a named exit and list an unused one

- **WHEN** a deterministic stage configures two exits and only one was used in the window
- **THEN** the report gives the used exit its count
- **AND** it lists the unused exit as configured and unused

#### Scenario: Report time spent in each stage

- **WHEN** an agent asks for a board's statistics and tasks have completed stage entries
- **THEN** each stage reports its number of entries and the mean and ninetieth-percentile time spent in it

#### Scenario: Report cards parked now

- **WHEN** cards currently sit in a stage
- **THEN** the report names them and how long each has been there

#### Scenario: Count loops

- **WHEN** a card traversed the same repeated route more than once
- **THEN** the report gives that card's number of traversals together with the mean and maximum over the board

#### Scenario: Filter by project

- **WHEN** an agent asks for statistics filtered to one project
- **THEN** only the uses of that project's cards are counted

#### Scenario: Carry no card text

- **WHEN** an agent asks for a board's statistics
- **THEN** the payload carries identifiers, counts, durations, and labels
- **AND** it carries no card title, description, note, task message, or conversation content

#### Scenario: Statistics never change the board

- **WHEN** an agent asks for statistics
- **THEN** the board's stored workflow, tasks, and Hub revision are unchanged

### Requirement: Diagram rendering

`render_workflow_diagram` SHALL render a board's workflow as a diagram drawn with the same connection routing, anchor, fan-out, and clearance geometry the graphical board draws, and SHALL accept an unsaved workflow document so a proposed change can be shown before it is saved. It SHALL accept a card mode presenting the board's current cards, no cards, or a given number of cards per stage, and SHALL derive each stage's height from its authored size and the cards it is asked to show, growing a stage whose cards exceed its authored height. It SHALL always report the paths of the files it wrote, SHALL additionally produce a raster image when a rasterizer is available, and SHALL attach the rendered image to its result only when the calling route accepts image input. It SHALL NOT fail because no rasterizer or no image input is available, and it SHALL NOT change the board.

#### Scenario: Render the saved board

- **WHEN** an agent renders a board's diagram without supplying a document
- **THEN** the diagram shows the board's saved workflow
- **AND** the result reports the path of the written drawing

#### Scenario: Render a proposed document

- **WHEN** an agent renders a diagram supplying an unsaved workflow document
- **THEN** the diagram shows that document
- **AND** the board's saved workflow is unchanged

#### Scenario: Show the current cards

- **WHEN** an agent renders a diagram in the mode presenting current cards
- **THEN** each stage shows the cards the board holds in it
- **AND** a stage whose cards exceed its authored height is drawn taller

#### Scenario: Render an empty workflow

- **WHEN** an agent renders a diagram in the mode presenting no cards
- **THEN** every stage is drawn without cards and at no less than its authored height

#### Scenario: Produce a raster image when possible

- **WHEN** a rasterizer is available
- **THEN** the result reports a raster image path as well as the drawing path

#### Scenario: Degrade when no rasterizer exists

- **WHEN** no rasterizer is available
- **THEN** the result still reports the vector drawing path
- **AND** the tool succeeds instead of failing

#### Scenario: Attach the image only when the route accepts it

- **WHEN** the calling route accepts image input and a raster image was produced
- **THEN** the result carries that image
- **AND** when the route accepts no image input the result carries the paths alone

### Requirement: Layout diagnostics

`layout_metrics` SHALL accept the same board, document, and card mode as the diagram rendering and SHALL report the number of route crossings, the number of route segments that pass through a stage, the number of overlapping route segments, the number of overlapping stages, the number of named-exit labels covered by a stage or by another label, the number of route folds, and the total route length, together with a list of problems naming the stages and connections involved. The metrics SHALL describe the same geometry the rendered diagram presents for the same input. It SHALL NOT change the board.

#### Scenario: Report crossings

- **WHEN** an agent asks for layout metrics of a document whose routes cross
- **THEN** the report counts those crossings
- **AND** it lists the connections involved

#### Scenario: Report a segment through a stage

- **WHEN** a route segment passes through a stage rectangle
- **THEN** the report counts it and names that stage and connection

#### Scenario: Report overlapping stages

- **WHEN** two stages overlap
- **THEN** the report counts the overlap and names both stages

#### Scenario: Report a covered exit label

- **WHEN** a named-exit label is covered by a stage or by another label
- **THEN** the report counts it and names the label and what covers it

#### Scenario: Metrics follow the cards they are asked about

- **WHEN** an agent asks for metrics in the mode presenting current cards and a stage grows to fit them
- **THEN** the metrics describe the grown geometry
- **AND** they agree with the drawing produced for the same input
