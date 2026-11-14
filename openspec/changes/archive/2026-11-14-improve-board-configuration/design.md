# Design

## Context

See proposal.md for motivation.

The configuration dialog is one `Modal` with six top-level sections rendered one at a time
(`src/client/settings/configuration.tsx`). `Modal` exposes three fixed sizes; only the Board section
opts into the `wide` one. The Board section is a single component that composes board identity,
project scope, the default model form, board deletion, and `WorkflowEditor`, and it lifts the
workflow draft to `Configuration` so the draft survives section switches.

The board default model already lives in the workflow root `model` mapping, is parsed by
`src/domain/workflow.ts`, persisted by `src/domain/schema-parts.ts`, compared by
`workflowMeaning`, written by `src/domain/board-model-field.ts`, and applied by the host in
`KanbanApp.createConversationNow` through `SessionModelPort`. The client presents it with a
plugin-owned combobox (`ModelPickerField`/`ModelCombobox`/`model-options`) shared with the schedule
editor. Agent presets are only chosen per conversation by the drawer cards, through the host's
`agentPresets` remote namespace; automatic conversation creation currently applies no preset.

The host's native model selector is the `conversation.input.model` slot rendered by
`ModelSelect`. Its injected face is produced by `entry.inject(sessionId)`, which resolves a real
per-session model directory and submits through `session.selectModel`. The plugin already renders
that component outside the native conversation surface in the first-execution preparation, through
`NativeSlotHost` and a deliberate face override. That machinery is the basis for reusing the same
selector in configuration.

## Goals / Non-Goals

**Goals:**

- Make configuration surfaces proportional to their content, through per-section sizing rather than a
  global modal change.
- Give each board concern its own panel and its own navigation, without losing the workflow draft
  guarantee that already exists.
- Add a board default agent preset that behaves like the board default model: a workflow root field,
  applied by the host to every new conversation, with a dismissal notice when it cannot be applied.
- Use the host's native model selector in configuration and remove the plugin copy.
- Keep every new contract in one owning module: section descriptor, panel dirty contract, model
  catalog hook, preset roster hook, synthetic model directory, session preset port.

**Non-Goals:**

- No task-level or Hub-level default preset.
- No preset change for existing conversations, and no preset inheritance into schedules.
- No custom model picker fallback when the native slot is absent.
- No widening of dialogs outside Kanban configuration.
- No refactor of the `Configuration` prop contract or the conversation notice components.
- No new runtime dependency, and no direct import of host client packages beyond the existing types.

## Decisions

### 1. Section descriptors and new modal sizes

`Configuration` stops deriving its size from the selected section's name. A section descriptor owns
`id`, `label`, `size`, and `render`, and `Configuration` maps the descriptors to tabs and panels.
Two sizes are added to `Modal`: `settings` (960px) for form sections and `settings-wide`
(`min(1320px, calc(100vw - 48px))`, 92vh) for the Board section. The existing `default`, `wide`, and
`parameters` sizes keep their current values so unrelated dialogs do not change. The responsive rule
that already collapses `wide` and `parameters` on narrow viewports also covers the new classes.

Alternative considered: override the dialog width with a configuration-local CSS class. Rejected
because `Modal` portals into the plugin root and the size enum is the established API; a local class
would duplicate the responsive rules.

### 2. Board section as a navigation container with a dirty contract

The Board section becomes five panels: General (board name), Projects (project scope), Defaults
(model and agent preset), Workflow (`WorkflowEditor`), and Danger zone (board deletion). Because the
chosen behavior is confirmation rather than preservation, panels unmount when the user leaves them.

Each panel that holds a draft reports `onDirtyChange(dirty)` to the container; the container keeps a
per-panel flag and owns the sub-tab navigation. Leaving a dirty panel shows the existing inline
confirmation pattern; canceling keeps the panel and its edits, confirming switches and lets the
unmounted panel's state go. The workflow panel is excluded: its draft is already lifted above the
panel and survives, so leaving Workflow neither asks nor discards. The container reports an aggregate
`boardDirty` to `Configuration`, which uses it together with the existing workflow-draft flag when the
user leaves the Board section or closes the dialog. The close confirmation remains one inline
confirmation with a message adapted to which drafts exist.

