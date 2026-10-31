# Proposal

## Why

Submitting a question round already sends the reply immediately, but the strip stays docked above the composer until the host's heavy board snapshot reports the round as answered. That snapshot first awaits a per-conversation attention projection that reads full session inspection facts, so the user sees the message in the native transcript while the form remains in a "submitting" state. The same coupling delays enabling Submit after the agent's turn ends, and a page that arrives while the user is on Additional Notes is easy to miss.

## What Changes

- The question strip leaves the composer dock as soon as Submit is pressed. The reply is dispatched at once; if admission fails, the strip returns with the entered answers and the error.
- Submit stays gated on the agent's turn completion, but the gate is visible: the footer explains that the agent is still finishing the turn instead of showing a silent disabled button.
- When a new question page arrives while the user is on Additional Notes, the form keeps the user's position and draft and shows a notice with an action that opens the first new page.
- A session-scoped question feed becomes the authoritative source for question rounds and no longer waits on the board attention projection. Submit enablement, submit confirmation, and retirement after a normal composer reply all update through it.
- **BREAKING** `HostSnapshot.questionRounds` and `KanbanSnapshot.questionRounds` are removed. The question feed is the only transport for rounds; attention keeps using the cheap synchronous pending-question check.
- The optimistic submitted state lives in the client's question round cache so a drawer or tab remount cannot resurrect a submitted round before the feed confirms it.
- Refactor included in scope: extract a question round cache from `ClientBridge`, move submit eligibility and active-round selection into pure helpers, and consolidate duplicate submission flags into one state machine.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `structured-questions`: the panel now leaves on Submit with rollback on failure, the turn-completion gate is visible, a new page arriving on Additional Notes is surfaced with an action, and round truth is delivered by a conversation-scoped feed rather than the board snapshot.

## Impact

- Host: `KanbanController` gains a session-scoped question stream; `KanbanApp.snapshot` stops cloning question rounds; `SnapshotSchema` drops `questionRounds`.
- Client: `ClientBridge` delegates rounds to a new question round cache that owns the feed subscription, submissions, dismissals, and bootstrap; `Dock` and `QuestionForm` consume it.
- Shared: `HostSnapshot`/`KanbanSnapshot` lose `questionRounds`; fixtures and bridge tests that synthesize snapshots are updated.
- Docs/specs: `README.md`, `docs/operations.md`, and the `structured-questions` spec describe the new submit, gate, and new-page behavior.
- No change to native approvals, `userQuestions`, queue semantics, the decision ledger, or the composer path itself.
