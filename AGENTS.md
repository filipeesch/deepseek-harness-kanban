# Project Instructions

## Language

- Write all specifications and OpenSpec planning artifacts in US English (`en-US`).
- Write source code, identifiers, and code comments in US English (`en-US`).

## Workspaces

- Register task worktree and session-directory workspaces hidden by default when the host exposes workspace visibility. Keep the shared base-project workspace visible.
- Hide a pre-existing worktree workspace once, at its first binding. Never hide workspaces retroactively and never re-hide one after a reader reveals hidden workspaces; startup reconciliation only repairs workspaces.
- Use the positional workspace API and keep workspaces visible on hosts without visibility support. A failed hide is reported and never blocks conversation creation.

## Kanban workflow architect preset

- Ship the `kanban-workflow-architect` preset with this bundle. Keep its stable
  role, interview, approval, language, and safety rules in `cordis.patch.yml`;
  put task-specific guidance in `presets/skills/kanban-workflow-design/` and load
  technical references only when needed. Do not turn the persona into a manual.
- Review the preset and its references whenever a change affects workflow YAML,
  product tools or their scopes, stage execution, automatic advance, task
  communication, board sharing, or preset composition. Check both newly enabled
  capabilities and removed or changed behavior against the implementation and
  installed DSH contracts; a source-only feature is not a deployed capability.
- Update the smallest relevant section in the same change. Replace obsolete
  guidance rather than appending exceptions or a change history. Keep each fact
  in one authoritative place; link to a reference instead of copying tool schemas,
  API signatures, project setup instructions, or general repository documentation.
  Explain actionable semantics and limits, not implementation trivia.
- Preserve the architect/manager boundary and existing tool authorization rules.
  Parent/child and cross-board protocols are agent conventions, not native
  dependency scheduling, permission grants, or a cross-board transaction.
- Validate the bundle declaration, packaged skill paths and links, YAML examples
  against the current parser, and preset mounting in an isolated DSH composition.
  Keep the persona under 4,000 characters and each skill/reference under 7,000
  characters, leaving room for tool-result wrappers below the 8,192-character
  pruning threshold. These are ceilings, not targets; remove repetition before
  adding text. Never use real-model traffic or the owner's profile for acceptance
  checks.

## Releases

- Document installation from the repository URL:
  `https://github.com/filipeesch/deepseek-harness-kanban`. Nothing publishes a
  build artifact any more, so the repository URL is the install address.
- Treat that address as a Git dependency: the clone carries no `lib/`, and the
  profile must allow the manifest `prepare` build for the resolved commit before
  the installed copy can load. Document the approval step and the unbuilt-clone
  failure whenever the install guidance changes, and never present an install that
  reported success as proof that the bundle activates.
- Pin a reproducible install with a committish on the same URL. `#<commit sha>` is
  the only pin that cannot move; a `#v<version>` tag exists for the versions that
  were released and is created by hand after that, so document a tag as a
  convenience and never document a branch name as a pin.
- Bump `version` in `package.json` in the pull request that changes the installed
  artifact, so the plugin manager and the profile can report which build they hold.
- Do not document `releases/latest/download/dsh-kanban.tgz` as the install address.
  The CI pipeline publishes nothing, so that asset resolves only to the last release
  published before the pipeline replaced the release workflow.

## Host API deprecations

- Before using or changing a DSH host API, check the pinned DSH source for
  `@deprecated` on the service, method, event, type, or slot.
- Prefer the documented replacement; never add a new use of a deprecated API.
- When no replacement exists, treat it as a design problem: look for an adjacent
  public hook, a local adapter, or another integration point, and record the
  chosen alternative and its trade-offs in the change design. Keep the
  deprecated use only as a temporary fallback until that alternative lands.

## Verification

### Fresh isolated web instance

Do not run UI smokes against the desktop app, the owner's `~/.dsh` profile, or the
owner's board/session data. Use a throwaway `DSH_HOME` and a profile cloned from
the shipped `web` template. This is a separate test backend; it does not update or
replace the existing GUI.

1. Build the current worktree with `pnpm run build`.
2. Create an isolated profile. The macOS bundled CLI is
   `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`;
   use the equivalent `dsh` executable on other platforms.

   ```sh
   export SMOKE_HOME=$(mktemp -d /tmp/dsh-kanban-smoke.XXXXXX)
   export DSH_BIN="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" kanban-smoke --from-default-profile web --dump-config
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" plugin --profile kanban-smoke add link:"$PWD"
   ```

   Verify `$SMOKE_HOME/profiles/kanban-smoke/package.json` contains `dsh-kanban`
   in `dsh.profile.bundles` and links to the current worktree.