Panel contract:

```ts
interface BoardPanelProps {
  // Each panel reports only its own draft; the container owns navigation.
  onDirtyChange(dirty: boolean): void;
}
```

A small `usePanelDirty(dirty, onDirtyChange)` hook reports on change and clears on unmount, so no
panel needs to know about navigation. This keeps the guard data-driven and lets each panel stay a
single-concern form.

Alternatives considered: keep all panels mounted and hidden (no confirmation would be needed).
Rejected by the product decision to confirm. Lift every board draft into the container: rejected
because it turns the container into a god object and duplicates each form's validation state.

### 3. Defaults panel: one form, one guarded write

The Defaults panel composes a model choice and an agent-preset choice into one form with one Save.
A `useBoardDefaults` hook owns the draft: model mode (`host` or `specific`), model selection, and
preset identity, all seeded from the parsed workflow. Dirty is the comparison of that draft with the
stored workflow. Save composes both root-field writers and sends the existing
`board.workflow.save` command with the revision the form was opened with; the host's guarded save is
unchanged.

The draft is seeded from the board's parsed workflow, not from the catalog or roster. That is what
keeps a save from clearing a stored field it did not edit when the catalog or the roster is
unavailable. A specific model with no route disables Save and explains what is missing, mirroring the
schedule editor's existing `modelMode: 'custom'` validation.

While a workflow draft exists, the Defaults controls remain editable and Save is disabled with an
explanation and an action that navigates to Workflow. That action is an ordinary sub-tab navigation,
so the leave guard asks before discarding the Defaults draft. No write is sent and the workflow draft
is not touched.

### 4. Native model field and synthetic directory

A new `NativeModelField` renders the `conversation.input.model` slot through `NativeSlotHost` with a
complete face override. The slot's own `inject(sessionId)` is not usable for a board or a schedule,
so the override supplies every field the native component reads:

- `available: true`
- `directory`: a small observable store holding `ModelDirectoryState`, derived from the host catalog,
  the current draft selection, and the catalog's status, failures, and error. Only
  `getSnapshot`/`subscribe` are needed; the plugin does not import the host's store package.
- `load`: re-reads the catalog through the shared hook.
- `select`: resolves the form value with `onChange`, updates the store's `current` synchronously, and
  returns `{ ok: true }`. It never calls a session command.
- `resolveText`: returns the text it is given; the projected catalog does not carry badges.
- a `renderSlot` that returns `null` for the label and options children.

`NativeSlotHost` already tolerates a throwing `inject` and then applies the override, and it supplies
the host locale binding; `NativeBoundary` remains the failure boundary. The field detects the slot
with `useSlotEntries`. When the host composes no entry, the field does not render a fallback picker:
it renders the stored route read-only with a statement that the selector is unavailable, per the
product decision. When the catalog read fails, the synthetic store reports the error and the native
menu shows its own error and retry; the stored route stays visible beside the field.

Because the native component is host code and is not bundled into the plugin harness, its appearance
is verified in the real-composition lane. The plugin's tests use a stub slot entry to verify the
adapter contract: catalog-to-state projection, selection, retry, and the absent-slot readout.

The `{ slots, locale }` seat type currently named `PreparationSeat` moves to the neutral
`NativeSeat` in the native slot module, with `PreparationSeat` kept as an alias. `Configuration`
receives the same seat the board already passes to the execution preparation.

Alternative considered: restyle the plugin combobox to imitate the native two-level menu. Rejected by
the product decision to use the host component.

### 5. Shared model catalog hook

`useModelCatalog(api)` owns the catalog read, its error, and its retry, with the request-token guard
the board form already uses, so a slower earlier read cannot overwrite a newer one. The Defaults
panel and the schedule editor both use it; the schedule editor's current `active` flag does not
protect against reordered refreshes and is replaced. The execution preparation keeps its own
read-through port: it must never fail the preparation because of a catalog read.

### 6. Workflow root `agent_preset`

