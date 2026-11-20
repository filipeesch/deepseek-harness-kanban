# Tasks

## 1. Preset gate reuse

- [x] 1.1 Replace the hard-coded architect gate in `src/host/tools/index.ts` with a factory that answers whether the calling agent preset is a given id, keeping the fail-closed behavior on an unavailable projection; verify with a unit test that an unreported or throwing preset projection withholds the tool and that a matching preset declares it.
- [x] 1.2 Build the workflow architect gate from that factory and keep the existing architect tool declarations working; verify the existing architect preset tests pass unchanged.

## 2. Plan path and segment

- [x] 2.1 Add the slug rule that lowercases, collapses every run outside `[a-z0-9]` into one hyphen, trims hyphens, and refuses an empty result; verify with unit tests for a title with spaces, casing, accents, punctuation only, and an already-slugged value.
- [x] 2.2 Add the plan path resolver: it takes the conversation workspace, the segment, and a file name, validates that the name ends in `.md`, creates the directory, canonicalizes, and refuses a target outside `plans/<segment>/`; verify with unit tests for a missing directory, a `..` segment, an absolute file name, a symlinked directory, and a non-Markdown name.
- [x] 2.3 Resolve the segment from the owning card title in a task conversation and from a supplied project name otherwise, using one shared rule; verify with unit tests for both conversation kinds and for a card title that slugs to nothing while a project name is supplied.

## 3. The two tools

- [x] 3.1 Register `write_plan` as a product tool that resolves the workspace, the segment, and the path, writes through the host filesystem with a per-call policy confined to the plan directory, and reports the written path; verify with a unit test that the supplied policy root is the plan directory and that the session own sandbox mode is never consulted.
- [x] 3.2 Register `patch_plan` as a product tool that requires an existing file, applies every literal replacement exactly once, applies all or none, and reports the file path; verify with unit tests for a single replacement, several replacements, an absent file, a zero-match text, and a two-match text.
- [x] 3.3 Refuse an absent host capability instead of falling back to direct filesystem calls; verify with a unit test that a composition without the filesystem or the sandbox policy service reports an actionable problem and writes nothing.
- [x] 3.4 Add both names to `PRODUCT_TOOL_NAMES` and to the product tool definitions; verify `tests/host/product-tool-names.test.ts` passes with the updated list.

## 4. Preset wiring

- [x] 4.1 Declare both tools only for the project planner preset through the factory from 1.1; verify with a unit test that the planner preset declares them and that the host default, architect, manager, and operator presets do not.
- [x] 4.2 Add both names to the planner `preset-tools` allowlist in `cordis.patch.yml`; verify `tests/host/workflow-architect-preset.test.ts` passes with the new entries and that its file-tool write flags and read-only pin assertions are unchanged.
- [x] 4.3 Confirm the planner row still mounts no write or edit tool, still pins the session read-only, and still denies a shell write; verify with the existing preset and pin tests plus a composition assertion that the plan tools are the only write tools the planner holds.

## 5. Role guidance

- [x] 5.1 Rewrite the planner persona in `cordis.patch.yml` so it states the plan-file boundary instead of claiming the role cannot write; verify the persona stays under the bundle 4,000-character ceiling in the existing composition test.
- [x] 5.2 Update `presets/skills/kanban-project-planning/SKILL.md` to state the boundary, the two tools, the segment rule, that reading uses the host tools, and that a plan is never staged or committed; verify the file stays under the 7,000-character ceiling and the skill tests pass.

## 6. Documentation

- [x] 6.1 Update the planner section of `docs/user/presets.md` so it describes the plan-file write and drops the claim that the role has no tool that writes a file; verify the document stays within its line budget and `pnpm run check` passes.
- [x] 6.2 Update the read-only guarantee rule in `docs/development/presets.md` so it states the confined plan write instead of forbidding any write; verify `pnpm run check` passes and no document repeats the rule owned by the other.

## 7. Cleanup and final verification

- [x] 7.1 Rename `READ_ONLY_PRESET_IDS` and `createPresetReadOnlyPin` to names that state the confined-start behavior, updating the call site and the tests; verify the pin tests pass with no behavior change.
- [x] 7.2 Run `npx tsc --noEmit` for the host and client projects and verify it reports no error.
- [x] 7.3 Run the unit, integration, and browser suites and verify every lane passes; record any pre-existing failure separately rather than treating it as caused by this change.
- [x] 7.4 Walk the acceptance path once on an isolated instance: a planner conversation writes a plan, patches it, and fails a shell write, and a non-planner conversation reports both tools as unknown; verify each observation against its scenario in the delta specs.