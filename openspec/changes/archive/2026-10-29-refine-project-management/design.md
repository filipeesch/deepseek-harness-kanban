# Design

## Context

See `proposal.md` for motivation and the delta specs for the behavior contract.

Current state that shapes the approach:

- `Project` requires `gitRootPath`, and `GitPort` methods accept `Project` directly and read `project.gitRootPath` without narrowing. Every worktree and policy path assumes a repository.
- The Projects configuration section is one component that owns the registry list, the create/edit form, draft generation, revision bookkeeping, and delete confirmation in a single state bag.
- `pickDirectory` is created in the client composition root and prop-drilled through the board, configuration, and both settings surfaces. It calls only `uiWorkspace.pickDirectory()`, while the desktop app exposes a native picker through `globalThis.__DSH_DIRECTORY_PICKER__` and the host's macOS chooser is an `osascript`-spawned `NSOpenPanel`.
- `GitAdapter.discover` runs `git rev-parse --show-toplevel` through the sandboxed session executor using a placeholder `Project`, and returns `gitRootPath = projectPath` on any non-zero exit, so a denial, a non-repository, and an inspection failure are indistinguishable. No code computes a default branch.
- Hub records are validated by strict schemas with no migration layer, and `project.save` validates existing directories and containment but not repository identity.
- The sandbox policy governs agent execution; host registration actions already touch arbitrary paths through `realpath` and `stat`.

## Goals / Non-Goals

**Goals:**

- Make detection honest: three outcomes, typed failures, no substituted Git root, and a suggested default branch.
- Make folder projects first-class without weakening Git operations for Git-backed projects.
- Put creation and management in separate surfaces while keeping the registry discoverable from the board.
- Introduce narrow, injected seams: a directory-picker port, a project probe composed of single-purpose probes, and a `GitProject` type required by Git operations.
- Keep existing tasks, conversations, and cheap checkout semantics stable across a Git-association change.

**Non-Goals:**

- An in-app folder browser built on directory listing and creation primitives.
- Worktree support, branch discovery, or policy checks for folder projects.
- Reworking `hubProjectView` or configuration surfaces outside the project slice.
- Migrating persisted records; the model change is additive.
- Testing DSH-owned surfaces: the native picker and its Electron IPC, native session or model engines, and remote default-branch resolution over the network.

## Decisions

### Optional Git root plus a narrowing guard

`Project` keeps a single flat shape and gains optionality rather than a discriminator:

```ts
interface Project {
  id: string; name: string; projectPath: string;
  gitRootPath?: string;      // absent means a folder project
  defaultBranch?: string;    // meaningful only with gitRootPath
  workspaceId?: string; workspaceOwned?: boolean;
}
type GitProject = Project & { gitRootPath: string };
function isGitProject(project: Project): project is GitProject;
```

`GitPort` and every worktree, branch, and policy entry point accept `GitProject`. Callers narrow first and fail with a typed problem when the project has no Git root. The compiler becomes the guard instead of a runtime convention.

Alternatives considered:

- A discriminated union `kind: 'git' | 'folder'` is more explicit, but it changes the persisted shape and forces a defaulting migration over every stored record plus every test fixture. Rejected for this change.
- Keeping `gitRootPath` required and storing the project path for folder projects preserves the shape but re-creates the exact ambiguity that caused the silent-fallback bug. Rejected.

### Detection is its own port, composed of single-purpose probes

```ts
type ProjectLocation =
  | { kind: 'git'; projectPath: string; gitRootPath: string; defaultBranch?: string }
  | { kind: 'folder'; projectPath: string };

interface ProjectProbe { inspect(path: string): Promise<ProjectLocation> }
```

The host implementation composes three collaborators with constructor injection:

```text
HostProjectProbe
  DirectoryProbe     -> canonical path, exists, is a directory
  RepositoryProbe    -> git rev-parse --show-toplevel, containment
  DefaultBranchProbe -> ordered candidate resolution
```

Each probe has one reason to change and can be substituted in tests. `GitAdapter` keeps worktree execution only, and `discover` is removed from `GitPort`.

