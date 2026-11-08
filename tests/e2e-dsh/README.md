# Real-composition e2e (manual before release)

These are plugin-owned scenario templates for DSH's web e2e lane. They are not run by `pnpm test` or `pnpm check`.

Prerequisites:

- An installed and built DSH checkout (`apps/web/dist` and `packages/bundle/web-app/lib` exist). The runner does not require a specific tag; it reports the checkout version and warns when it differs from the plugin's pinned SDK. Run the DSH install/build with the checkout's own toolchain before this runner; a pulled checkout alone is not enough.
- Plugin dependencies installed.

Run:

```sh
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only native-drawer
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only override
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only auto-run
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only auto-mode
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only prepare
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only project
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only background-delete
```

The runner builds the plugin, copies the templates into the DSH web test tree, runs the selected scenarios with `DSH_SNAPSHOT=replay`, and removes the copied files in `finally`. The default run includes the board, conversation, deletion, hubs, move-override, native-drawer, auto-run, auto-mode, prepare, background-delete, and project scenarios. The question scenario seeds `question-round.jsonl`; the move-override scenario cancels and confirms a restricted drawer move without a model call; the native-drawer scenario makes no model call, starts conversations from the plugin's preset cards, and its task-context scenario seeds `task-context.jsonl`. The auto-run scenario uses `auto-run.replay.override.json` for its two scripted assistant turns and drives the five-second window with Playwright's page clock installed after the board settles; it never calls a real model. The auto-mode scenario uses `auto-mode.replay.override.json`: it enables auto mode on a card, runs the instructed stage, and verifies that the completed replayed turn advances the card and dispatches the next stage instruction without a countdown, a confirmation, or a second conversation. Its workflow ends at the instructed review stage with an empty transition list, so the second replayed turn cannot advance again while the assertions run.

The prepare scenario makes no model call: it moves a card without a conversation into an instructed stage, verifies that the first-execution dialog precedes the move, chooses the base-project path and then the worktree path, confirms the first conversation is created before the countdown, and cancels the countdown before it sends. When the checkout composes DSH's native model selector, the scenario also completes the model stage before starting; otherwise that stage is absent by design.

The background-delete scenario gates native archiving from the scaffold: it confirms a deletion, proves the card is still on the board while the admitted operation waits at archiving, creates a second task from the same board, and only then releases the gate to see the deletion complete. That makes "the board stays usable during a background deletion" a deterministic assertion instead of a timing race, and it calls no model.

The project scenario registers a Git-backed project and a folder project through the project dialog, checks detection from a typed path and the absence of an embedded form, verifies that a folder project's task has no Git section or worktree notice, converts the Git project to a folder project, and reloads to confirm durability. It writes `.verification/project-management.png` and makes no model call. The native-drawer scenario verifies the public conversation window, the preset cards for the empty state and the plus action, per-conversation preset selection, the in-tab close action, and the inline native task-context row. It writes screenshots under the plugin's `.verification/` directory; never include the authenticated URL token in evidence.
