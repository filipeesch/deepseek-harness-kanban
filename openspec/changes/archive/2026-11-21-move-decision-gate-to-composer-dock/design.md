# Design

## Context

See proposal.md for motivation.

The gate is mounted in the task drawer between its header and its section panel (`src/client/drawer.tsx`). Its component (`src/client/decision-panel.tsx`) carries three concerns at once: the presentation of the strip, the state of the answer being composed, and the wiring of the shared `DecisionWindowController`. It reuses the structured-question strip stylesheet and adds a local stylesheet that removes the strip's width and centering, and bounds only the scrolling region.

The host composes `conversation.input.dock` as "full-width entries above the composer card" inside the composer stack, session-scoped. The plugin already registers two entries there: the structured-question dock (order 20) and the session diagnosis (order 30). That is where a structured question round is presented, and it is the surface the person answers while reading a conversation.

Two constraints shape the approach. First, that composer stack is a sticky seat at the bottom of the transcript's scrollport, so anything mounted in it takes height from the transcript and, when the stack outgrows the scrollport, is pushed outside the visible area from the top. Second, the dock is global: it renders in every conversation window the host draws, including ordinary chats that belong to no task, so the gate must resolve its task from the Session and render nothing otherwise.

The existing session-to-task membership test lives inside the drawer navigation coordinator and applies to a task it already holds; there is no shared way to resolve a task from a Session. The browser harness rendered the gate standalone in a fixed-width column with no composer, so nothing tested where the gate actually sits or how the strip and the composer share the seat.

## Goals / Non-Goals

**Goals:**

- One placement for the gate, in the surface the host already dedicates to work that waits for the person above the composer.
- One strip geometry shared by the gate and the question round, with a height bound that keeps both headers and actions reachable in a short window.
- One way to resolve a task from a Session, testable without a host.
- A presentational gate that the browser harness and client tests can render without a controller or a board.

**Non-Goals:**

- Changing what the gate asks or records: the question, context, options, observation, selection rules, five-second window, durable route, history record, and card attention are unchanged.
- Adding a second answering surface for tasks without a conversation, such as a drawer fallback or a board modal.
- Reworking the composer, the transcript, or the question round's page progression.
- Changing any workflow, command, storage, or host API surface.

## Decisions

### Register the gate as an input-dock entry, not a drawer panel

A new `conversation.input.dock` entry renders the gate, receiving the board command port and the shared `DecisionWindowController`; the gate resolves the task from `props.sessionId`. Alternatives considered: keeping the drawer mount and restyling it (cannot sit above the composer), replacing the composer through the `conversation.composer` chain (would hide the person's input), and overlaying the strip inside the composer card (would cover the transcript and the composer). The dock is the only surface that is above the composer and still leaves the composer usable.

Consequence: a task with no open conversation presents no gate in the drawer. The task card keeps its decision attention, and the restricted manual move remains available; the user accepted this trade-off.

### Order the gate above the question dock

The entry takes an order smaller than the question dock's 20, so the gate is the first strip above the composer and a waiting question round sits beneath it. Both stay mounted and answerable; the gate is not hidden while a question waits, because the gate is a task-level wait that the person may answer first. Alternative: hiding the gate while a question round is pending, rejected because it makes a task-level decision depend on a conversation-level one.

### The seat shares its height between the strips and the composer

The composer seat is sticky at the bottom of the transcript's scrollport, so the strips, the composer, and any other seat entry must fit inside that scrollport together. A stylesheet cannot know the conversation's height, and the viewport is the wrong number in an embedded conversation or under a tall draft, so the plugin measures: `src/client/dock-seat.tsx` finds the scrollport above the strip, walks to the layer that holds both the strips and the composer (the pinned host nests them in one stack inside the sticky seat), reserves every non-strip box there — the composer card above all — plus the seat gaps and any seat chrome outside that layer, then reserves each strip's fixed header and footer and splits only the remainder between the strip bodies. The result is published as `--kb-dock-budget` on the strip's box, which the shared stylesheet uses, with `clamp(120px, calc(100dvh - 360px), 460px)` as the pre-measurement fallback. A box that is not visible (a submitted question round keeps its form mounted for its draft) takes neither a gap nor a share. When the fixed controls cannot all fit but the header bars can, every strip keeps its header and is marked `data-kb-dock-tight`, which makes the strip scroll as a whole instead of clipping its footer away. When not even the header bars fit beside the composer, the strip is marked `data-kb-dock-cramped` and presented above the conversation in a panel sized from the conversation's own box, with one disjoint slot per strip, scrolling as a whole; collapsing it hands the space back to the composer. That panel is portaled to the document body, because the host's dock contract requires fixed overlays to live outside the composer: the sticky seat sets `will-change: transform`, which would otherwise make the seat the containing block of a fixed descendant. The portaled panel loses the composer's custom properties with its original subtree, so it sizes the strip directly. A conversation too shallow for two usable panels falls back to compact launchers: the strips share one open slot below their launchers, the open one scrolls as a whole, and opening a launcher neither overlaps the others nor toggles the form's own collapse. The launcher header reports the visible state — an inactive launcher is collapsed, a focus-only visit changes nothing, and leaving the launcher presentation restores the form's own value from whether its body is on screen. Selecting a launcher expands a panel the person had collapsed before, and the open strip is chosen among the strips that are actually visible, so a reopened conversation never keeps an id whose strip is gone. The activation interception covers only the disclosure button: a cancel action that stays on the launcher's visible header row must still stop a pending countdown. The strip's box is created once and moved between presentations so a threshold change never remounts a form, and focus inside it is restored after the move. The fixed bands that determine the bound (the header, the footer, the layer, and the scrollport) are observed directly and the strip's subtree is watched for mounted or removed controls, because a wrapping footer must re-measure even when the seat's own height is stable.

Alternatives: a pure-CSS bound based on the viewport is wrong in an embedded conversation and under a growing draft; the host's `--dsh-composer-text-max-height` is a body cap, not a window-aware one; auto-collapsing below a height breakpoint changes the expanded-by-default contract and hides the question; and capping each strip independently (the first implementation) let the two of them push the composer out of the seat.

A question strip's footer keeps its attach and navigation actions in one row: the answer-file list keeps a single scrolling row instead of wrapping into a second one. Without that, a long file list grew the footer past the strip's bound and the Next action was clipped. The decision gate needs no such rule because it carries no files.

### The dock subscribes to the board snapshot itself

The entry receives the client command port and subscribes the way the board does: the subscription replays the held snapshot, and only a host that did not replay is read with one `snapshot()` call. It then resolves the task, reads the columns and local stage identities straight from the task's own board, and presents the gate. Alternatives: reading the plugin-level latest snapshot non-reactively (the gate would not re-render when the choice is applied elsewhere, for example from the card's countdown), and projecting a full board view (relations, notes, presets) for the three fields the gate reads.

