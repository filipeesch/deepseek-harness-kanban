# Real-composition e2e (manual before release)

These are plugin-owned scenario templates for DSH's web e2e lane. They are not run by `pnpm test` or `pnpm check`.

Prerequisites:

- DSH checkout at `dsh-v0.2.1-rc.2`, installed and built (`apps/web/dist` and `packages/bundle/web-app/lib` exist). Run the DSH install/build with the checkout's own toolchain before this runner; a pulled checkout alone is not enough.
- Plugin dependencies installed.

Run:

```sh
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --check
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only native-drawer
node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only override
```

The runner builds the plugin, copies the templates into the DSH web test tree, runs the selected scenarios with `DSH_SNAPSHOT=replay`, and removes the copied files in `finally`. The default run includes the board, conversation, deletion, hubs, move-override, and native-drawer scenarios. The question scenario seeds `question-round.jsonl`; the move-override scenario cancels and confirms a restricted drawer move without a model call; the native-drawer mode scenario makes no model call, its subagent peek uses the deterministic child replay fixture, and its task-context scenario seeds `task-context.jsonl`.

The native-drawer scenario verifies the hosted native session header, per-conversation mode selection, in-drawer subagent peek with breadcrumb return, and the inline native task-context row. It writes screenshots under the plugin's `.verification/` directory; never include the authenticated URL token in evidence.
