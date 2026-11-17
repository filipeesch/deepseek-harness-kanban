# Tasks

## 1. Host: background worktree creation

- [x] 1.1 Add an optional background option to the `worktree.create` command and its schema, and route it through the worktree coordinator so the command returns once the operation is admitted; verify with a host test that the command resolves before Git finishes and that the task carries a `queued` create operation.
- [x] 1.2 Generalize the background admission so a create operation can be queued with its own preconditions while destructive operations keep the confirmed-binding and pending-admission guards; verify with admission tests for create and removal and by running the existing destruction and worktree suites.
- [x] 1.3 Run an admitted create on the repository lane outside the global command lane and confirm the journal publishes preflight, Git, and directory-switching progress; verify a test asserts the phases through the store and a second command completes while the checkout is pending.
- [x] 1.4 Keep creation failure handling and recovery intact for background admission, including a failed or incomplete attempt and an underivable destination; verify with the existing create-recovery tests plus a case where derivation fails at admission and no conversation is created.
- [x] 1.5 Expose a per-task settlement the agent tool can await after admitting a creation; verify with a unit test that the settlement resolves on success and rejects on failure.

## 2. Client: first-execution preparation in the background

- [x] 2.1 Narrow the preparation plan and gate to the worktree decision only, removing the model field and the model-availability check; verify with the gate tests updated to the new plan shape.
- [x] 2.2 Reduce the preparation dialog to the worktree question and the blocked-binding explanation, removing the provisioning, model, and error phases, the busy modal behavior, and the retry action; verify with the dialog tests covering question, blocked, and answer-close.
- [x] 2.3 Implement the in-memory preparation run that admits the worktree (or records the base-project choice), observes the task until the worktree is ready, creates the first conversation, and arms the countdown, abandoning without side effects when the entry changes or the board unmounts; verify with unit tests for success, failure, abandonment, and unmount.
- [x] 2.4 Rewire the move pipeline so the question precedes the move, the move is applied, and the run continues afterwards, with the countdown armed by the run instead of by the move; verify with client tests asserting the command order and the absence of a countdown before the conversation exists.
- [x] 2.5 Rewire task creation with Start execution now onto the same run, removing its use of the `task.prepareFirstExecution` command; verify with a client test that creation admits the worktree, creates the conversation when ready, and arms the countdown.
- [x] 2.6 Remove the native model seat wiring from the preparation (the seat prop chain, the session lease used only for it, and the model seat module) and remove the now-unused `task.prepareFirstExecution` command from the client host contract; verify with a typecheck and a search that no reference remains.
- [x] 2.7 Present a background creation in the card status region with creation-specific wording and keep the run action unavailable while the operation is unresolved; verify with status tests for admitting, creating, preparing the conversation, and failed states.

## 3. Host: agent tool creation

- [x] 3.1 Rewire the tool creation path to admit the background worktree, wait for it, then create the conversation and dispatch the instruction, keeping the reported first-execution outcome; verify with the tool tests for sent, not-applicable, and failed outcomes.
- [x] 3.2 Keep the tool's wait outside the global command lane while creation, conversation, and dispatch stay in it; verify with a test that an unrelated command completes while the tool is waiting.

## 4. Documentation

- [x] 4.1 Update the execution, worktrees, and getting-started guides to the new preparation order, the background creation, the reload behavior, and the removal of the preparation's model step; verify with the documentation link and content gate.

## 5. Verification

- [x] 5.1 Update the browser and end-to-end templates that wait for the removed preparation model step and run the plugin-owned browser suite; verify the preparation, move-override, board-model, auto-run, auto-mode, and declared-transition scenarios pass with the new flow.
- [x] 5.2 Run the fast gate and confirm the host and client typechecks, unit tests, and build pass.
- [x] 5.3 Run the isolated real-composition lane for the preparation scenarios with replay-only model traffic and confirm a card moves before the checkout finishes and the countdown arms once the conversation exists; store evidence under `.verification/`.
- [x] 5.4 Re-run the isolated smoke checklist point for a task without a conversation, confirming the preparation asks the worktree question, the card moves after the answer, the failure path reports on the card, and a reload leaves the worktree without creating a conversation or sending an instruction.
