# Tasks

Automated coverage is part of this change and follows the Verification Strategy in `design.md`. No separate testing change exists.

## 1. Domain model and persistence

- [x] 1.1 Make `Project.gitRootPath` optional and add the `GitProject` type plus `isGitProject` guard in `src/shared/types.ts`; verify `pnpm typecheck` lists every call site that must narrow before reading the Git root.
- [x] 1.2 Update the project schemas in `src/domain/schema.ts` and `src/domain/hub-schema.ts`, plus `ProjectInput` and the `project` codec in `src/remote.ts`; verify a stored Hub record carrying `gitRootPath` still parses and a record without it parses as a folder project.
- [x] 1.3 Extend `saveProject` in `src/domain/hub-operations.ts` with the conversion rules: a presence change of `gitRootPath` is allowed, a value change stays rejected while tasks reference the project, clearing the Git root discards `defaultBranch`, and a task with an unresolved context operation or a pending worktree request blocks the change; verify with a new `tests/domain/project-conversion.test.ts` covering every one of those cases in memory.
- [x] 1.4 Narrow `GitPort`, `GitAdapter`, and every worktree, branch, and policy entry point to `GitProject`, failing with `PROJECT_NOT_GIT` when the project has no Git root; verify `pnpm typecheck` and that no raw `Project` reaches a Git operation.

## 2. Host detection

- [x] 2.1 Extract the bounded host command primitive from `src/host/native.ts` (scrubbed `GIT_*` environment, prompt disabled, output cap, timeout) into a reusable host-level runner; verify the existing native suite still passes.
- [x] 2.2 Implement `DirectoryProbe`, `RepositoryProbe`, and `DefaultBranchProbe` with injected collaborators and compose them in `HostProjectProbe` in `src/host/project-probe.ts`; verify with `tests/host/project-probe.compose.test.ts` for the three outcomes, failure classification, and the full default-branch candidate order.
- [x] 2.3 Add the `ProjectProbe` port to `src/shared/ports.ts`, wire it through `createNativePorts` and `KanbanApp`, and rename `inferProject` to `detectProject` across the controller, remote, and client API; verify `pnpm typecheck` and migrate the client, browser, and bridge fakes to the new verb and three-outcome result.
- [x] 2.4 Remove `GitPort.discover` and its silent `gitRootPath = projectPath` fallback; delete the fallback cases in `tests/worktrees/git.test.ts`, remove the `discover` binding in `tests/worktrees/coordinator.test.ts`, and narrow `TestGit` while adding `TestProjectProbe` to `tests/host/helpers.ts`; verify `pnpm vitest run tests/host tests/worktrees`.
- [x] 2.5 Add `tests/host/project-probe.git.test.ts` against real repositories: repository root, monorepo subdirectory, a folder outside a repository, a missing path, a file instead of a directory, an explicit `origin/HEAD` target, and a detached HEAD without branches; verify every outcome and the suggested branch.

## 3. Save validation

- [x] 3.1 Validate repository identity in `app.project()` by probing the project path and requiring a Git-backed location whose root equals the canonical Git root, failing with `INVALID_GIT_ROOT`; verify with `tests/host/project-save.test.ts` for a valid root, a subdirectory root, a non-repository root, and an unchanged stored project on failure.
- [x] 3.2 Keep folder projects saveable without any Git invocation while preserving the existing directory and containment checks; verify a folder project saves and both conversion directions are accepted when no operation is in flight.
- [x] 3.3 Keep the existing in-flight guard reachable from the save path and surface it as a typed problem; verify a conversion is rejected while a task has an unresolved operation or a pending worktree request.
- [x] 3.4 Verify `detectProject` through `KanbanApp` reports a folder location for a directory outside any repository and a Git location with a branch suggestion inside one.

## 4. Directory picker port

- [x] 4.1 Add `DirectoryPickerPort` and a `createDirectoryPicker` factory that prefers `__DSH_DIRECTORY_PICKER__`, falls back to `uiWorkspace.pickDirectory()`, and otherwise raises a typed `DIRECTORY_PICKER_UNAVAILABLE`; verify the selection order and failure mapping with `tests/client/directory-picker.test.ts`.
- [x] 4.2 Provide the port through React context at the client composition root and remove the `pickDirectory` prop chain from `BoardView`, `Configuration`, and the settings sections; verify `pnpm typecheck` and update the client and browser tests that passed the callback directly.
- [x] 4.3 Consume the port in the General settings worktree-base-path field and report picker failures as typed problems; verify a failed pick surfaces an actionable message and keeps the current value.

