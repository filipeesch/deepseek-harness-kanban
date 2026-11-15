# Tasks

## 1. Board feed health boundary

- [x] 1.1 Remove the health write from `unarySnapshot()` in `src/client-bridge.ts` so only the stream supervisor, a merge failure, and a feed restart write it; verify the bridge suite passes with the updated expectation and that a rejected command still propagates its own failure to the caller.
- [x] 1.2 Invert the bridge test that asserts a rejected command writes the status in `tests/bridge/bridge.test.ts`; verify the new assertion passes (rejection keeps its code, `status.error` stays null) and that a stream failure still reports and clears on the next accepted frame.
- [x] 1.3 Replace the bridge's private `problem()` with `asProblem()` from `src/client/problem.ts` and remove `connected` from `BridgeStatus`; verify `pnpm typecheck` passes and no reference to `connected` or the private `problem()` remains in `src/` or `tests/`.

## 2. Board-update status surface

- [x] 2.1 Extract the status strip into `src/client/feed-status.tsx` with its style, reading the bridge health, and mount it once on the Kanban page in `src/client.tsx`; verify `pnpm typecheck` passes and the strip renders only there.
- [x] 2.2 Remove `status` from `QuestionDockServices`, `createQuestionDockServices()`, and `QuestionDockBridge`, and delete `QuestionDockStatus`; verify the composition root passes no status and `pnpm typecheck` passes.
- [x] 2.3 Add a dock test rendering `QuestionDock` with question services only; verify the rounds error renders with its retry action, no board-update message or board retry appears, and the test fails if a status node is reintroduced.

## 3. Navigation behavior and documentation

- [x] 3.1 Pin the refusal behavior in `tests/client/drawer-navigation-coordinator.test.ts`: a Session the host refuses keeps the native navigation, records no drawer claim, and reports nothing to any surface (no console report, no board status); verify the suite passes.
- [x] 3.2 Rewrite the feed-error guidance in `docs/operations.md` to separate the board stream, a rejected command, and a question-round failure; verify no instruction sends a command or question failure to **Retry updates**.

## 4. Verification

- [x] 4.1 Run `pnpm check` (host and client typechecks, vitest, build) and verify it passes.
- [x] 4.2 Run `pnpm test:browser` and verify the status and dock browser spec passes for the light and dark host themes, writing screenshots under `.verification/`.
- [x] 4.3 Extend the isolated `native-drawer` lane with the navigation from a task conversation to an ordinary chat (committed replay fixture or hand-authored override, `DSH_SNAPSHOT=replay`), run `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only native-drawer`, and verify the ordinary chat shows no banner while the Kanban page still presents the status and its retry when the feed fails.
- [x] 4.4 Bump `version` in `package.json` for the changed installed artifact and verify `package.json` reports the new version before the gates run.