3. Start the instance in a managed background job and keep the printed loopback
   token URL out of screenshots, logs, evidence, and chat.

   ```sh
   DSH_HOME="$SMOKE_HOME" "$DSH_BIN" kanban-smoke --no-open --port 0
   ```

4. Use Playwright from the repository. Open the token URL, choose **Continue** on
   the Preview Notice, and press Escape to dismiss **Get started** (do not enter
   credentials). Open **Kanban**.

5. Exercise the smoke checklist:
   - New task starts with an empty, required project select, including with a
     project filter active.
   - A drawer stage change to an instructed stage for a task that already has a
     conversation moves immediately, stays in the current section, and shows the
     cancelable five-second countdown; **Cancel** leaves the move in place and
     restores the card play action.
   - The card and drawer countdowns both cancel; a reload during the window sends
     nothing and restores the play action.
   - Unsent composer text/attachments are untouched by the timed send.
   - A task without a conversation presents the first-execution preparation
     before an instructed move or the card play action: it asks about the
     worktree when none exists, then creates the first conversation and shows
     DSH's native model selector (the model stage is absent when the host does
     not compose that slot), and only then moves or sends. Canceling keeps the
     worktree and conversation it already created and leaves the card in place.
   - A task whose worktree binding is preparing or in error does not move and
     does not execute from that preparation; the dialog explains that the
     binding must be resolved in the Git section and offers no create or
     continue action.
   - For a task that already has a conversation, the card play action sends the
     stage instruction without a dialog, leaves the stage and position
     unchanged, and disappears after a prompt is sent.
   - The play action is hidden without an unresolved instructed-stage entry.
   - A later instruction does not add another task-context message.
   - A new conversation receives its own first-turn context, visible as the
     inline native task-context row in the drawer and ordinary native Chat.
   - A delivered stage instruction appears as its own collapsed native context
     row whose summary names the entering stage; expanding the row shows the
     instruction, and no user message records it.

6. The isolated instance has no model credentials. A send fails after the
   pre-step with `MISSING_CREDENTIAL`; this is acceptable for UI and context-log
   checks, but not for model execution. Verify context injection in the isolated
   session log under `$SMOKE_HOME/sessions` and in the inline native task-context and
   stage-instruction rows.

7. Capture screenshots and a short report under `.verification/`; never include
   tokens, credentials, or owner data. Stop the background job and remove
   `$SMOKE_HOME` when finished.

The plugin claims the plugin-owned `kanban-task` message with an exclusive
visible Chat Definition and delegates rendering to the host's context-row
component. The row is therefore part of the native chat flow in both the drawer
and ordinary native Chat; the native `kanban-task` message remains the
model-facing record. A delivered stage instruction is claimed the same way: an
exclusive Chat Definition over the plugin's own message source, delegating to the
host's native context-row renderer with an inline fallback. Do not expect a separate overlay in the Kanban
**Conversations** panel.

## Validation

- Do not run acceptance or appearance checks against the developer's running DSH application, personal `$DSH_HOME`, or installed profile. Validation must leave the developer's environment untouched.
- Use the plugin-owned isolated lanes instead. `pnpm test:browser` renders the real client components with the host theme fixture (`tests/browser/theme-fixture.ts`), emulates `prefers-color-scheme`, asserts the rendered host tokens and contrast, and writes screenshots under `.verification/`.
- The real-composition lane boots `launchWebScaffold`, which creates a temporary `$DSH_HOME`, an isolated profile, and a temporary workspace: `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> [--check] [--only board|conversation|deletion|hubs|override|native-drawer|auto-run|auto-mode|prepare|project|messages|history]`. It accepts an installed and built DSH checkout without requiring a specific tag; the runner reports the checkout version and warns when it differs from the plugin's pinned DSH SDK. It requires every workspace package and dependency of that checkout to be installed and built; never substitute the developer's profile.
- Keep model traffic deterministic. The lane runs with `DSH_SNAPSHOT=replay` and either a committed session fixture or a hand-authored `tests/e2e-dsh/**/replay.override.json`. Never call a real model in acceptance checks, and never record against a personal profile.
- For appearance evidence, switch `page.emulateMedia({ colorScheme: 'light' | 'dark' })`, confirm the host `data-ds-dark-theme` state, assert the host theme tokens and contrast that the plugin actually renders, and store screenshots under `.verification/`.
- Keep the fast gates separate from the isolated lane: `pnpm check` covers host/client typechecks, vitest, and the build; `pnpm test:browser` covers the plugin-owned Playwright harness.
