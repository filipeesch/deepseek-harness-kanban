# Design

## Context

The board renders one of two presentations from `board.tsx`: the column board, which receives a New task button renderer as a prop, and the workflow diagram, which receives a card port and nothing else. The creation pipeline below the button is already presentation-independent — one dialog, one `task.create` command, one receipt check, and one first-execution handoff — and the dialog is mounted outside the presentation switch, so it already works while the diagram is on screen.

Three constraints shape the approach:

- The diagram's stage header is the drag handle. `useStageDrag.start` returns early only for the lock, a non-primary button, or an in-flight gesture; it never inspects `event.target`, and it calls `preventDefault` and `stopPropagation` on the press. Any control placed inside the header competes with the drag.
- React Flow node data is deliberately kept plain and serializable. Callbacks reach stage nodes through React context (`StageCallbacksContext`, `CardEnvironmentContext`), and the canvas re-syncs nodes only when a stringified signature of the stage model changes.
- A stage clips its own content: `.kb-flow-stage` sets `overflow: hidden`. The diagram's existing `TooltipButton` draws its tooltip with a pseudo-element positioned outside the control's box, which works in the floating control stack and would be clipped inside a stage.

No DSH host API is used or changed by this design; the change is confined to the client bundle. See proposal.md - Why for motivation and the two spec deltas for the required behavior.

## Goals / Non-Goals

**Goals:**

- One creation path behind both presentations, so a change to inputs, enablement, or the first-execution handoff lands once.
- Keep `WorkflowView` and `StageNodeView` presentational: they receive intent through a port and never own dialog state, command execution, or receipt validation.
- Keep the diagram's existing guarantees intact while adding a control to its most gesture-dense region.

**Non-Goals:**

- Do not generalize the New task dialog to accept a target stage.
- Do not introduce a new state container, provider, or context above the board.
- Do not restyle the stage header beyond placing the control.
- Do not change the empty-stage copy; only its single point of definition moves.

## Decisions

### The action lives in the initial stage's header

Placing it in the stage header mirrors where the column board puts its button and keeps the affordance attached to the stage it acts on. Alternatives considered: a control floating over the canvas (untethered from the stage it creates into, and visually competing with the control stack and the minimap); an entry in the diagram's control stack (mixes a data action into layout tools whose contents the `workflow-view` specification enumerates); a board-header action for both presentations (contradicts the standing prohibition and removes a working affordance from the column board); an inline affordance in the empty state (disappears once the stage has a card, which is precisely when a user creates the next task).

### The creation target stays the configured initial stage

`NewTaskDialog` resolves its own target from `workflow.initialColumnId` and gates Start execution now on that stage's entry instruction. Passing an arbitrary stage would move that resolution to the caller, change the entry-instruction rule, and let a card appear in a mid-flow stage without any transition having run. Both presentations therefore create into the initial stage and the dialog is not modified. The alternative — a stage select inside the dialog — contradicts the existing scenario that the experience asks for no stage.

### The action travels through the stage callbacks context, not node data

Node data must stay serializable, so the callback is not placed there. `StageCallbacks` is extended with an optional creation callback alongside `onMeasure` and `onStagePointerDown`, which is the established route for header behavior, and the stage model gains a boolean marking the initial stage so the view decides placement and the node only renders it.

An alternative was a dedicated context beside `CardEnvironmentContext`. It was rejected: creation is one more header behavior with the same owner and lifetime as the existing callbacks, and a second context would split related ports without buying anything.

### The creatable flag participates in the node signature

The canvas compares a stringified signature of each stage model to decide whether to re-sync nodes. The initial-stage flag must be part of that signature, otherwise changing a workflow's initial stage would leave the action on the previously initial stage until some unrelated layout change forced a re-sync. The alternative — keying the whole flow on the workflow key — hides and re-reveals the canvas for a small change and is heavier than needed.

### The control cancels the drag at the control

The button stops the pointer press from reaching the header and is marked non-draggable and non-panning, matching what the stage's resize handle already does. The alternative was teaching `useStageDrag.start` to ignore presses that begin on an interactive descendant. That is a wider blast radius: it changes a gesture that every stage already relies on, and a future control would silently depend on that filter. Keeping the guard on the new control leaves the existing gesture untouched.

