# Tasks

## 1. Domain: a stage with no destination

- [x] 1.1 Make `updateStage` accept an empty `allowedTransitions` list and render
      `allowed_transitions: []` in block and flow style, removing the field only for `null`; verify
      with new cases in `tests/domain/stage-update.test.ts` that an empty list round-trips through
      `parseWorkflow` as `[]` and not as an omitted field
- [x] 1.2 Keep the existing rejections in `updateStage` for a self target, an unknown target, and a
      duplicated target, and verify a previously rejected empty list is now accepted while those
      three still fail
- [x] 1.3 Distinguish an omitted list from an empty list in
      `src/client/stage/stage-editor-draft.ts`: `stageDraft` maps `[]` to the terminal mode,
      `draftChanged` reports a mode change in both directions, and `stagePatch` sends `[]` for the
      terminal mode; verify with `tests/client/stage-editor-draft.test.ts`
- [x] 1.4 Report a restricted draft with no destination as an inline problem that names the
      no-destinations mode instead of a generic empty-set error; verify the problem text and that no
      patch is produced
- [x] 1.5 Resolve a card's advance destination through the transition rules so a stage that authors
      no destination yields no destination, replacing the plain `nextStage` answer in
      `src/client/board-card.tsx`; verify with a test that a card in a terminal stage presents no
      advance action and a card in a restricted stage keeps today's behavior

## 2. Domain: authoring one transition rule

- [x] 2.1 Add the shared transition-rule comparison beside `transitionRule` in
      `src/domain/transition-rule.ts` and use it from the stage draft instead of its inline
      comparison; verify with unit tests covering order, condition trimming, and absent conditions
- [x] 2.2 Add a writer that changes only one destination's condition in authored workflow text,
      inserting the destination's entry when it is missing, removing the condition when the new text
      is blank, and preserving comments, quoting, key order, and the surrounding entries; verify
      with a new `tests/domain/transition-write.test.ts` over block lists, flow lists, and a comment
      between two entries
- [x] 2.3 Add one optional narrow field to `StagePatch` naming a destination and its condition,
      reject a patch that carries both that field and the whole list, and route the narrow field to
      the writer from task 2.2; verify with `tests/domain/stage-update.test.ts` and
      `tests/host/stage-command.test.ts`

## 3. Host and remote: the narrow stage patch

- [x] 3.1 Extend `StagePatch` in `src/shared/types.ts` and `stagePatchSchema` in `src/remote.ts`
      with the narrow field, keeping the strict schema; verify `pnpm typecheck` and that a patch
      carrying both transition fields is rejected by the schema
- [x] 3.2 Confirm `board.stage.update` reaches the new writer through
      `src/host/board-administration.ts` without a second command or dispatch branch; verify with a
      host test that the stored YAML changed only the named condition

## 4. Client: one workflow write port

- [x] 4.1 Add a write port module that owns the targeted revision, one write in flight at a time,
      and the order queued writes run in; verify with unit tests covering a rejected write followed
      by a successful retry, two writes queued during one in flight, and the revision each write
      targets
- [x] 4.2 Move `usePlacementSaver` onto the port, keeping its composition, its coalescing delay, its
      rebase, and its reset, and keeping its exported names; verify `tests/client/workflow-placement.test.ts`
      and `tests/host/transition-briefing-send.test.ts` are unchanged and green
- [x] 4.3 Add a transition writer hook that creates, re-points, re-owns, deletes, and rewrites one
      condition through the port, in the order the design fixes, and reports a rejected write;
      verify with unit tests over a fake port asserting the sequence of writes for each gesture

## 5. Client: the history carries transitions

- [x] 5.1 Turn the history step into a union that says whether it restores layout, transitions, or
      both, keeping the bounded, per-board, in-memory rules; verify with
      `tests/client/workflow-history.test.ts`
- [x] 5.2 Make undo and redo replay a step's writes in the fixed order, restoring a pruned connection
      layout before the transitions that draw it; verify with unit tests for a layout-only step, a
      transition-only step, and a step carrying both

## 6. Client: an authored transition is presented first

- [x] 6.1 Add a transition override layer and one function that derives the presented workflow from
      the stored workflow plus the overrides; verify with unit tests that an override wins, clears
      when the acknowledged workflow matches, and clears when another writer replaces that stage's
      transitions
- [x] 6.2 Feed the presented workflow to the graph, the scene, and the card travel so every surface
      reads one value, and clear the overrides when a write is rejected; verify
      `tests/client/workflow-scene.test.ts` and a new case covering a rejected write

## 7. Extractions

- [x] 7.1 Compose a connection's layout in one function used by both the gesture commit and the
      view's edit, removing the second composition; verify `tests/client/workflow-edge-model.test.ts`
- [x] 7.2 Extract the connection gestures from `canvas.tsx` into their own controller, leaving the
      canvas with the React Flow surface, the stage drag, and the viewport; verify
      `tests/client/connection-gesture.test.ts` and `tests/browser/workflow-view.spec.ts`
- [x] 7.3 Extract the diagram's layout state from `workflow-view.tsx` into one hook covering
      positions, sizes, connection layout, the three override layers, the saver, and the history;
      verify `tests/client/workflow-view.test.tsx` and that the component holds no layout state

## 8. Diagram: creating a connection