Alternatives considered:

- Extending `GitAdapter.discover` keeps one class, but it couples registration to worktree execution and preserves the placeholder-`Project` hack that forces a Git root before one is known. Rejected.
- A single `Probe` class with private helpers is smaller, but it mixes path, repository, and branch concerns and is harder to test in isolation. Rejected.

### Probing runs read-only outside the session sandbox

The probe runs `git` through the same bounded host spawn primitive already used for Git execution (scrubbed `GIT_*` environment, `GIT_TERMINAL_PROMPT=0`, output cap, timeout) without session confinement. Arguments are fixed by the plugin; no user text reaches argv.

Rationale: registering a project is a host action, like the `realpath`/`stat` validation already performed by `project.save`. Routing it through the session sandbox makes a policy denial indistinguishable from "not a repository", which is the failure this change removes.

Alternatives considered:

- Keeping the sandboxed executor and classifying exit codes and stderr separates the cases only partially: a denied `git` invocation and a non-repository can both surface as an opaque non-zero exit. Rejected.
- A pure filesystem walk for `.git` avoids subprocesses but must re-implement `.git` files, worktrees, `packed-refs`, and bare repositories. Rejected for correctness risk.

### Default branch is an ordered suggestion

Resolution order: `origin/HEAD` target, then local `main`, then local `master`, then the currently checked-out branch, then no suggestion. A stale or unusual `origin/HEAD` is acceptable because the value is a suggestion the user can edit.

Alternatives considered:

- `git remote show origin` resolves the true remote default but performs network I/O. Rejected.
- Current branch first would follow the checked-out feature branch, which is exactly the surprising worktree source this change removes. Rejected.

### The save is authoritative for repository identity

The app layer validates, in order: the project path is an existing directory; when a Git root is supplied, it is an existing directory that contains the project path; and the injected `ProjectProbe` reports the project path as a Git-backed location whose repository root equals the canonical Git root. Failures are typed (`INVALID_PROJECT_PATH`, `INVALID_GIT_ROOT`) and leave the stored project unchanged. Reusing the probe keeps one truth for detection and save, and lets host tests substitute a probe instead of creating a repository per save.

The domain operation stays pure and gains the conversion rules: a presence change of `gitRootPath` is allowed while a value change is not; `defaultBranch` is discarded when the Git root is absent; conversion is rejected while a task of the project has an unresolved context operation or a pending transition requesting a worktree. Detection is a UX preview and never the authority.

Alternatives considered:

- Trusting the client detection result removes the extra `git` call but lets a hand-edited Git root persist a project that fails at first use. Rejected.
- Validating only when the Git root changed loses the ability to detect a repository that disappeared. Rejected.

### A directory-picker port replaces prop drilling

```ts
interface DirectoryPickerPort { pick(): Promise<string | null> }
```

The client composition root builds it once: use `globalThis.__DSH_DIRECTORY_PICKER__` when present, otherwise `uiWorkspace.pickDirectory()`, otherwise a typed `DIRECTORY_PICKER_UNAVAILABLE`. The port is provided through React context so the configuration dialog, the project editor, and the General settings consume it without a prop chain.

Alternatives considered:

- Passing the callback through `BoardView` → `Configuration` → section components keeps today's coupling and grows with each new consumer. Rejected.
- Building an in-app browser is deferred: it is the fallback for deployments where the native picker cannot be reached, and it duplicates a surface DSH already owns.

### The configuration surface splits by responsibility

`forms.tsx` keeps task information and notes. Configuration becomes a shell plus `general-settings`, `hub-settings`, and `board-settings`. The project slice lives under `src/client/projects/`: a registry list, an editor dialog, a draft hook, and pure draft helpers.

The editor hook owns a draft state machine with per-field pristine flags: detection updates a field only while it is pristine or still equals the last detected value. The blur handler runs detection for a valid absolute path and cancels stale results with a generation token, reusing the pattern already protecting project saves from race overwrites.

Alternatives considered:

