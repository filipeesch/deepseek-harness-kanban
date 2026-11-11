# Proposal

## Why

An agent that routes a task today can only name a destination: `set_next_transition` stores a target stage and nothing else, and the task moves only if auto mode happens to be enabled. The person reading the board learns where the card went but never why, and the next stage's model starts its turn with no account of what brought it there — so a review stage that sends work back cannot say what has to change, and the reworked stage cannot tell what was wrong.

The recording is also inert unless auto mode is on. A workflow whose stages route deliberately still needs auto mode merely for the routing decision to be honoured, which conflates two settings that answer different questions: "should this task advance without me?" and "where should this turn end?".

## What Changes

- `set_next_transition` gains a required `reason` alongside the destination. A recording without a reason is rejected, and a reason longer than the accepted limit is rejected rather than truncated.
- The recording becomes the agent's declared transition for the turn, not just a routing hint: a completed turn end follows it whether or not auto mode is enabled. Auto mode keeps its meaning and its setting, and is never turned on or off by the tool. **BREAKING** for callers that record a destination without a reason.
- Clearing stays available and needs no reason: calling the tool without a destination removes the recording, which disarms the turn-end advance when auto mode is disabled and falls back to the default destination when it is enabled.
- Nothing moves during the turn. The task moves only at a completed turn end, under the same conditions that already gate the automatic advance, including the pending-user-work hold.
- **BREAKING** `set_next_transition` drops its explicit task identifier: the tool acts only on the task that owns the calling conversation, so an agent can never move a card it is not working on. `list_allowed_transitions` keeps its identifier because reading another task stays side-effect free.
- The destination stage's instruction delivery carries the reason as its own block, ordered instruction, reason, then the existing transition briefing, so the model that receives the new stage reads what it is asked to do, why it arrived, and where it can route next. A destination without an entry instruction moves without injecting the reason.
- The host's transition briefing states that the tool requires a reason and that the declared transition is followed at the end of the turn.
- The reason does not survive the move: it lives in the recording and in the delivered context message, and is discarded with the recording when the task leaves its stage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `product-tools`: the transition tool surface requires a reason to record a destination, drops the explicit task scope from `set_next_transition`, keeps clearing without a reason, and no longer describes recording as unable to influence a move.
- `kanban-board`: the recorded transition carries its reason and arms the turn-end advance independently of auto mode; the automatic advance runs for an agent-declared transition while auto mode is disabled, reports a stale recording as a pause only when auto mode is enabled, and delivers the reason with the destination instruction; the transition briefing states the required reason and the end-of-turn timing.
- `task-conversations`: the stage-instruction context message content is the entry instruction, then the declared transition's reason when one applies, then the transition briefing; the collapsed summary is unchanged.

## Impact

- **Tools**: `set_next_transition` parameter schema and result payload; the tool description and the host's transition briefing text.
- **Domain**: recorded-transition state and validation, a new bounded reason with the same trim-and-reject rules as the agent pause, and the advance-arming rule shared by both origins.
- **Host**: the turn-end observer stops ignoring a task whose auto mode is disabled but whose transition is declared; the advance admission becomes origin-agnostic; the stage-instruction delivery composes one extra block.
- **Data**: the stored recording gains a reason, so an older plugin build rejects a Hub document that holds one. Tasks are never published to a shared Hub document, so only this installation's local data is affected, and the downgrade note belongs with the existing pause note.
- **Docs**: the README and the operations guide currently state that recording never moves a task and that both tools work without auto mode; both statements change.