## 5. Client project slice

- [x] 5.1 Split `src/client/forms.tsx`: keep task information and notes, and move the Configuration shell, General, Hub, and Board sections into `src/client/settings/`; verify `pnpm typecheck` and update the browser harness import.
- [x] 5.2 Implement pure draft helpers in `src/client/projects/project-draft.ts` that apply a detection result only to pristine fields, derive the name, and build the `project.save` payload; verify with `tests/client/project-draft.test.ts` for the autocomplete rule, the empty-Git-root payload, and the discarded default branch.
- [x] 5.3 Implement `useProjectEditor` and `ProjectEditorDialog` with draft values, per-field pristine flags, a generation guard, detection on pick and on blur, and save and cancel transitions; verify with `tests/client/project-editor.test.tsx` for open, browse, typed-path blur, pristine autocomplete, Git and folder outcomes, picker failure, save failure retaining the draft, cancel, and edit prefill.
- [x] 5.4 Build the `ProjectList` for Configuration → Projects with Git and folder indication, add, edit, and inline delete; verify with `tests/client/project-list.test.tsx` that both project kinds render, add and edit open the dialog, and delete is confirmed and unavailable for a project referenced by a task.
- [x] 5.5 Re-target `tests/client/project-race.test.tsx` to the dialog so the applicable draft-lifetime cases survive (browse, save failure, missing receipt, missing created project, cancel, edit prefill, unmount during save), and update the project selectors in `tests/client/identity.test.tsx`, `tests/client/board.test.tsx`, and `tests/client/hub-navigation.test.tsx`; verify those suites pass.

## 6. Git-conditional UI and plain checkouts

- [x] 6.1 Hide the Git section, the missing-worktree notice, and the worktree draft for folder projects; verify with `tests/client/folder-project-drawer.test.tsx` that a folder project presents Conversations, Info, and Notes only and a Git-backed project keeps all four sections.
- [x] 6.2 Show a compact plain-checkout indication for a task whose project lost its Git association while its checkout binding remains, and withhold return, removal, and attachment; verify the indication and the withheld actions in the same drawer suite.
- [x] 6.3 Add the non-Git deletion path to the worktree coordinator: archive conversations, remove the card and notes, retain the checkout directory, and report the retained path; verify with `tests/worktrees/plain-checkout.test.ts` that sessions are archived and Git removal is never called.
- [x] 6.4 Reject worktree creation, attachment, removal, and return at the command boundary for folder projects with `PROJECT_NOT_GIT`; verify the rejection happens before any Git call and leaves the task, its conversations, and its directory unchanged.

## 7. Browser appearance

- [x] 7.1 Add the `project-editor` scenario to `tests/browser/harness.tsx` and `tests/browser/project-editor-appearance.spec.ts` asserting dialog and detection-card contrast in light and dark; verify `pnpm test:browser` passes and writes a screenshot under `.verification/`.

## 8. Real-composition e2e

- [ ] 8.1 Migrate all seven `tests/e2e-dsh` templates to the project dialog, registering folder projects in `hubs`, `board-ux`, `move-override`, `auto-run`, and `native-drawer`; verify `node scripts/e2e-dsh.mjs --checkout <dsh> --check` and the affected `--only` lanes.
- [x] 8.2 Add `tests/e2e-dsh/kanban-project-management.e2e.template.ts` with `--only project` covering the registry list without an embedded form, detection from a typed path, a folder project, a Git-to-folder conversion, and the hidden Git section; register the scenario in `scripts/e2e-dsh.mjs` and document it in `tests/e2e-dsh/README.md`.
- [ ] 8.3 Run `--only project` on the pinned DSH checkout with replay and store the short report and screenshots under `.verification/`; verify no token, credential, or owner data appears in the evidence.


> Environment note: the real-composition lane cannot run on this machine because the pinned DSH checkout is missing installed dependencies (`p-limit`) and its offline install fails against the configured registry. Tasks 8.1 and 8.3 stay open until that checkout is installed with its own toolchain; the templates parse, explicitly blur the path field to trigger detection, and `--check` passes.

## 9. Documentation and validation

- [x] 9.1 Update `README.md` project registration, detection, folder-project, and worktree sections to match the implemented behavior; verify the described flows against the running surfaces.
- [x] 9.2 Run `pnpm check` and `pnpm test:browser`; verify both gates pass without touching the developer profile or live board data.
- [x] 9.3 Run `openspec validate refine-project-management`; verify the change remains valid.