`Workflow` gains `agentPreset?: string`. `parseWorkflow` accepts the root key `agent_preset` and
validates nonempty text with the existing `text` helper. The persisted workflow schema gains
`agentPreset: nonempty.optional()`, and `workflowShape` includes it unconditionally, so
`workflowMeaning` and `canonicalWorkflow` both treat a preset change as a workflow change and never as
a layout change. `writeBoardAgentPresetField` uses the existing `writeRootField` by-range writer and
parses the result before returning, exactly like `writeBoardModelField`.

A composed `writeBoardDefaultsField` writes the model field and then the preset field. Each writer
rewrites only its own root field; unchanged fields render identically and are left untouched.

Alternatives considered: store the preset on the board record like project scope. Rejected because it
would need a new board field, a new command, an identity event, merge rules, and a published-layout
change; the workflow root reuses the existing guarded save, revisions, conflict detection, and
publication. A mapping instead of a scalar was rejected because only the preset identity is
meaningful and a scalar keeps the authored document simple.

### 7. Session preset port and creation receipts

`SessionPresetPort` mirrors `SessionModelPort`:

```ts
type PresetApplyReason = 'unavailable' | 'unsupported' | 'failed';
type PresetApplyOutcome =
  | { applied: true }
  | { applied: false; reason: PresetApplyReason };

interface SessionPresetPort {
  apply(sessionId: string, presetId: string): Promise<PresetApplyOutcome>;
}
```

The host adapter reads the optional `agentPresets` service, resolves the Agent through
`sessionController.resolveAgent`, and calls the registry's `select(agent, id)`. It maps
`agent-preset/not-found` and `agent-preset/invalid` to `unavailable`, an absent service to
`unsupported`, and every other refusal or thrown error to `failed`; it never rejects. The creation
receipt wraps the outcome as `ConversationPresetOutcome` by adding `requested`, and the notice
composes its copy from that identity and `reason` rather than from a host message. The port is
wired in `src/index.ts` next to the session model port.

`createConversationNow` applies the preset before the model, both while the session is blank, and
returns both outcomes on `CreatedConversation`. The preset is applied before the model because
selecting a preset recomposes the Agent and the model selection is a per-session selection applied
afterwards. The same creation path covers the execution preparation, the automatic first execution,
tools, cross-card messages, the plus action, and card starts, so one insertion point covers every
creation path. The command receipts for `conversation.create` and `task.prepareFirstExecution` carry
both outcomes; the first-execution result type carries the preset outcome like the model one.

A card start applies the board default during creation and then selects the card's preset if it
differs. When the card names the same preset, the registry's `select` observes the already-recorded
selection and returns without logging another event. A failure of that second selection leaves the
conversation on the board default preset.

Alternative considered: apply the board default only on unattended creations and let card starts pass
an explicit preset to creation. Rejected because it forks the creation contract and because the
board default should be the fallback when an explicit selection fails.

### 8. Preset fallback presentation

A new `preset-fallbacks` registry mirrors the model fallback registry per board mount, and
`ConversationPresetNotice` is a sibling of `ConversationModelNotice` in the conversation notices
module. They stay separate components and separate dismissal state, per the scope decision. The
creation receipt is the only source of the outcome; the drawer records it, and the notice is shown
while the affected conversation is open and until dismissed. The dismissal is view state, never
persisted.

`useExecutionPreparation` and `useTaskCreation` report both creation outcomes to the board's
registries.

### 9. Preset roster extraction and card marking

The roster hook and the built-in display mapping move out of `agent-preset-cards.tsx` into an
`agent-preset-roster` module. `AgentPresetCards` becomes presentational over the hook's state and
gains `defaultPresetId`. When the roster offers that identity, the card gets a `data-default`
marker, a localized "Board default" badge, and initial focus; activation is still required. The
drawer passes the board's default from `state.workflow.agentPreset`. The Defaults panel uses the same
roster hook and display helper for its list.

Card activation keeps the existing flow: create, then select the card's preset unless it is the host
default. The board default card is not special-cased; an already-applied selection is a no-op.

