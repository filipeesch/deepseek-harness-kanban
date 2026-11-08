# Tasks

## 1. Release and dependency gate

- [ ] 1.1 Confirm the DSH release that declares `conversation.window` exists: check that the release tag contains the private-dsh commit for `expose-conversation-window` and that the built `@deepseek-ai/dsh-client-ui-conversation` Slot contract includes `conversation.window`; record the exact version.
- [x] 1.2 Check the pinned DSH source for `@deprecated` on `conversation.window`, `conversation.header`, and `conversation.content` before using them, as required by `AGENTS.md`; record the finding in the implementation notes.
- [ ] 1.3 Bump `package.json` to `0.2.0`, set `engines.dsh` and the DSH peer/dev dependency ranges to that release, and verify `pnpm install` followed by `pnpm typecheck` succeeds and the `conversation.window` Factory type is available.

## 2. Window adapter in the drawer

- [x] 2.1 Replace the body-only conversation surface with a `TaskConversationWindow` adapter that renders one `conversation.window` occurrence with `variant: 'embedded'`, no Session identity in props, and an explicit update-DSH fallback; verify with a unit test that asserts the Factory name, the variant, and the fallback notice.
- [x] 2.2 Keep read tracking and the open-failure gate in the adapter: track the displayed Session on mount and visibility change, render the existing failure report for an `error` open state while the active tab keeps the close action, and verify both paths with unit tests.
- [x] 2.3 Keep the single-composer claim in `RetainedConversation` and simplify its surface to the lease, the `SessionProvider`, and the adapter slot; verify the retention, close, and composer-refusal tests pass.
- [x] 2.4 Remove the forced `phase`/`hero`/View selection and the local `Chat` Component from the surface; verify no `conversation.content` call remains in the drawer path and the host window derives the phase.

## 3. Remove the hand-built header

- [x] 3.1 Remove the `kanban.session.header` slot declaration, registration, and `SessionHeader` component from `src/client.tsx`; verify the bridge tests assert the updated registration set and `main` children.
- [x] 3.2 Delete `src/client/native-session-header.tsx` and `src/client/native-session-actions.tsx` with their tests; verify `rg` finds no imports and `pnpm test` passes.
- [x] 3.3 Remove the host component seat: delete `mode-seat.tsx` and its tests, and remove the synthetic `useSessionRetainInfo`/`useDeveloperTools`/`useAgentPresetSeat` wiring; keep the preset data layer for the card picker (task 3.6) and verify no header-seat references remain.
- [x] 3.4 Trim the header-only traits from `native-slot-host.tsx` and `native-slot-descriptors.ts` (`before`, `owner`, `exclude`, `allowStore`, per-entry override context, `renderFactorySlot` plumbing, `selectNativeSessionHeaderEntry`, `nativeSnapshotSelectorHook`) while keeping the model seat and context-row APIs; verify the model-seat, task-context, and trimmed slot-host tests pass.
- [x] 3.5 Re-evaluate the client `inject` list after the removals; drop services with no remaining use, verify the plugin still registers and disposes in the real Cordis bridge test.
- [x] 3.6 Refactor the retained preset data layer into `agent-preset-port.ts` (filtered roster and selection) with an optional namespace source and a provider/context; wire the optional `remote.agentPresets` namespace in `src/client.tsx`; verify the port/filter tests and the client typecheck pass.
- [x] 3.7 Add the `agent-preset-cards.tsx` picker with loading, roster-error/retry, disabled/hint, and card selection states; render it in the Conversations area when the task has no open conversation; verify the picker tests and the empty-state drawer test.
- [x] 3.8 Route the plus action through the card choice: create the conversation, select the preset, open the window, and keep the cards for retry when selection fails; canceling creates nothing and selecting a tab discards the choice; verify the drawer tests.
- [x] 3.9 Update the native-drawer e2e to start the first conversation from a card and the second through the plus action; verify the recorded preset for each conversation. The selection-failure/retry path is covered by unit tests; the e2e forces only success.
- [x] 3.10 Update the older e2e templates that referenced the removed start conversation/`.kb-native-conversation`; add the shared locator-matcher setup copied by the e2e runner; verify native-drawer, background-delete, and prepare pass (deletion/auto-run/auto-mode retain pre-existing preparation/replay drift documented in `.verification/conversation-window.md`).

## 4. Remove the subagent peek

- [x] 4.1 Delete `conversation-navigation.tsx` and remove the peek state, `onPeek`, `peek`, `target`, `lineage`, and `acquirePeek` plumbing from the drawer, board, client entry, lease registry, and conversation surface; verify the lease and drawer tests pass with the reduced surface.
- [x] 4.2 Remove the peek e2e scenario and its fixture setup, plus the styles that only served the peek; verify `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only native-drawer` no longer references a peek.

## 5. Close action in the active conversation tab

- [x] 5.1 Render the close action inside the active conversation tab as a sibling of the tab selection button, without nesting interactive elements and without changing the selection when activated; verify with a unit test that the active tab exposes the close control and an inactive tab does not.
- [x] 5.2 Keep the close action disabled while a conversation command is pending and available while the body is loading or failed; verify with drawer tests and the existing close-action test.
- [x] 5.3 Update the tab-strip styles so the active-tab pill contains the title, attention dots, and close control and the close control does not inherit the tab button's text padding; verify the rendered tab at the drawer's narrow width has no horizontal overflow.

## 6. Styles and layout cleanup

- [x] 6.1 Remove `.kb-native-session-header`, `.kb-session-header-row`, `.kb-session-header-main`, `.kb-conversation-status`, and the manual conversation padding from `styles.ts`; add the window host wrapper that gives the occurrence a sized flex parent; verify the style-contract tests and `pnpm test:browser`.
- [x] 6.2 Verify the embedded window inside the drawer: header at the drawer width, no `[data-window-drag]`, the right-bar corner, and the cards at the drawer width; capture the evidence under `.verification/`. The blank first conversation makes the host hide title/tabs/actions and the docked statistics footer, so those host-owned states are not claimed by this lane.

## 7. Documentation and shared note

- [x] 7.1 Rewrite the README conversation paragraph: the drawer hosts the public native window, the blank conversation uses the host hero with the native preset picker, Views are shared with the main panel, subagent navigation follows the host, the close action lives in the active tab, and the plugin requires a DSH release that declares the window.
- [x] 7.2 Update the shared Kanban compatibility note: remove the `conversation.session.header`, header child-slot, and `conversation.hero.agentPreset` inventory rows; replace the `conversation.content` row with `conversation.window`; add the `remote.agentPresets` roster/selection dependency; update the breakage checklist and the current-state F1 entry; verify by reading the note back from the board.
- [x] 7.3 Confirm `AGENTS.md` verification steps still describe the drawer correctly (task-context row, native model selector in the first-execution preparation) and adjust only if the wording references the removed header.

## 8. Verification

- [x] 8.1 Run `pnpm check` (client/host typechecks, Vitest, build) and fix every failure.
- [x] 8.2 Run `pnpm test:browser` and confirm the browser harness and appearance contracts pass with the new styles.
- [x] 8.3 Run `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only native-drawer` against the release (or, until it exists, the built feature checkout) and confirm the window, no window drag, the right-bar corner, the preset cards (empty state and plus), the recorded preset per conversation, and the in-tab close. The blank first conversation leaves the host title/tabs/actions/utilities/statistics hidden; those host-owned states remain unexercised by this lane.
- [x] 8.4 Record the change's evidence in `.verification/` with light and dark screenshots and a short report that states which checkout and which DSH version were used; do not include tokens or owner data.