- Keeping detection inside the component keeps state close but makes the autocomplete rule untestable and easy to regress. Rejected.

### Git affordances are conditional; plain checkouts are retained

`isGitProject` drives the drawer's section list, the missing-worktree notice, and the worktree draft. A checkout whose project lost its Git root keeps its binding: conversations keep their effective directory, no Git action is offered, and the drawer shows a compact plain-checkout indication.

Deleting such a task skips Git removal, archives conversations, removes the card and notes, and reports the retained path. The worktree coordinator gains an explicit non-Git deletion path instead of failing on a missing repository.

Alternatives considered:

- Returning conversations to the project path first would require an all-idle coordinated directory change during a project save. Rejected as surprising and slow.
- Deleting the directory by recorded path would remove a directory the host cannot validate as a worktree. Rejected.

### Wire naming follows the new honesty

`kanban/inferProject` becomes `kanban/detectProject` on the remote and the client API; the old name promised an inference that ended in a fallback. The `project.save` payload carries an optional `gitRootPath`. Existing commands are otherwise unchanged.

## Verification Strategy

Verification reuses the repository's five existing lanes and their harnesses. Automated coverage is part of this change; no separate testing change is created.

| Lane | Command | Environment | Proves |
|---|---|---|---|
| Unit | `pnpm vitest run` (`tests/domain`, `tests/client/*.test.ts`) | node, in-memory | pure draft, conversion, picker-order, probe-composition, and coordinator rules |
| Host integration | `pnpm vitest run tests/host tests/worktrees` | temporary directories and real Git | detection on real repositories, save validation, plain-checkout deletion |
| Client component | `pnpm vitest run tests/client` (jsdom) | jsdom and `fakeApi` | editor dialog, registry list, drawer gating, draft lifetime |
| Browser appearance | `pnpm test:browser` | built harness and `theme-fixture` | contrast and layout in light and dark, with evidence under `.verification/` |
| Real composition | `node scripts/e2e-dsh.mjs --checkout <dsh> --only project` | pinned DSH web lane with `DSH_SNAPSHOT=replay` | dialog, detection, folder project, conversion, hidden Git section |

### Unit (in-memory)

- The pure project-draft module: pristine-only autocomplete, the empty-Git-root payload, and the derived name.
- The pure `saveProject` operation: adding or removing the Git association with tasks, discarding `defaultBranch`, the in-flight guards, and the unchanged path-change rejection.
- `HostProjectProbe` with fake collaborators: the three outcomes and the failure classification.
- `DefaultBranchProbe` with a fake runner: the full candidate order.
- The directory-picker factory: desktop source, host fallback, and typed failure.
- `WorktreeCoordinator` with fake ports: plain-checkout deletion archives sessions, never calls Git, and reports the retained path; Git requests are rejected with `PROJECT_NOT_GIT` before any Git call.

### Host integration (temporary directories and real Git)

- `ProjectProbe`: repository root, monorepo subdirectory, folder outside a repository, missing path, a file instead of a directory, an explicit `origin/HEAD` target, and a detached HEAD without branches.
- `project.save`: a valid repository root, a subdirectory Git root, a non-repository Git root, a folder project, both conversion directions, and a conversion blocked by in-flight work.
- `detectProject` through `KanbanApp`.

### Client component (jsdom)

- Editor dialog: open for a new project, browse, typed-path blur, pristine autocomplete, Git and folder outcomes, picker failure, save failure retaining the draft, cancel, and edit prefill.
- Registry list: Git and folder indication, add and edit opening the dialog, inline delete confirmation, and the in-use block.
- Drawer: the Git section and worktree notice absent for folder projects, and the plain-checkout indication with withheld actions.
- The existing draft-lifetime suite is re-targeted to the dialog rather than replaced.

### Browser appearance

A `project-editor` harness scenario asserts dialog and detection-card contrast in both host appearances and writes a screenshot under `.verification/`.

### Real composition

