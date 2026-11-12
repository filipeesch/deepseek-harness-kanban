# Tasks

## 1. Contract: tool descriptions

- [x] 1.1 Rewrite the `set_next_transition` description in `src/host/tools/transitions.ts` to name the three trigger sources (the user's request, the stage instruction, and an explicit cross-task request) and to state that the receiving stage's conditions still decide, that the destination must be a configured target, and that the request never moves the card; verify the registered description carries the three triggers and `pnpm vitest run tests/host/transition-tools.test.ts` passes.
- [x] 1.2 Rewrite the `send_task_message` description in `src/host/tools/messages.ts` to name the user request and the stage-instruction direction, and to state the request composition (read the target's allowed transitions, include the destination stage identifier and the reason, ask for a reply when the outcome matters); verify `pnpm vitest run tests/host/task-message-tool.test.ts` passes.

## 2. Domain: one per-origin arming predicate

- [x] 2.1 Add `advanceArmedFor(origin, workflow, task)` to `src/domain/transition-route.ts`, express `advanceArmed` through it, and keep the exported behavior unchanged; verify `pnpm vitest run tests/domain/transition-route.test.ts` passes.
- [x] 2.2 Consume the predicate in `blocked` and `requireArmed` of `src/host/advance-admission.ts` while keeping the origin-specific errors; verify `pnpm vitest run tests/host/advance-admission.test.ts tests/host/turn-advance.test.ts` passes.

## 3. Tests: composition proof

- [x] 3.1 Extend the advance-arming suite in `tests/domain/transition-route.test.ts` with `advanceArmedFor` cases for both origins, a deterministic stage, and a recording made for another stage; verify the new cases pass.
- [x] 3.2 Add `tests/host/task-message-declared-advance.test.ts`: deliver a message through a composed `InterCardMessaging` with a recording delivery port, record the target's declaration, observe `turn/end` for the target conversation, and assert the card moved with auto mode off; verify the test passes.
- [x] 3.3 Add the negative case in the same file: observe the message-started turn ending without a declaration and assert the card's stage and position are unchanged; verify the test passes.

## 4. Documentation and preset guidance

- [x] 4.1 Rewrite the authorization section of `presets/skills/kanban-workflow-design/references/coordination.md` so a stage instruction may authorize a handoff message and a routing request while task, board, note, and team-file writes stay user-only, and so a peer request is not a dependency gate, completion evidence, or authorization for any other write; verify `pnpm vitest run tests/host/workflow-architect-preset.test.ts` passes its size and local-link checks.
- [x] 4.2 Add the peer-requested variant to the agent-selected route in `presets/skills/kanban-workflow-design/references/operations.md`, including the precedence rule and its preconditions (configured transitions, no deterministic stage, no pending hold); verify the same preset test passes.
- [x] 4.3 Update `presets/skills/kanban-workflow-design/SKILL.md` only where its scope summary repeats the old rule; verify the persona stays within its size ceiling in the preset test.
- [x] 4.4 Update the README sections for `send_task_message` and `set_next_transition` with the new triggers and the request composition; verify no section contradicts the delta specs.

## 5. Verification and release

- [x] 5.1 Run `pnpm check` and confirm the host and client typechecks, vitest, and the build pass.
- [x] 5.2 Run `openspec validate legitimize-peer-transition-requests --strict` and confirm the change is valid.
- [x] 5.3 Bump `version` in `package.json` in the same change as the installed-artifact update; verify the manifest reports the new version.
- [x] 5.4 Mount the preset in an isolated DSH composition with a throwaway `DSH_HOME` and confirm the edited references load and stay within their ceilings; record the outcome without owner data or tokens.