The board page unmounts when another host panel is active, but the plugin-level snapshot subscription keeps the bridge live, so a conversation opened in the host's main chat still resolves its task.

### One session-to-task lookup

The dock needs to resolve a task from a Session, which no client module offers today. The lookup becomes one pure function over the snapshot, scanning each Hub's tasks once and returning the task with the board that owns it, with tests of its own. Surfaces that already hold the task (the drawer navigation coordinator's fork paths) keep their local membership test, because they re-resolve a known task rather than starting from a Session. Alternative: inline the lookup in the slot registration, rejected because it would be untestable without a host and duplicated in every session-first surface.

### Split presentation from wiring in the gate

`decision-panel.tsx` becomes three pieces: a presentational gate that takes the decision, the current selection, the observation, the collapsed state, the window entry, the refusal, and callbacks; a draft container that reads the task and the controller and supplies those props; and a thin export that keys the draft by task and stage entry. The presentational piece is what the harness and the client tests render. Alternative: one component with a placement variant, rejected because a flag recreates the second visual language this change removes.

The gate keeps the `kb-decision` root class so the existing end-to-end locator and the browser assertions keep working.

### The answer is shared; the draft is per stage entry

Every conversation of the task mounts its own draft, but the answer being applied belongs to the one shared window: when an entry is present, the draft adopts the entry's option, observation, and focus, so two conversations never show different selections or different refusals, and the draft a person edits after a refusal stays editable because adoption happens once per entry value. The draft is keyed by the task and its stage entry, so a task that moves from one decision stage to another starts unanswered even when the second stage reuses the same option identities.

The refusal is presented in the strip's footer beside the confirm action, not at the end of the scrolling body: the body can be scrolled and is often shorter than its content, and the person must see why the choice was not applied.

### Remove the gate from the drawer

The drawer drops the gate mount and the `decisionWindow` prop. The plugin-level subscription that reconciles the controller stays where it is, because the controller must keep reconciling while no drawer is open.

### Tests pin the placement, not only the content

The browser harness gains a scenario that draws a host-like conversation: a viewport-sized root, a scrolling transcript, and a sticky composer seat that mounts the registered dock entry and a real question form, with the composer stand-in at the host's card width. The gate is therefore asserted where it will actually live: exactly one gate inside the seat, above the question strip, above the composer, following the composer's width and centering, keeping every header, footer, and the composer inside a short viewport, and rendering outside the Kanban page scope. A client test drives two registered conversations of one task and asserts one window and one submitted command after exactly five seconds; other client tests cover the shared answer, the draft reset for a new stage entry, and the absence of a gate after the snapshot resolved. The bridge test that compares the exact slot entry list gains the new entry.

## Risks / Trade-offs

- **A task with no conversation cannot answer its gate** → accepted by the user's decision; the card keeps the decision attention, the restricted manual move stays available, and the guide tells the person to open a conversation.
- **The same gate appears in every open conversation of the task** → one controller holds at most one window per task, so the countdown and the result cannot diverge; the surfaces read the same entry.
- **The dock runs in every conversation window of the host, including ordinary chats** → the container resolves and renders `null` in one pass when no task matches; the subscription is one per mounted conversation window.
- **The bound is a heuristic** → the strip's bound reserves the composer's footprint per strip and the question strip takes half when a gate precedes it; the header and footer never shrink, so an unusually short window yields a smaller scrolling body rather than a lost control. The pinned browser lane measures a 420px-tall window with a 150px composer.
- **The e2e and browser assertions move** → the gate keeps its root class, and the placement assertions are added rather than replacing the content assertions.
- **Retiring two requirements instead of modifying them** → the placement requirement and the task-surface requirement are both replaced by "Decision gate above the composer", because the retired task-surface requirement promised the gate without a conversation. Every other gate requirement is untouched, and the delta records both reasons and migrations.

## Migration Plan

Client-only change with no stored state: the gate was never persisted, and the controller's window is already client state that a reload discards. Deploying needs a client reload; rolling back is a revert of the commit, which restores the drawer strip without touching board data. Archiving the change rewrites the decision-gate placement requirement and the question-panel requirement in the main specs.