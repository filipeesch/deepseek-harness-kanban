# Verification

## Acceptance boundary

Acceptance checks this plugin's public DSH extension-point contracts, its own product state machine, real temporary Git repositories, client integration tests, and isolated real DSH composition lanes. Native conversation, model, scheduler, and history engines remain DSH responsibilities and are not requalified here.

Acceptance uses a scripted, test-only model adapter. No real-model request is part of the acceptance path, and a real-model end-to-end conversation is not claimed.

## Fast gates

`pnpm run check` covers both TypeScript programs, the full vitest suite, the documentation gate, and the build. `pnpm run test:browser` is the separate Playwright harness. Keep both separate: the check stays portable, and the browser harness needs its own browser install. See [Setup](setup.md) for the commands.

## Composition scenarios

The manual lane selects one scenario with `--only`: `background-delete`, `board`, `conversation`, `deletion`, `hubs`, `schedules`, `override`, `native-drawer`, `sidebar`, `auto-run`, `auto-mode`, `declared`, `create-start`, `prepare`, `board-model`, `project`, `messages`, `history`, `workflow-architect`, `scripted`, `sharing`, or `transit`. Running without `--only` flattens every group.

## Isolated web instance

Do not run UI smokes against the desktop app, the owner's `~/.dsh` profile, or the owner's board and session data. Use a throwaway `DSH_HOME` and a profile cloned from the shipped web template. This is a separate test backend; it does not update or replace an existing GUI.

1. Build the current worktree with `pnpm run build`.
2. Create an isolated profile. `DSH_BIN` names the `dsh` executable: the CLI inside the DSH app bundle on macOS, or the equivalent executable on another platform.

   ```sh
   export SMOKE_HOME=$(mktemp -d)
   export DSH_BIN="/path/to/dsh"
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" kanban-smoke --from-default-profile web --dump-config
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" plugin --profile kanban-smoke add link:"$PWD"
   ```

   Verify `$SMOKE_HOME/profiles/kanban-smoke/package.json` contains `dsh-kanban` in `dsh.profile.bundles` and links to the current worktree.
3. Start the instance in a managed background job and keep the printed loopback token URL out of screenshots, logs, evidence, and chat.

   ```sh
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" kanban-smoke --no-open --port 0
   ```
4. Use Playwright from the repository. Open the token URL, choose **Continue** on the Preview Notice, and press Escape to dismiss **Get started** (do not enter credentials). Open **Kanban**.
5. Exercise the smoke checklist:
   - New task starts with an empty, required project select, including with a project filter active.
   - A drawer stage change to an instructed stage for a task that already has a conversation moves immediately, stays in the current section, and shows the cancelable five-second countdown; **Cancel** leaves the move in place and restores the card play action.
   - The card and drawer countdowns both cancel; a reload during the window sends nothing and restores the play action.
   - Unsent composer text and attachments are untouched by the timed send.
   - A task without a conversation presents the first-execution preparation before an instructed move or the card play action: it asks about the worktree when none exists, then creates the first conversation and shows the host's native model selector (the model step is absent when the host does not compose that slot), and only then moves or sends. Canceling keeps the worktree and conversation it already created and leaves the card in place.
   - A task whose worktree binding is preparing or in error does not move and does not execute from that preparation; the dialog explains that the binding must be resolved in the Git section and offers no create or continue action.
   - For a task that already has a conversation, the card play action sends the stage instruction without a dialog, leaves the stage and position unchanged, and disappears after a prompt is sent.
   - The play action is hidden without an unresolved instructed-stage entry.
   - A later instruction does not add another task-context message.
   - A new conversation receives its own first-turn context, visible as the inline native task-context row in the drawer and ordinary native Chat.
   - A delivered stage instruction appears as its own collapsed native context row whose summary names the entering stage; expanding the row shows the instruction, and no user message records it.
6. The isolated instance has no model credentials. A send fails after the pre-step with `MISSING_CREDENTIAL`; this is acceptable for UI and context-log checks, but not for model execution. Verify context injection in the isolated session log under `$SMOKE_HOME/sessions` and in the inline native task-context and stage-instruction rows.
7. Capture screenshots and a short report under `.verification/`; never include tokens, credentials, or owner data. Stop the background job and remove `$SMOKE_HOME` when finished.

The plugin claims the plugin-owned `kanban-task` message with an exclusive visible Chat Definition and delegates rendering to the host's context-row component. The row is therefore part of the native chat flow in both the drawer and ordinary native Chat; the native `kanban-task` message remains the model-facing record. A delivered stage instruction is claimed the same way: an exclusive Chat Definition over the plugin's own message source, delegating to the host's native context-row renderer with an inline fallback. Do not expect a separate overlay in the Kanban **Conversations** panel.

## Deterministic model traffic

The real-composition lane runs with replay-only model fixtures and either a committed session fixture or a hand-authored `tests/e2e-dsh/**/replay.override.json`. Never call a real model in acceptance checks, and never record against a personal profile.

## Appearance evidence

For appearance evidence, switch `page.emulateMedia({ colorScheme: 'light' | 'dark' })`, confirm the host `data-ds-dark-theme` state, assert the host theme tokens and contrast that the plugin actually renders, and store screenshots under `.verification/`.

## Evidence policy

Acceptance evidence is never committed. Screenshots, reports, raw QA JSON, and native conversation content belong in `.verification/`, which is ignored, or in Git history. A tracked document never carries a test count, run timestamp, or build fingerprint. A failed historical run is not relabelled a pass, and a time-scoped resource observation is not rewritten as current evidence.

## Host limitations

Native Files and the sandbox origin are not migrated by a working-directory change. Actual policy and confinement can deny operations. An unreadable native record prevents safe shared-target exclusion and therefore physical cleanup in that profile; that is a safe refusal, not a reason to weaken checks or repair native data.