- [x] 8.1 Add a destination test that reports the stage under the pointer, behind a port with the
      same `data-column-id` contract the card drop uses; verify that a substituted port drives the
      gesture without a browser
- [x] 8.2 Add the pure decision that maps a release to re-anchor, re-point, re-own, or nothing, and
      assert every branch, including a release on the source stage, on a permitted destination, and
      on the empty surface
- [x] 8.3 Present a connection port while the pointer is over a stage and the lock is off, out of
      the keyboard order, and present the connection being drawn with its candidate destination;
      verify with a browser test that the port appears on hover, is not reachable by tab, and is
      absent while locked
- [x] 8.4 Create the transition on release over another stage, authoring only the drawn destination
      when the source authored none or an empty list, appending it otherwise, and store one workflow
      change in one history entry; verify with a browser test that reads the saved YAML and with the
      no-op cases producing no command
- [x] 8.5 Cancel a drawn connection with Escape or a cancelled pointer, storing nothing; verify with
      a browser test

## 9. Diagram: re-pointing a connection

- [x] 9.1 Re-point the destination when the target end is released over another stage, author the
      transition before pruning the superseded layout entry, and present the change immediately;
      verify with a browser test reading the saved YAML and the stored `connections` entry
- [x] 9.2 Move the transition's owner when the source end is released over another stage, authoring
      on the receiver before removing it from the previous source, and leaving a terminal stage
      behind when that was its only destination; verify with a browser test
- [x] 9.3 Keep a release over the end's own stage an anchor change, and a release that would author
      a self transition a no-op that stores nothing; verify with a browser test
- [x] 9.4 Keep the keyboard path anchor-only and confirm the connection end names still announce the
      connection and the end; verify `tests/client/connection-interaction.test.ts` and
      `tests/browser/workflow-view.spec.ts`

## 10. Diagram: condition mark and editor

- [x] 10.1 Present the mark on a connection that authors no condition, keep it off a conditioned
      connection and off the dashed default path, counter-scale it with the zoom, and keep it out of
      the keyboard order; verify with a browser test and an assertion that it survives a stage move
- [x] 10.2 Announce whether a connection authors a condition in each connection end's accessible
      name; verify with a browser test reading the accessible names
- [x] 10.3 Add the shared resizable multiline condition field and use it in the stage editor,
      deleting the nested condition editor and its expand action; verify
      `tests/browser/stage-editing.spec.ts` and that the deleted component is no longer imported
- [x] 10.4 Open the shared field in a popover anchored to a double-clicked connection, clamped
      inside the diagram, committing with an explicit save or Cmd/Ctrl+Enter and discarding with
      Escape, cancel, or a press outside; verify with a browser test
- [x] 10.5 Author the dashed default path's transition when its condition is saved, and store
      that promotion and the condition as one history entry; verify with a browser test that reads
      the saved YAML
- [x] 10.6 Keep the editor open with its text and show the problem inside it when the write is
      rejected; verify with a browser test against a rejecting fake API
- [x] 10.7 Keep the condition editable while the layout is locked while creation, re-pointing, and
      deletion stay refused; verify with a browser test

## 11. Diagram: selecting and deleting a connection

- [x] 11.1 Present a connection as selected when it is pressed, clear the selection when a stage or
      the empty surface is pressed, and select no stage or card; verify with a browser test
- [x] 11.2 Delete the selected connection with Delete or Backspace, removing its transition and its
      layout entry in one history entry, and offer the same action from the condition editor; verify
      with a browser test and the saved YAML
- [x] 11.3 Leave a stage that loses its last destination authoring no destination, with no outgoing
      connection drawn and no reversal to an unrestricted stage; verify with a browser test

## 12. Stage editor: the third mode

- [x] 12.1 Present the three modes, store an empty list for the no-destinations mode, and keep the
      terminal mode distinct from the unrestricted mode in the draft; verify
      `tests/browser/stage-editing.spec.ts` and `tests/client/stage-editor-draft.test.ts`
- [x] 12.2 Open a stage that authors an empty list in the no-destinations mode and save it back
      unchanged as no change; verify with a browser test
- [x] 12.3 Restore a terminal stage to the unrestricted mode and to a restricted set; verify the
      saved YAML in a browser test

## 13. Test harness and documentation

- [x] 13.1 Teach `tests/browser/fake-api.ts` the narrow stage patch and a workflow with a stage
      that authors no destination; verify every browser spec still opens the harness
- [x] 13.2 Update the README's workflow diagram and stage editing sections with authoring, the
      condition mark, the three modes, and the layout lock's scope; verify the sections name the
      behavior the specs define
- [x] 13.3 Bump `version` in `package.json` for the installed artifact

## 14. Verification

- [x] 14.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass
- [x] 14.2 Run `pnpm test:browser` and confirm the diagram, stage editing, and workflow view specs
      pass with screenshots under `.verification/`
- [x] 14.3 Run the isolated real-composition lane for the board, `node scripts/e2e-dsh.mjs --checkout
      <dsh-checkout> --check --only board`, and confirm no command outside the ones this change
      defines is sent
- [x] 14.4 Run the isolated web smoke for the connection flow against a throwaway `DSH_HOME`, and
      confirm the created connection, the condition edit, the deletion, and the terminal stage
      survive a reload
