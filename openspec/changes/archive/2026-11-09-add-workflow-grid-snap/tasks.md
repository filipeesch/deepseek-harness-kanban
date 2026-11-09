# Tasks

## 1. Snapping policy and the shared comparison

- [x] 1.1 Add `src/client/workflow-view/gestures/grid-snap.ts` with `GRID_STEP = 8`, the `SnapPolicy` type, `gridSnapPolicy(step)`, `noSnap`, and the pure `segmentOffset` helper; verify a new `tests/client/grid-snap.test.ts` covers nearest-point rounding on both axes, absolute rather than delta settling, negative coordinates, the minimum-size raise (264x140 becomes 264x144), the identity behaviour of `noSnap`, and the segment offset arithmetic.
- [x] 1.2 Add `src/domain/stage-position.ts` exporting `samePosition` and replace the local copies in `src/client/workflow-view/placement.ts`, `src/client/workflow-view/use/use-placement-saver.ts`, and `src/domain/sharing/workflow-merge.ts`; verify `pnpm test` passes and `grep -rn "function samePosition" src` reports only the domain definition.

## 2. Gestures

- [x] 2.1 Add an optional `altKey` to `PointerPosition` and make `beginStageDrag` accept `snap?: SnapPolicy`, applying it to the settled position on every move and skipping it for the rest of the gesture while Alt is held; verify `tests/client/workflow-gestures.test.ts` gains a snapped-drag case and an Alt-bypass case and still proves one commit per gesture.
- [x] 2.2 Make the stage drag cancel when the settled position equals the position the gesture started at; verify a gesture test asserts `onCancel` runs and `onCommit` does not.
- [x] 2.3 Make `beginStageResize` accept `snap?: SnapPolicy`, run `snapSize` before `clampStageSize`, and compute the existing `moved` flag from the snapped size; verify gesture tests cover a snapped size, the minimum-size raise, and a press that changes nothing cancelling instead of committing.

## 3. Canvas and stage node wiring

- [x] 3.1 Thread the resolved policy through `WorkflowCanvasProps` into the stage-drag start and the `StageCallbacks` context, and pass it to the resize gesture in `stage-node.tsx` without putting a function in node data; verify `tests/client/workflow-view.test.tsx` renders the stub canvas with the policy prop and the existing stage-node tests still pass.
- [x] 3.2 Snap the segment offset in `canvas.tsx` through the `segmentOffset` helper and cancel the commit when the previewed layout equals the current connection layout per `sameConnectionLayout`; verify the helper has unit coverage and a browser case proves a snapped segment stores a lattice line.

## 4. Preference, hook, and control stack

- [x] 4.1 Add `src/client/grid-preference.ts` with the `dsh.kanban.gridSnap` key, an on-by-default read that tolerates a missing or malformed value, and a best-effort write through the existing storage helpers; verify a new client test covers the default, a stored off, a stored on, and a malformed value.
- [x] 4.2 Add `src/client/workflow-view/use/use-grid-snap.ts` exposing `enabled`, `toggle`, and the resolved policy, and wire it in `workflow-view.tsx` so the canvas and the control stack read it; verify a jsdom view test toggles the control and observes the canvas policy change.
- [x] 4.3 Add the snapping control to `controls/view-controls.tsx` beside the layout lock with an action label, a tooltip, and `aria-pressed`, always enabled, and add its glyph to `src/client/icons.tsx`; verify the jsdom view test asserts the control is enabled while the layout is locked and that activating it stores no command.

## 5. Refactorings

- [x] 5.1 Extract `src/client/workflow-view/use/use-stage-drag.ts` from `canvas.tsx`, covering the gesture lifetime, the node preview, and the commit/cancel policy, and delete the inline controller; verify the browser lane's two-consecutive-drags case still passes and `canvas.tsx` is smaller than before the change.
- [x] 5.2 Extract `src/client/workflow-view/use/use-placement-overrides.ts` from `workflow-view.tsx`, covering the position and size overrides, their baselines, the two settling effects, the resize preview, and the reset; verify `tests/client/workflow-view.test.tsx` and the browser resize and undo cases still pass with `workflow-view.tsx` smaller than before the change.
- [x] 5.3 Split `src/client/workflow-view/placement.ts` into `auto-layout.ts` and `placement-merge.ts` and update the imports in the view and `tests/client/workflow-placement.test.ts`; verify the client suite passes and the old module no longer exists.

## 6. Browser acceptance

- [x] 6.1 Add browser cases to `tests/browser/workflow-view.spec.ts` for a snapped stage drag storing a lattice position, a snapped resize storing a lattice size, and a snapped segment storing a lattice line; verify `pnpm test:browser` passes those cases.
- [x] 6.2 Add browser cases for the Alt bypass producing an unsnapped result, a press without movement storing nothing and adding no history, and the control staying available and effective while the layout is locked; verify `pnpm test:browser` passes.
- [x] 6.3 Add a browser case that turns snapping off, reloads, and finds the preference still off, and one that proves Organize still places every stage exactly as it does with snapping on; verify `pnpm test:browser` passes.

## 7. Documentation and release

- [x] 7.1 Document grid snapping in the README's **Workflow diagram** section, updating the bottom-left control-stack sentence to list the new control, and naming the 8-unit step, the toggle, the Alt bypass, and that automatic placement is not snapped; verify the docs mention all four and the stack list includes the control.
- [x] 7.2 Bump `version` in `package.json` for the published artifact and verify `pnpm run build` succeeds.
- [x] 7.3 Run `pnpm check` and confirm the host and client typechecks, the vitest suites, and the build are green.
- [x] 7.4 Run the isolated composition lane with `node scripts/e2e-dsh.mjs --checkout /Users/filipe.esch/projects/pessoal/private-dsh --check` and confirm a throwaway `DSH_HOME` was used and no owner profile or board data was touched.