The control sits outside the lock check. The lock governs layout editing, and the same reasoning keeps it available during selection mode.

### A native tooltip, not the diagram's tooltip component

`TooltipButton` positions its tooltip outside the control's box, and the stage clips overflow, so reusing it inside a header would render the tooltip invisible. Opening the stage's overflow to fix that would disturb the resize handle and the rounded corners. The control therefore names itself through an accessible name and a native tooltip carrying the same label, which is what the board header's own icon buttons already do. Both carry `NEW_TASK_LABEL` from `src/client/board-copy.ts`, the constant the column board's button names itself by, so the two presentations cannot disagree about what the action is called.

### One `useTaskCreation` instance, owned by the board

The board instantiates the hook once and consumes it three ways: the column board's button renderer reads its enablement and open action, the diagram's port calls its open action, and the board mounts the single dialog it returns. The hook holds what today sits in the board component: the open/closed state, the project-registry enablement, and the first-execution handoff. The creation command and its receipt validation stay where they already are, inside the dialog — moving them would relocate working code without making either presentation thinner.

Alternatives considered: each presentation calling the hook itself, which would produce two open states, two mounted dialogs, and two copies of the receipt validation and start handoff, and would only appear to work because one presentation is mounted at a time; and providing the hook through a context above the board, which adds indirection with no second consumer to serve.

The hook's collaborators — opening the task, the auto-run controller, the latest snapshot, and the board's own answers about which projects may receive a task and whether it is closed to creation — are passed in, so the hook depends on the board through its arguments rather than reaching into it. The board keeps the project-scope decision because only it knows the active board and Hub; the hook forwards those values to the dialog it mounts.

### Container creation stays in its own hook

The board's other dialog states create Hubs and boards and touch active-Hub and board selection. Folding them into `useTaskCreation` would produce a hook with six setters and six callbacks over three unrelated concerns — the aggregation problem the extraction is meant to relieve, reproduced one level down. They move to their own hook, and `useTaskCreation` owns task creation only.

### The empty-stage copy has one definition

Both presentations render the same empty-stage sentence from their own file today. It becomes a single exported constant imported by both, with the wording unchanged; differentiating "no tasks yet" from "no matching tasks" would require threading filter state from the board into the diagram node, which is a separate behavioral change.

### Tests drive the real stage node

The workflow-view suite substitutes the canvas, so the stub gains the header action that the real canvas's stage node renders. The assertions then cover placement on the initial stage only, press-without-drag, availability under the lock and during selection mode, and the disabled state without projects — the requirements that the real canvas would otherwise hide behind its own stub boundary.

## Risks / Trade-offs

- A press on the new control starts a stage drag and stores a layout change → the control cancels the press before the header sees it, and a spec scenario plus a unit test assert that no move, resize, or save occurs on activation.
- The initial-stage flag is left out of the node signature and the action follows a stale stage after a workflow edit → the flag is part of the compared signature, and a test flips the initial stage and asserts the action moves.
- The stub canvas renders the action only because the test author remembered → the stub mirrors the real stage node's header markup, so a test that passes against the stub exercises the same component path as production.
- Two `useTaskCreation` instances reappear later, one per presentation → the hook is documented as board-owned, receives its collaborators as arguments so a second instance would have to be wired deliberately, and the board's tests cover creation through it for both presentations.
- The control is disabled without a project only in one presentation → enablement is read from the single hook, and the column board's existing disabled-without-projects test is paired with an equivalent diagram test.
- The tooltip is not visible inside the clipped stage → a native tooltip is used instead of the diagram's overflow-dependent one; the trade-off is the platform's tooltip styling rather than the diagram's.
- `useTaskCreation` grows into a second board component → it owns creation only; container creation and every non-creation concern stay outside it, and its arguments are the only way in.

## Migration Plan

Client-only change with no stored-format, wire, or host changes, so there is nothing to migrate. Existing boards, workflows, and tasks are unaffected. Reverting the change removes the diagram's action and restores the board-owned creation state; no data written by the new path differs from the existing one.

## Open Questions

- Whether the empty-stage constant should later also serve the drawer's task lists. It has no drawer consumer today and does not affect this change's placement, approach, or tasks.
