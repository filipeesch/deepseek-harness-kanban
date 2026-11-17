# Tasks

## 1. Workflow descriptions and compatibility

- [x] 1.1 Retain optional workflow and stage descriptions in the parser and typed projection without a 150-character parser limit; verify missing, blank, long, invalid-type, and legacy stage-description cases in domain tests.
- [x] 1.2 Migrate or compatibly reconstruct persisted normalized workflow data that omitted existing YAML descriptions without rewriting source bytes; verify old Hub, legacy migration, revision restoration, canonical comparison, and exact-digest fixtures.
- [x] 1.3 Extend workflow and stage editing, diffs, validation reports, and architect authoring guidance for descriptions while preserving unrelated YAML and script approvals; verify targeted edits, UI inputs, reports, legacy long descriptions, and explicit-write authorization.
- [x] 1.4 Include description changes in team publication, incremental journal events, replay, conflicts, and restore; verify root and stage edits, stage creation, description-only local changes, and no silent overwrite in sharing tests.
- [x] 1.5 Add and test an enforceable versioned sharing compatibility boundary for descriptions and preset metadata; verify supported peer replay, incompatible older readers/writers, and fail-closed behavior where the storage provider cannot prevent unsafe writes.

## 2. PTC operator preset and new-board default

- [x] 2.1 Inspect the pinned DSH preset composition and host APIs for supported reuse and deprecations; document the selected composition path and verify a PTC executor and expected tool catalog in isolated composition tests.
- [x] 2.2 Add the concise workflow operator preset and guidance for agentic, scripted, and instruction-free stages, requested transitions, user questions, and architect boundaries; verify persona size, packaged files, role masks, and board MCP isolation.
- [x] 2.3 Add versioned shareable board-default provenance that distinguishes new implicit operator, explicit host default, authored preset, and legacy absence; verify migration and precedence in domain and persistence tests.
- [x] 2.4 Apply the operator default at every new board creation boundary without mutating supplied YAML or its reviewed digest, and preserve explicit user choices, legacy boards, existing conversations, and missing-preset fallback; verify generated and custom YAML, dry-run and expected SHA cases.
- [x] 2.5 Update board settings and reviewed writes to display effective preset and origin and atomically persist explicit host or named choices with YAML and metadata; verify guarded writes, unchanged surrounding YAML, preset selection, unavailable roster, and other-board isolation.
- [x] 2.6 Preserve new-board default provenance in revision history, shared board publication, restore, merge, and conflict handling; verify new-to-new replay, legacy absence, imported boards, unsupported peers, and rollback safety.

## 3. Compact context and workflow summary

- [x] 3.1 Implement a pure, scoped compact summary projection with stage types, descriptions, route policies and conditions, initial stage, project scope and sharing; verify unrestricted, empty, configured and scripted routes, absent text, and unavailable state in unit tests.
- [x] 3.2 Include current task stage and auto-mode enabled, paused, or held state only when the requested board is the task's own; verify task, ordinary-chat, cross-board and stale-state cases.
- [x] 3.3 Implement the 6 KiB UTF-8 page/snapshot budget with record-boundary omission counts and authorized continuation, including oversized-record reads; verify long descriptions, conditions, complete retrieval, and no silent truncation.
- [x] 3.4 Inject the snapshot into the existing first-turn task-context message for every task preset without an initial tool call; verify first step, visible native row, independent new conversations, resume, failure, no backfill and no repeat.
- [x] 3.5 Replace get_board_summary with get_workflow_summary and adapt tool names, consumers, role allowlists, specs, documentation, and tests; verify the old tool is absent and no role gains extra workflow-authoring authority.
- [x] 3.6 Extend architect-only exact-document reading to expose effective board default and origin while retaining exact YAML and Hub revision; verify the response and non-architect tool invisibility.

## 4. Exceptional transition lifecycle

- [x] 4.1 Extend transition discovery for an explicitly requested existing destination's parameter names and descriptions without exposing code or representing it as configured; verify cross-board scope, invalid destinations, and parameterized scripted targets.
- [x] 4.2 Add an explicit exception flag and user-intent instructions to the declaration tool, retaining task ownership, reason, destination, parameter and scripted-entry guards; verify normal rejection without the flag and that no model-supplied flag is treated as proof of human intent.
- [x] 4.3 Add a narrow host port for non-deprecated originating session and open-turn identity using the pinned SDK; verify unknown or unsupported identity fails closed and no deprecated host API is newly used.
- [x] 4.4 Record and resolve the exception against the exact task entry, session, turn, source, destination and declaration identity; verify a different conversation, later turn, changed entry, replacement, cleared declaration, and stale destination cannot consume it.
- [x] 4.5 Gate admission on the originating observed completed turn and transactional revalidation; verify failure, abortion, interruption, pending user work, hold, busy state, concurrent replacement, restart, duplicate events, and both auto-mode settings.
- [x] 4.6 Preserve durable dispatch after admission, normal configured-route persistence, manual restricted-move confirmation, destination parameters and scripted approvals; verify existing regular-route regression tests and exceptional recovery tests.
- [x] 4.7 Make the multi-route stage briefing descriptive rather than a directive to declare; verify an instruction that does not request a route, one that does, all delivery paths, and independent automatic advance.

## 5. Integration, documentation, and release

- [x] 5.1 Update the architect and operator guides, product-tool references, migration and compatibility guidance, and bundle version; verify examples against the workflow parser and packaged skill paths and size ceilings.
- [x] 5.2 Run pnpm check and fix all host/client typecheck, unit-test, and build failures; record the command results without using personal data or profiles.
- [x] 5.3 If UI is changed, run pnpm test:browser and isolated light/dark appearance checks; verify defaults, description editing, task context, and host theme contrast with screenshots under .verification/.
- [x] 5.4 Run relevant isolated real-composition replay lanes against the built pinned DSH checkout, including board, conversation, auto-mode, transit, and override; verify context injection, tool masks, preset composition, exceptional turn lifetime, and manual confirmation without real model traffic.
- [x] 5.5 Review the complete diff and OpenSpec change, run openspec validate add-workflow-operator-preset --strict, and confirm no developer profile, data, or running GUI was modified by acceptance checks.
