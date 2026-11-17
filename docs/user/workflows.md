# Workflows

Each board owns a YAML workflow: its stages, their order, the transitions between them, and the entry instruction of each stage. The workflow lives on the board, not in the Hub or in the team document; a board shares it by publishing, described in [Team sharing](team-sharing.md).

## Editing the workflow

**Configuration → Boards → Edit → Workflow** edits that board's YAML in a code editor with line numbers, YAML highlighting, folding, search, live diagnostics, vertical resize, and a maximize toggle. Save is disabled while the YAML is invalid or still checking; the host remains authoritative for orphaned columns and revision conflicts.

The draft survives sub-tab switches inside that board's configuration, and closing the board configuration or reloading with unsaved changes asks first. Reopening the board starts from the saved workflow.

Each new board starts with exactly five stages and no entry instructions:

```yaml
name: Delivery Flow
initial_column: backlog
columns:
  - id: backlog
    label: Backlog
  - id: plan
    label: Plan
  - id: in_progress
    label: In Progress
  - id: in_review
    label: In Review
  - id: done
    label: Done
```

## Stages, groups, and transitions

An optional customization keeps those stage IDs and adds a group, transition restrictions, and a Plan instruction:

```yaml
name: Delivery Flow
initial_column: backlog
columns:
  - id: backlog
    label: Backlog
    allowed_transitions: [plan]
  - id: plan
    label: Plan
    allowed_transitions: [backlog, in_progress]
    on_enter_prompt: |
      Review the task description and propose an implementation approach.
      Ask any necessary questions before changing files.
  - id: in_progress
    label: In Progress
    allowed_transitions: [plan, in_review]
  - id: in_review
    label: In Review
    allowed_transitions: [in_progress, done]
  - id: done
    label: Done
    allowed_transitions: [in_progress]
groups:
  - id: delivery
    label: Delivery
    columns: [in_progress, in_review]
```

A transition may also carry the condition under which the model should follow it, authored as `{ to, when }` next to the bare identifier form. Both forms are accepted, neither is deprecated, and one list may mix them. A condition never changes which transitions the workflow permits; it documents when the model should choose one.

```yaml
columns:
  - id: in_review
    label: In Review
    allowed_transitions:
      - to: done
        when: The review approved the work with no requested changes.
      - to: in_progress
        when: The review found changes that must be implemented.
```

Groups present real columns, not extra destinations. A column's omitted `allowed_transitions` permits any other existing column; `[]` permits none and makes it a terminal stage. Entry instructions use `on_enter_prompt`.

The root accepts `name`, `description`, `initial_column`, `default_view`, `columns`, `groups`, `model`, `agent_preset`, `mcp`, and `connections`; a stage accepts `id`, `label`, `description`, transitions, an instruction, a script, placement, and size. Unsupported fields, invalid YAML, unknown stage references, and updates that orphan an existing card's stage are rejected without replacing the last valid workflow.

Workflow and stage descriptions are optional authored context, distinct from `on_enter_prompt`. A root `description` and a column `description` are preserved character for character, a missing or blank description stays absent, and no length limit is imposed on other authors. The workflow architect's guidance asks it to write and maintain a description of at most 150 characters for the workflow and for every stage. Descriptions participate in semantic comparison, revision, diff, replay, restore, and sharing conflict detection, and a peer that cannot preserve them reports incompatibility instead of dropping them.

```yaml
description: Delivery flow for one product slice
columns:
  - id: plan
    label: Plan
    description: Agree the approach before code changes.
``` The parser lives in [the workflow domain](<../../src/domain/workflow.ts>) and the durable store in [the store](<../../src/domain/store.ts>).

A stage can run code instead of an agent instruction; see [Scripted steps](scripted-steps.md) for the fields that replace a stage's instruction and transitions.

## Decision gates

A stage can stop the flow for a person's explicit choice instead of running an agent instruction or a program. In the stage editor choose **Decision** on the Stage tab; the Decision tab carries the question, optional Markdown context, and one to twelve options. Each option has an **Id** (the identity a recorded choice keeps), a **Title**, an optional **Description**, and a **Destination** stage; several options may share a destination. One option is a valid explicit confirmation. A decision stage cannot also author an instruction, an allowed-transition list, or a scripted program: switching to **Decision** clears the other mode.

