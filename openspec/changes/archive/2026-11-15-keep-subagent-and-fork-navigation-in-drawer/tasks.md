# Tasks

## 1. Behavior-preserving groundwork

- [x] 1.1 Extract the conversation tab strip, the creation and preset flow, and the conversation surface out of `src/client/drawer-conversations.tsx` into separate client modules, leaving the component as composition. Verify `pnpm run typecheck` and `pnpm test` pass with `tests/client/drawer-conversations.test.tsx` unchanged.
- [x] 1.2 Replace the drawer's `conversationId` and `conversationSelectionRequired` fields in `src/client/page-state.ts` with a discriminated `drawerView` union covering the selected conversation, the peek, the selection-required state, and the pending fork, and update every consumer. Verify `pnpm run typecheck` plus unit tests that cover each variant and the replacement of `resolveActiveConversation`.
- [x] 1.3 Generalize `ConversationLeaseRegistry` in `src/client/conversation-leases.ts` to acquire a typed target (Session id or subagent address) keyed by the child Session id and to release a peek explicitly. Verify new unit tests cover id acquisition, address acquisition, retry, release, and `retainOnly`.

## 2. Navigation resolver

- [x] 2.1 Create `src/client/drawer-navigation.ts` with a pure resolver that classifies a target Session as an open task conversation, a direct or nested `origin: 'subagent'` descendant, a fork of an open task conversation, or a foreign target, using the session list rows and the task's conversation ids. Verify unit tests cover root, direct child, nested child, fork, foreign, missing row, and cycle.
- [x] 2.2 Port the ownership walk and peek-target resolution from the removed peek (`git show 3ed9fb0^:src/client/conversation-navigation.ts`) into the same module instead of re-deriving the rules. Verify the ported cases from the removed test file pass as unit tests against the new module.
- [x] 2.3 Add the pure drawer-view transitions (open peek, end peek, select conversation, claim pending fork, clear claim) with the section, tab-selection, task-switch, and drawer-close resets. Verify a unit test asserts every transition, including that ending a peek returns to the active conversation and that no transition writes task state.

## 3. Navigation coordinator

- [x] 3.1 Create `src/client/drawer-navigation-coordinator.ts` with injected ports for panel selection and panel state, the session catalog (list snapshot, `refresh`, `subagentAddress`), the task snapshot (open conversations), the drawer page state, the attach command, and a reporter, plus a subscribable outcome snapshot. Verify a unit test drives fake ports and asserts the outcome and the port calls.
- [x] 3.2 Implement the same-update bounce: on a panel exit to `null` with an open drawer, resolve the target from the list row whose `retainedBy.mainView` is positive, apply the drawer outcome, and re-select the Kanban panel. Verify a unit test asserts the re-selection happens after the outcome and before any render boundary the fake panel store exposes, and that the host selection is never re-set.
- [x] 3.3 Implement fail-closed handling for an unresolved, foreign, closed-conversation, or cyclic target and for an inactive panel or absent drawer. Verify a unit test asserts no re-selection and no drawer mutation for each case.
- [x] 3.4 Implement the asynchronous fork path: when the target has no list row, refresh the session list once, re-resolve, and re-select the panel only for a fork of an open task conversation, with a generation guard and a timeout that leaves the native navigation in place. Verify unit tests cover the refresh-once rule, supersession by a later navigation, the timeout, and the refresh failure.
- [x] 3.5 Wire the coordinator at the client composition root in `src/client.tsx` and expose its outcome to the drawer through the existing page-state and subscription seams. Verify `pnpm run typecheck` and a client test that mounts the drawer with a fake outcome source.

## 4. Transient subagent peek

- [x] 4.1 Render the peeked descendant through the existing `RetainedConversation`/window adapter by acquiring its address in the lease registry, keeping the active task tab and the tab strip unchanged. Verify client tests assert the descendant's window is rendered, the tab strip still lists only task conversations, and the composer claim is respected.
- [x] 4.2 Apply the peek lifecycle: end on drawer close, task switch, top-level tab selection, section change, and an unavailable Session, releasing the retained descendant each time. Verify client tests assert the release and the return to the active conversation for each trigger.
- [x] 4.3 Keep read tracking and attention unchanged for the peek: the descendant is not acknowledged as a task conversation and `viewSession` applies only to the displayed top-level conversation. Verify a client test asserts no read acknowledgment for the peeked Session.
- [x] 4.4 Style the peek surface inside the drawer (active tab unchanged, surface fills the conversation area) without adding plugin chrome to the window. Verify `pnpm test:browser` renders the peek state in the theme fixture with the existing conversation-surface assertions.

## 5. Fork claim

- [x] 5.1 Add the client command that attaches an existing fork to a task through the host's adoption path in `src/host/conversation-adoption.ts`, returning the resulting conversation or a structured failure and remaining idempotent when the announcement already attached it. Verify host tests cover success, already-attached, directory-alignment failure, and `TASK_BUSY` retry.
- [x] 5.2 Handle the attach outcome in the coordinator: select the resulting conversation tab on success, keep the task unchanged on failure, and surface a notice with an action that opens the fork in the main chat. Verify a client test asserts the selection, the notice, and the action's call into the panel port.
- [x] 5.3 Confirm the fork paths the drawer does not claim stay native: a fork of a subagent descendant, a fork of a session no task retains, and a fork created from the window's session action. Verify unit tests for the resolver and a host test asserting such a fork is not attached by the claim.

## 6. Documentation

- [x] 6.1 Update the conversation section of `README.md` (the drawer keeps owned navigation, the peek, the branch tab, and the sidebar-claim consequence) and remove the design-assumption A7 note that states native file/fork/workspace actions are not contained in the drawer. Verify every changed statement matches the delta spec.
- [x] 6.2 Update the Kanban compatibility note with the two host behaviors the bounce depends on (`retainedBy.mainView` and the synchronous layout flush) and state that classification fails closed if they change. Verify the note names no new DSH dependency and that `engines.dsh` and the pin in `package.json` are unchanged.
- [x] 6.3 Review the shipped workflow-architect preset guidance for statements about drawer navigation and subagent/fork behavior; update only an affected reference, keeping each fact in one place. Verify no reference repeats the delta spec and the preset stays under its size ceilings.

## 7. Verification

- [x] 7.1 Extend the isolated real-composition lane `tests/e2e-dsh/kanban-native-drawer.e2e.template.ts` with a branch that keeps the board mounted, asks the host to prove and attach it, and ends with the new tab selected, driven by the committed `native-drawer.replay.override.json`. A real-composition subagent selection needs a replayed subagent turn, so the peek is covered by the plugin-owned browser harness (`tests/browser/drawer-peek.spec.ts`) and the client suite instead; the lane, its prerequisites, and screenshots under `.verification/` pass.
- [x] 7.2 Run the fast gates and record the evidence: `pnpm check` (host and client typechecks, vitest, build) and `pnpm test:browser` (plugin-owned Playwright harness). Verify both exit zero and the report names the covered scenarios.
- [x] 7.3 Confirm no task-conversation ownership fact changed: the client test `tests/client/drawer-peek.test.tsx` asserts the peeked descendant is absent from `sessionIds` and the closed-conversation list and that the peek sends no conversation command, while the unchanged host lineage suite keeps shared-worktree protection and deletion counting. Verify the client test fails if the peek is ever persisted.
