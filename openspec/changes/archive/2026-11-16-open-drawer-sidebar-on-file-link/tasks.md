# Tasks

## 1. Open fallback module

- [x] 1.1 Add `src/client/host-open-fallback.tsx` with the structural `SidebarOpenService` type (`openResource`, `openTab`, optional `openResourceIn`, `openTabIn`), an idempotent installer that wraps the two open methods as own properties, re-issues the failed open for the drawer's Session, and rethrows the original error when it cannot help, plus the disposer that deletes the wrappers. Verify `tests/client/host-open-fallback.test.tsx` covers: the original success is untouched and never falls back; a throw falls back with the drawer's Session and the same address/options; no drawer Session, a missing per-Session method, and a fallback that itself throws all rethrow the original error unchanged; a second install over the same service does not double-wrap; the disposer restores the prototype methods.
- [x] 1.2 Make installation conditional: skip when the service does not report `capabilities.embeddedPanel === true`, when either per-Session method is absent, or when assigning the wrapper throws; verify one install-time test per skipped case asserting the service is left exactly as received and no error escapes, alongside the narrowing tests.

## 2. Composition wiring

- [x] 2.1 Provide the drawer's Session to the installer from the board page state (`selectedTaskId` → `taskPageState(pageState, id).view` → `conversationOf(view)`) and install/restore it in the conversation seat that already resolves the `sidebarRight` service in `src/client.tsx`; verify a client test with a throwing fake service proves the per-Session open receives the drawer's Session and that unmounting the `HostOpenFallback` the seat renders restores the original methods, with the isolated lane covering the seat itself end to end.
- [x] 2.2 Verify the untouched paths: a fake service that resolves normally is never wrapped-into, an open with no drawer conversation never falls back, and the existing `tests/client/conversation-workspace.test.tsx` and `tests/client/conversation-surface-window.test.tsx` pass unchanged.
- [x] 2.3 Verify a transient subagent peek targets the task conversation's Session, not the peeked descendant's, with a client test over the same provider.

## 3. Isolated real-composition lane

- [x] 3.1 Extend `tests/e2e-dsh/kanban-sidebar.e2e.template.ts` with the collapsed-panel case: with the panel collapsed, activate a file reference in the drawer conversation, then assert the rail appears with the file tab and no failure dialog or retry prompt is present. Seed the reference with a message typed into the drawer composer or a hand-authored replay fixture, whichever stays deterministic without model credentials. Verify with `node scripts/e2e-dsh.mjs --checkout <built checkout containing 69b0f199> --check --only sidebar` and one real lane run, writing screenshots under `.verification/`.
- [x] 3.2 Verify the lane's existing assertions still pass against that checkout: the corner control opens the panel, shortcuts open the terminal and files pages inside the rail, a second conversation keeps its own collapsed panel, and the reload restores the shared state.

## 4. Documentation and release

- [x] 4.1 Update the README's drawer paragraph: remove "while it is collapsed the drawer claims nothing", and state that a link click opens the panel, what it covers, and the two limits (host without the per-Session open; Session without a mounted panel state).
- [x] 4.2 Update the `docs/operations.md` Drawer right Sidebar rail "Opens" bullet and the sidebar paragraph in `tests/e2e-dsh/README.md` so neither describes the collapsed-panel open as a host-owned residual gap that the lane does not assert.
- [x] 4.3 Bump `version` in `package.json` and verify `pnpm check`, `pnpm test:browser`, and `openspec validate --strict open-drawer-sidebar-on-file-link` all pass.