```yaml
columns:
  - id: review_gate
    label: Review gate
    decision:
      question: How should this review proceed?
      context: Address any findings before shipping.
      options:
        - id: fix
          title: Fix in place
          to: in_progress
        - id: ship
          title: Ship it
          to: released
```

A task in the gate stays in its stage until the person answers. The card presents the awaiting-input tint, a **Decision needed** mark, and a status line; the drawer presents the gate above its sections, in every section and without requiring a conversation. Select one option, optionally add an **Observation** (up to 776 characters), and activate **Confirm choice**; selecting alone does nothing.

Confirming opens a cancelable five-second window on the card and in the panel. The task moves only when the window closes; **Cancel**, a reload, or closing the app applies nothing and leaves the gate waiting. The choice moves the task to the option's destination and records it in **History** with the option and the observation. When the destination authors an instruction, that instruction is sent with the choice as its reason, reading `Decision: <title>` and the observation; a scripted destination starts its own execution instead.

The gate owns its routing. A completed turn does not advance out of a decision stage, whether or not auto mode is on, and no agent can declare its route, including with the exceptional flag. Every manual move out of the stage asks for the restricted-transition confirmation. A workflow edit that removes or retargets an option before the card is first placed refuses the pending choice; after the move is recorded, a later edit does not invalidate it.


## Edit one stage

The stage editor's **Edit stage** action, and the pencil on every stage header, opens one dialog for a single stage. Its identity section edits the stage name, the optional **Stage description**, and the stable ID. The board always presents it; the workflow diagram presents it disabled while its layout is locked.

Allowed destinations have three modes: allow any other stage, choose specific destinations with an optional condition for each, or no destinations for a terminal stage. A condition is a multiline field you can resize, and clearing it stores no condition. Saving changes only the fields you edited, and every other authored character of the workflow stays as its author wrote it.

## The workflow diagram

Every board can also be presented as a workflow diagram. The board header's **Board** and **Workflow** switch selects the presentation, and the choice is remembered per board in the browser; the YAML's `default_view` decides which one a board opens with until you choose for that board.

```yaml
default_view: workflow
columns:
  - id: plan
    label: Plan
    position: {x: 400, y: 20}
    size: {width: 400, height: 300}
```

An omitted `default_view` opens the column board, and switching never edits the workflow YAML or reaches the host. The diagram fills the board body edge to edge and draws one rounded region per stage with the board's own cards. It connects stages from their configured transitions: `allowed_transitions` entries are solid lines, a stage without them gets one dashed line to the next stage, and `[]` has no outgoing line.

Stages are placed in layers automatically; an authored `position` overrides that placement, and **Organize** recomputes and stores every position. A missing position is placed automatically and stays put for the session. An optional `size` is the minimum width and height a stage renders at; the stage still grows with its cards, never shrinks below that minimum, and can be resized by its trailing corner while editing is unlocked. A missing size uses the diagram's default.

Dragging a stage by its header or resizing it stores one workflow save, with the same validation, draft, publishing, and sharing-merge rules as any other workflow edit.

An arrow's layout is authored too. `connections` holds one entry per adjusted arrow, identified by its source and target stage; an entry may name the touch point of either end and displace any adjustable segment of the route:

```yaml
connections:
  - from: plan
    to: in_progress
    source: {side: bottom, at: 4}
    target: {side: top, at: 1}
    segments: [{axis: x, offset: 64}, {axis: y, offset: -20}]
```

A touch point names one of the four stage sides and one of five points along it, at 10, 30, 50, 70, and 90 percent, so a stage boundary offers twenty anchor points; the arrow leaves and enters perpendicular to the side it names. A displacement is stored with the axis it moves and applies to the automatic segment of that axis at the same position along the route, so the shape follows a stage that moves or resizes, and does not move when a stage the connection does not cross is moved. A route that must clear stage regions is routed below the stages its own corridor crosses and no others. A displacement the current route has no segment for stays in the document and applies again if that shape returns. An entry whose arrow the diagram no longer draws is ignored rather than rejected, and an entry repeated for the same pair is rejected as an invalid workflow.