All seven scenario templates move to the dialog. `hubs`, `board-ux`, `move-override`, `auto-run`, and `native-drawer` register folder projects because their temporary workspace is not a repository; `conversation-ux` and `deletion` keep the repositories they already initialize. A new `--only project` scenario covers the registry list without an embedded form, detection from a typed path, a folder project, a Git-to-folder conversion, and the hidden Git section.

The native OS picker cannot be driven from the browser, so its selection order is proven in the unit lane and the e2e path uses a typed absolute path.

### Determinism

- Every Git fixture sets `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and `GIT_TERMINAL_PROMPT=0`, and initializes with an explicit `git init -b <branch>`.
- `origin/HEAD` is created explicitly with `update-ref` and `symbolic-ref`; the no-suggestion case detaches HEAD and removes local branches.
- No test performs network I/O, opens an OS dialog, calls a real model, or touches the developer profile or live board data.

### Existing-suite migration

- `TestGit` narrows to `GitProject`, drops `discover`, and `TestProjectProbe` joins the host fixture.
- The silent-fallback cases in `tests/worktrees/git.test.ts` are deleted because the behavior is removed.
- `tests/host/product-walkthrough.test.ts` PW04 is reclassified: repository identity is now checked at save.
- Client, browser, and bridge fakes rename `inferProject` to `detectProject` and carry the three-outcome result.
- The four client suites that drive the embedded form move to the dialog; the draft-lifetime cases are preserved.
- The browser harness imports the split configuration module and exposes the new scenario.

### Not covered

DSH-owned native picking and Electron IPC, real Git internals beyond the existing adapter suite, remote default-branch resolution, real model traffic, and data migration (none exists).

## Risks / Trade-offs

- **Internal desktop global** → feature-detect `__DSH_DIRECTORY_PICKER__`, fall back to the host picker, and surface a typed failure instead of throwing; if DSH removes the global, the product degrades to today's picker rather than breaking.
- **Read-only probing outside the sandbox** → fixed argv built from constants plus the canonical path, no write operations, bounded timeout and output; document the boundary so future probes do not extend it to mutations.
- **Detection cost on every pick and blur** → cancel stale results, ignore a result whose path no longer matches the field, and keep the probe to at most four `git` invocations.
- **Optional field spreads through the codebase** → narrow at the `GitPort` boundary with `GitProject` so the compiler lists every call site; never read `gitRootPath` from a raw `Project`.
- **Stale `origin/HEAD`** → the suggestion stays editable and the save does not validate the branch.
- **Rollback with folder projects present** → the previous version's schema requires `gitRootPath` and would reject such records. Document that a downgrade requires removing folder projects first, or keep the previous build until the change is accepted.
- **Plain checkout becomes invisible to Git tooling** → explicit indicator in the drawer plus a retained-path report on deletion, so the user knows the directory is now their responsibility.
- **Conversion racing with worktree work** → the domain rejects a presence change while a task has an unresolved operation or a pending worktree request; the editor surfaces that problem as a save failure and keeps the draft.
- **Existing tests encode the removed bug** → the silent-fallback cases are deleted rather than adjusted, and PW04's metadata-only assumption is reclassified so the suite cannot preserve the old behavior.
- **The e2e workspace is not a Git repository** → five templates register folder projects; the two that already initialize a repository keep the Git-backed path.
- **Test doubles could mask real Git behavior** → fakes cover composition and order only; the probe's real implementation is proven against real repositories in its own lane.

## Migration Plan

- No data migration: `gitRootPath` keeps its name and format, and stored records continue to validate because the field is only becoming optional.
- Host and client ship as one bundle, so the wire rename and the model change deploy together.
- The test-suite migration ships in the same change: fakes, PW04, the re-targeted client suites, and the seven e2e templates. `pnpm check` and `pnpm test:browser` are gates, and `--only project` runs on the pinned DSH checkout before release.
- Rollback: proceed only when no folder project exists; otherwise the previous schema rejects those Hub records. There is no destructive write in this change, so restoring the previous build with Git-backed projects intact is safe.

## Open Questions

None. The remaining details — the compact plain-checkout copy and the exact dialog spacing — do not change the specs, the approach, or the task breakdown.