### 10. Board summary and authoring surfaces

`get_board_summary` with `include_workflow` returns `defaultAgentPreset: workflow.agentPreset ?? null`
next to `defaultModel`. Board tool parameter text, README, `docs/operations.md`, the workflow-architect
skill and its YAML reference describe `agent_preset` as the board default for new conversations and
stop listing agent/preset settings as unsupported root fields.

### 11. Module layout

- `src/client/settings/configuration.tsx`: section descriptors and navigation guard.
- `src/client/settings/board/board-settings.tsx`: container, sub-tabs, dirty registry.
- `src/client/settings/board/board-general-panel.tsx`, `board-projects-panel.tsx`,
  `board-defaults-panel.tsx`, `board-workflow-panel.tsx`: one concern each.
- `src/client/settings/board/board-defaults-form.tsx`, `board-model-choice.tsx`,
  `board-agent-preset-choice.tsx`, `use-board-defaults.ts`: the composed defaults form.
- `src/client/model/native-model-field.tsx`, `src/client/model/use-model-catalog.ts` (or the settings
  folder): the shared native field and catalog hook.
- `src/client/agent-preset-roster.ts`: roster hook and display mapping.
- `src/client/preset-fallbacks.tsx`: per-board preset outcome memory.
- `src/domain/board-agent-preset-field.ts`, `src/domain/board-defaults-field.ts`: root-field writers.
- `src/host/session-preset.ts`: the host port.
- Removed: `src/client/settings/model-combobox.tsx`, `model-picker-field.tsx`, `model-options.ts`.

Dependencies point inward: domain writers know only the YAML writer and parser; the host port knows
only the optional service and the Agent resolver; components receive ports through props, and the
catalog/roster hooks own their loading state.

## Risks / Trade-offs

- [The native selector's injected face and directory state are host-internal shapes] -> Keep the
  projection in one adapter module, tolerate a throwing `inject`, keep `NativeBoundary`, treat the
  absent slot as a supported state, and cover the adapter with a stub entry. A host update changes
  one file.
- [The plugin harness cannot render the host CSS module, so native appearance is unverified there] ->
  Verify behavior and the adapter in `pnpm test:browser` and the real appearance/interaction in the
  real-composition lane.
- [Confirmation-based navigation can still lose a draft if a new panel forgets to report dirty] ->
  Make `onDirtyChange` a required panel contract and test every panel's dirty transition and the
  leave/cancel paths.
- [A defaults save races the workflow editor's revision] -> Use the existing `expectedRevision`
  guarded save; a conflict leaves both drafts and shows the host problem.
- [A card-created conversation records the board preset selection and then the card selection] -> Both
  happen while the session is blank and before any turn; the registry's no-op when the identities
  match avoids an event for the common case, and the final composition is the card's.
- [A published board carrying `agent_preset` fails to parse on a plugin that predates the field] ->
  The plugin version is bumped, the update requirement is documented, and the field is optional so
  boards without it keep working everywhere.
- [Rolling back after a board stored `agent_preset`] -> Any rollback build must keep accepting the
  root field; otherwise restore the document or forward-fix. This is recorded in the migration plan.
- [Removing the plugin picker changes no public API] -> The removed modules are internal to the client
  entry and only their own tests import them.
- [The preset fallback notice needs a creation receipt the client can see] -> A conversation created by
  a cross-card message or an agent tool runs on the host default when the preset fails, but the drawer
  learns the outcome only from the receipt its own command returns, so those host-internal creations
  present no notice. The model notice has the same boundary. Closing it needs a durable
  per-conversation outcome, which this change deliberately does not add.

## Migration Plan

- No data migration: the field is optional, and an absent field keeps the host default preset.
- Bump the package version in the same change, because the installed artifact changes.
- Document that a board whose workflow stores `agent_preset` or a new model control requires an
  updated plugin to be read, and that a teammate without the preset falls back with a notice.
- Rollback: restore the previous UI and picker; keep the parser accepting `agent_preset` so boards
  that already stored it remain readable. If the parser cannot be kept, restore those workflow
  documents before rolling back.