A build older than this feature rejects a workflow that contains `connections`, so every installation on a team has to be updated before such a board is published.

## Authoring connections on the diagram

Pointing at a stage reveals a connection port on each of its four sides, each with a twenty-four pixel pointer target. Pressing one and dragging presents the line being drawn, and while a candidate stage is under the pointer it presents the route the release would author, including its arrowhead.

Drag any port onto another stage to author that transition. The connection leaves from the side you drew from when that is not the side the automatic route would use. Drawing from a stage that allowed any other stage, or from a stage that permitted none, authors exactly the drawn destination, so the stage becomes restricted to it and the dashed default path it no longer allows stops being drawn; a stage that already authored destinations keeps them and gains the new one. Dropping on the source stage, or on a destination it already permits, changes nothing.

Dragging a connection's end handle onto another stage changes the connection's destination instead of re-anchoring it, and the stage under the pointer is marked as the candidate before the release: the target end points the transition at the new stage, and the source end moves the transition to that stage as its owner, leaving the previous source permitting nothing when it had only that destination. The layout entry of the pair a connection leaves is removed with the transition.

Double-press a connection to edit the `when` of exactly that transition in a field you can resize, anchored to the arrow; the default dashed path becomes an authored transition when its condition is saved. A connection that authors no condition shows a small dashed hollow ring, and both ends name whether a condition is authored; the ring waits for the unlock, because authoring that condition changes structure.

Press a connection to select it and Delete or Backspace, or use the editor's **Delete**, to remove the transition. Removing a stage's last destination leaves it permitting none, which is a valid terminal stage: it draws no outgoing line, a card there offers no next-stage action and is never advanced automatically, and every way out asks for the same restricted-move confirmation.

Authoring a connection, changing its destination, deleting it, and editing its condition are one undo step each, join the same layout lock, and are presented before the host acknowledges them. Both authoring a condition and editing one a connection already authors wait for the unlock: a locked diagram opens no editor, and locking the layout closes an open editor and discards its draft. The stage edit action waits for the unlock too.

## Layout, lock, and navigation

Layout edits settle on a grid by default: dragging a stage, resizing it, and moving an arrow segment all round to the nearest multiple of eight diagram units, so stages edited at different times share the same lines. The grid is absolute, so a stage whose stored position is off the grid moves onto it on its first edit; automatic placement and **Organize** keep their own geometry and are not snapped. Hold Alt (Option on macOS) while dragging to ignore the grid for that gesture, and turn snapping off with the magnet control in the bottom-left stack; the choice is remembered in this browser and never reaches the workflow YAML. An edit that settles where it started stores nothing.

The diagram keeps a layout lock every time it is opened. While locked, stages cannot be moved or resized, arrows cannot be adjusted, their edit marks are not presented, and **Organize**, **Undo**, and **Redo** are unavailable; cards, pan, zoom, and pressing an arrow to read its route keep working. A locked diagram presents the selected arrow's route above the stage regions without any edit mark, and focusing an end selects it.

The bottom-left control stack holds zoom in, zoom out, fit, undo, redo, organize, the snapping toggle, and the lock, each with a tooltip and an accessible name. The bottom-right minimap always shows the stages and the current viewport and can be dragged to pan. **Undo** and **Redo** cover stage placement, size, and arrow layout, including one Organize step, per board, and are cleared on reload. The wheel zooms at the pointer without a modifier, dragging the background pans, and a pinch zooms; navigation never changes board data. The pan position and zoom are remembered per board in the browser and restored when that board opens. The stored view is never sent to the host, never edits the workflow, and never appears in the published document.

Cards stay clickable and keyboard reachable: activating one opens the task drawer, and dragging one to another stage runs exactly the same move pipeline as the board, including restricted confirmation, first-execution preparation, and the timed stage instruction. The card's next-stage button uses the same pipeline and is hidden while the task is running. With the diagram open, a card that changes stage is announced by a short transit along the arrow the diagram draws: a bright core with a halo and a short trail, moving at a constant speed from the source stage to the destination. The card is presented in the destination immediately and pulses once when the transit arrives. A stage change between two stages the diagram draws no arrow for presents no transit, and the card still pulses as it arrives. More than eight cards moving in one change, and the reduced-motion preference, settle every movement immediately.