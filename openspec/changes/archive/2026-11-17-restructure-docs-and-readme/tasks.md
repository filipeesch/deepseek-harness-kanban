# Tasks

## 1. Scaffold and clean the tree

- [x] 1.1 Create `docs/AGENTS.md` with the audience tiers, one-home-per-fact rule, placement examples, add/move/delete flow, writing rules (English, current state, one physical line per paragraph, relative links, no test counts or machine paths, no change narration), the per-document ceiling, the test-validated-content exception, and the review checklist; verify it stays under 140 lines and names every rule the gate enforces.
- [x] 1.2 Delete the ten historical evidence artifacts under `docs/` (`active-schedule-runner-review.md`, `code-review.md`, `coordination-runner-review.md`, `lifecycle-bridge-review.md`, `lifecycle-transaction-review.md`, `native-ask-runner-review.md`, `scenario-evidence.md`, `schedule-quiescence-review.md`, `schedule-wake-review.md`, `verification-preliminary.md`, `verification-runs.json`) and verify no file named `*-review.md`, `scenario-evidence.md`, `verification-runs.json`, or `verification-preliminary.md` remains outside Git history.
- [x] 1.3 Create `docs/README.md` as the single index of maintained documents, grouping entries by audience tier and stating what each document owns; verify every entry names a file that will exist when the change closes and that no maintained document is missing from the list.

## 2. Rewrite the user tier

- [x] 2.1 Write `docs/user/getting-started.md` (first use, configuration sections, project registration, new task, drawer sections, search and filters) and `docs/user/hubs-and-boards.md` (Hub, board, project scope, defaults, board order); verify each rule traces to a spec requirement, a source module, or a test, and that no downgrade or refusal condition is dropped.
- [x] 2.2 Write `docs/user/workflows.md` (YAML authoring, groups, transitions and conditions, stage editor, workflow diagram, layout, connections, locks and undo) and `docs/user/execution.md` (entry instructions, the five-second countdown, the first-execution preparation, declared transitions, auto mode, pause and resume, failure handling); verify the workflow YAML examples parse against `src/domain/workflow.ts` and every recovery sentence matches a spec scenario.
- [x] 2.3 Write `docs/user/conversations.md` (drawer Conversations, native window, branching, subagent peek, right Sidebar, notes, history, relations) and `docs/user/agent-tools.md` (board reads and writes, workflow-design tools, notes, team files, relations, `decision_request`, `send_task_message`, `list_allowed_transitions`, `set_next_transition`, pause and resume); verify the tool table matches `PRODUCT_TOOL_NAMES` in `src/host/tools/names.ts`.
- [x] 2.4 Write `docs/user/team-sharing.md` (the four storages, Git repository, Google Drive Cloud, Google Drive Local, local folder, team files, published layout, publish and get-updates, conflict and review states, rollback limits); verify every failure and refusal condition named in the current `docs/operations.md` and README survives, and that the trust and credential statements keep their limitations.
- [x] 2.5 Write `docs/user/git-worktrees.md` (worktree notice, base-project choice, derivation and collisions, monorepo effective cwd, workspace visibility, delete and remove-worktree lifecycle) and `docs/user/schedules.md` (cron editor, occurrences, run-now, conversation reuse and archiving, model choice, limits, downgrade note); verify the downgrade and destructive-behavior statements match the specs.
- [x] 2.6 Write `docs/user/presets.md` describing the three shipped presets, their boundaries, and how a board selects them, including the read-only guarantee; verify no maintenance rule (allowlist mechanics, composition, ceilings) is copied here, since those live in `docs/development/presets.md`.
- [x] 2.7 Move `docs/scripted-steps.md` to `docs/user/scripted-steps.md`, keep its TypeScript example byte-identical to `tests/e2e-dsh/scripted/wait-ci.ts`, update the read path in `tests/distribution/script-fixtures.test.ts`, and update `package.json` `files`; verify `pnpm exec vitest run tests/distribution/script-fixtures.test.ts` passes.

## 3. Rewrite the operations tier

