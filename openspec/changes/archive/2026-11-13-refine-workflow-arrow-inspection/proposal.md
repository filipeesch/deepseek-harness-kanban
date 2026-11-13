# Proposal

## Why

The diagram's layout lock hides editing, but pointing at an arrow still reveals the handles and segment grips that move it, and a locked arrow cannot be selected at all. The marks are inert while locked, so they advertise an edit the diagram will not accept, and the one useful thing a locked arrow could do — being selected so its route can be followed — is refused. In a dense diagram, the arrow a reader wants to trace is exactly the one that is hardest to read, and the segments an arrow passes behind a stage are invisible.

## What Changes

- A locked arrow no longer presents the marks that move it. Pointing at it and selecting it reveal no end handle and no segment grip. The pointer targets stay in the document and stay focusable so the keyboard still reaches both ends of every arrow.
- An arrow is selectable in both modes. While the layout is locked, pressing an arrow selects it for reading only: no gesture starts, no condition editor opens, and no deletion becomes available.
- The selected arrow draws its route above the stage regions, so the segments a stage region hides become visible. The elevated copy uses the same selected paint, keeps the dashed pattern of an implicit arrow, presents its arrowhead, and never receives a press.
- Pointing at an arrow while inspecting emphasizes its stroke without presenting a mark. Pointing at one while editing keeps the current marks and gains the same stroke emphasis.
- **BREAKING** The layout lock now also refuses editing a condition that a connection already authors. Turning the lock on closes the condition editor and discards its draft.
- Focusing an arrow end while the layout is locked selects that arrow, so the keyboard keeps a way to read the route; the selected arrow's reinforcement is its only focus indicator. In the editable mode, focusing an end keeps its current meaning and does not change the selection.
- The rule that decides what a connection presents moves into one pure policy module, keyed by an `inspect` or `edit` mode instead of a lock boolean. The edge, the affordance layer, and the connection gestures consume that mode, and the lock CSS and the condition editor's lock input that become unreachable are removed.

## Capabilities

### New Capabilities

None. The diagram, its arrow interaction, and its layout lock already exist; this change alters their behavior.

### Modified Capabilities

- `workflow-view`: the layout lock's scope, the arrow selection available while locked, the route the selected arrow draws above the stage regions, the hover marks presented only while editing, and the keyboard focus on an arrow end that selects the arrow while locked.

## Impact

- Code: a new connection-mode policy module and a new selected-route component; the connection edge view, the affordance layer, the connection interaction contract, the connection gestures, the canvas composition, the workflow view, the condition editor, the affordance geometry, and the diagram styles.
- Specs: `workflow-view`.
- Docs: the README's workflow diagram section, including its lock and condition paragraphs.
- Tests: the browser workflow-view and workflow-connections specifications, and unit coverage for the new policy module.
- Data: none. The workflow document, its parser, every stored connection layout, the sharing merge, and every host command keep their current form.
- Compatibility: none at the document level. An installation without this change reads and writes the same workflows.
- Dependencies: none added.
