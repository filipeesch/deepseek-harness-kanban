# Tasks

## 1. Transition data model

- [x] 1.1 Add the `TransitionRule` value object to `src/shared/types.ts` and type `Column.allowedTransitions` as a list of entries; verify `pnpm run typecheck` reports every consumer that still assumes bare identifiers.
- [x] 1.2 Add one shared transition-entry normalizer to `src/domain/yaml-fields.ts` and make `parseWorkflow` accept a bare identifier, a `{ to, when }` mapping, and a mixed list; verify the new parse tests cover all three forms, an unknown target, a duplicate target, and a blank condition.
- [x] 1.3 Accept both forms in the persisted workflow schema and normalize them through the same helper, so a Hub loaded from disk is normalized in memory; verify a stored Hub written with bare identifiers still validates and its canonical workflow equals the parsed one.
- [x] 1.4 Add `Task.recordedTransition` and the `transition-stale` pause reason to the shared types, the persisted task schema, and the pause-reason enum; verify the schema tests accept a task with and without a recording and reject an unknown pause reason.

## 2. Routing domain

- [x] 2.1 Add `src/domain/transition-route.ts` with the recorded-transition resolution and the shared destination resolution described in design decision 3; verify unit tests cover no recording, a resolved recording, a missing target stage, a target the stage no longer configures, and a stage without configured transitions.
- [x] 2.2 Make `resolveAutoAdvance` consume the shared destination resolution, stop exactly at a recorded destination, keep the crossing rule for the default path, and drop `nextConfiguredColumn`; verify the domain auto-advance tests cover a recorded destination without an instruction, a recorded destination with an instruction, and the unchanged default path.
- [x] 2.3 Expire the recording in `placeTask` when the destination stage differs from the recorded stage, and keep it for a same-stage reorder; verify a hub-operations test asserts both outcomes.

## 3. Host automatic advance

- [x] 3.1 Record the `transition-stale` pause from `AutoAdvanceCoordinator.advance` when the route reports a stale recording, and map a `TRANSITION_STALE` admission error to the same pause instead of `advance-failed`; verify the system auto-advance tests assert the pause reason, an unchanged stage, and that the task is not retried automatically.
- [x] 3.2 Re-resolve the route in `admitAutoAdvance` and compare the captured destination, rejecting an admission whose recording changed or stopped resolving; verify the admission tests cover a changed recording, a recording removed between evaluation and admission, and a successful recorded destination.

## 4. Transition briefing

- [x] 4.1 Add `src/host/stage-briefing.ts` returning no briefing below two targets and otherwise a titled list of `- <stage> — <condition>` lines plus the default rule and the tool name; verify unit tests cover zero, one, and two or more targets, a target without a condition, and a task that already recorded a transition.
- [x] 4.2 Append the briefing in `admitStageInstruction` after the resolved instruction so every send path includes it; verify host tests assert the composed message for the card run action, the timed instruction, a confirmed transition, and an automatic advance, and that a single-target stage sends the instruction alone.

## 5. Recording command and tools

- [x] 5.1 Add the `task.recordTransition` command with its domain operation, validating that the current stage configures transitions and that the target is one of them, and returning the updated task; verify hub-operations and app tests cover set, replace, clear, a non-configured stage, and a target the stage does not list.
- [x] 5.2 Add `src/host/tools/transitions.ts` registering `list_allowed_transitions` and `set_next_transition`, resolving the task from the conversation or an explicit identifier and returning the stage, targets, default, and recording; verify tool tests cover both scopes, the recording state, a rejected target, and that no call moves the task.

## 6. Client presentation

- [x] 6.1 Make the auto-mode view in `src/client/auto-mode.tsx` name the recorded destination and label the `transition-stale` pause; verify the client auto-mode tests cover an armed task with a recording, an armed task whose recording is stale, and the existing states unchanged.
- [x] 6.2 Make the drawer next-stage action resolve its destination through the shared routing function, name the recorded destination, and refuse a stale recording with the same explanation; verify client tests cover the recorded, default, and stale destinations and browser coverage for the refusal notice.
- [x] 6.3 Show the transition briefing state on the card after a recording changes without a reload; verify the browser lane renders the updated auto-mode tooltip for the recorded destination.

## 7. Documentation and release

- [x] 7.1 Document the conditioned transition form, the recorded transition, and the transition briefing in the README workflow and auto-mode sections; verify the documented YAML parses and matches the shipped parser behavior.
- [x] 7.2 Bump `version` in `package.json` for the release that changes the published artifact; verify the release workflow accepts the new version.
- [x] 7.3 Run `pnpm check`, `pnpm test:browser`, and the isolated `auto-mode` lane with `DSH_SNAPSHOT=replay`; verify no regressions and store the evidence under `.verification/`.