- [x] 3.1 Write `docs/operations/install.md` from the installation, update, pin, failure-signature, registry, Inspector, and reconcile material; verify every fact required by the `plugin-distribution` installation requirement is present (repository URL, build approval, `lib/` check, committish pin, no tarball address, no branch pin) and that the Node and DSH versions match `engines` in `package.json`.
- [x] 3.2 Write `docs/operations/recovery.md` from the failed-or-partial operations, auto-mode recovery, archive/remove/delete, team-settings recovery, metadata, rollback, and downgrade material; verify each destructive action still states its admission checks, consent, and retained artifacts.
- [x] 3.3 Write `docs/operations/boundaries.md` from the working-directory, policy, workspace, and right-Sidebar material, including the accepted limitations; verify the statements match the current source and specs rather than the outdated `docs/operations.md` prose.
- [x] 3.4 Delete `docs/operations.md` once its content is distributed, and verify no maintained document links to it.

## 4. Write the development tier

- [x] 4.1 Write `docs/development/setup.md` (clone, install, build, typecheck, vitest, browser harness, real-composition lane, and the separate TypeScript programs) so that it matches the `package.json` scripts; verify every command named exists in `scripts` or `package.json`.
- [x] 4.2 Write `docs/development/verification.md` with the isolated web-instance procedure, the smoke checklist, the validation lanes, the deterministic-model rule, the evidence policy (`.verification/`, nothing versioned), and the verification boundary; verify it absorbs both root verification sections without losing a safety rule.
- [x] 4.3 Write `docs/development/presets.md` with the preset maintenance rules moved out of the root `AGENTS.md` (bundle declaration, skill sizing, allowlist mechanics, board independence, read-only guarantee, manager boundaries, validation lanes); verify every rule from the old root body appears here and nowhere else.
- [x] 4.4 Write `docs/development/releases.md` with the release and install-address rules moved out of the root `AGENTS.md` (repository URL, Git dependency and build approval, committish pin, version bump, no tarball address); verify each rule from the old root body appears here and nowhere else.

## 5. Rebuild the root instructions and the README

- [x] 5.1 Reduce `AGENTS.md` to standing orders: Language, Workspaces, Host API deprecations, a Documentation section linking `docs/AGENTS.md`, and one-line orders for presets, releases, and verification that link `docs/development/presets.md`, `docs/development/releases.md`, and `docs/development/verification.md`; keep the irreversible safety rules in the root; verify the file is at most 60 lines and that a diff against the previous body shows every removed rule in its new home.
- [x] 5.2 Rewrite `README.md` as the landing page (what the plugin is, requirements, install from the repository URL, update, pin, source-checkout install, first use, feature map) targeting ~150 lines; verify every `docs/user/` guide is linked from the feature map and that the install procedure still satisfies `docs/operations/install.md`.
- [x] 5.3 Repoint every relative link and anchor that named a moved or deleted document across `README.md`, `AGENTS.md`, and `docs/`; verify no link still targets `docs/operations.md`, `docs/scripted-steps.md`, or a removed evidence file.

## 6. Add the documentation gate

- [x] 6.1 Add `tests/docs/links.test.ts` covering broken relative links, missing heading anchors (fenced code blocks skipped, external URLs ignored), index coverage both ways, absolute local paths, historical evidence file names, version-range claims outside `README.md` and `docs/operations/install.md` plus a manifest mismatch in those two, and the 60-line root `AGENTS.md` / 140-line `docs/AGENTS.md` ceilings; verify the test fails on a deliberately broken copy of each case and passes on the real tree.
- [x] 6.2 Run `pnpm run check` and verify both typechecks, the full vitest suite including the new gate, and the build pass.

## 7. Package and close

- [x] 7.1 Bump `version` in `package.json` from `0.36.7` to `0.36.8` and confirm `files` lists `README.md` and `docs/user/scripted-steps.md`; verify with `npm pack --dry-run` that the packed list carries both and no evidence artifact.
- [x] 7.2 Final sweep: verify `docs/README.md` lists every maintained document, no evidence artifact remains, no maintained document names a local machine path or a version that contradicts `engines`, and `git status` shows only intended documentation, test, and manifest changes.
