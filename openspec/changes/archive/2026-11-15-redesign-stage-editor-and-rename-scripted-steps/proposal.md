# Proposal

## Why

The stage editor stacks every control of a stage in a single 680px dialog. Measured in the shipped harness, an agent stage fills 704px of pinned content, but a scripted stage fills 1374px inside an 830px viewport, so the author scrolls through nested fieldsets while the save actions leave the view. The two things an author actually writes — the entry instruction and the program — receive the smallest surfaces in the dialog: a 98px and a 150px textarea. The overlay reads as a column, not as an editor.

The same surface carries two problems of vocabulary and trust. The product calls the capability "deterministic" in the interface, the workflow key and the code, while the product tools and most of the prose already say "script" (`set_stage_script`, `test_script`, `get_script_execution`). And the trust model charges the author a review of the program they just wrote themselves: only an explicit approval action authorizes execution, so every hand edit of an inline program ends in a second decision about the same bytes.

## What Changes

- **Tabbed stage editor.** The editor becomes one wide, fixed-size overlay with five tabs — Stage, Execution, Routing, Inputs, Approval — each owning one authoring concern. A stage without a program presents three of them; the program-only tabs appear when the stage is scripted. The tab row and the action footer stay in place and only the active tab's panel scrolls.
- **A real program surface.** The program is edited in CodeMirror with syntax highlighting, line numbers, search, and a resizable surface, reusing the Bash and TypeScript mapping the review already uses.
- **Validation that survives tabs.** A tab whose fields hold a problem is marked, and a refused save moves the author to the first tab that holds one, so a hidden problem never reads as a silent refusal.
- **Entry-point targeting.** The overlay opens on Stage, a connection in the diagram opens it on Routing, and a card's script panel opens it on Execution.
- **Automatic author approval (BREAKING).** Saving an inline program from the stage editor authorizes that executable version, because the author is the reviewer. Review stays mandatory for an external file source, for tool-originated writes, for a workflow received from the team, for publishing, and for a revision replay; a revert never inherits trust. Each approval records where it came from and the editor presents that origin.
- **The `scripted` rename (BREAKING).** `deterministic step` becomes `scripted step` everywhere: interface copy, the authored workflow key, client and host identifiers, module and file names, the specification capability, the documentation, the preset references, and the execution token. A stored `deterministic:` key stays readable and is migrated per stage as that stage is written, so no stored or published workflow stops loading.
- **Two extractions.** The editor's validation vocabulary collapses into one problem model with one inline renderer, and the post-save notice plus the stored-version query leave the dialog as their own unit.

## Capabilities

### New Capabilities

None. Every behavior below belongs to a capability this project already declares.

### Modified Capabilities

- `stage-editing`: the editor becomes a tabbed, fixed-size surface; it gains tab navigation, tab-scoped validation feedback, entry-point targeting, and the author-save approval rule with the approval origin shown in the Approval tab.
- `scripted-steps` (renamed from `deterministic-steps`): the stage definition is authored under the `scripted:` key with the legacy `deterministic:` spelling accepted on read; approval is granted by the author's own editor save for an inline program and never by a file source, a tool write, a shared update, publishing, or a replay; each approval carries a recorded origin.
- `workflow-authoring`: a structured write emits the `scripted:` key for the stage it writes, leaves the authored spelling of every stage it does not write untouched, and exposes the new spelling in its field-scoped edit vocabulary.

## Impact

- **Client**: the stage editor is rebuilt around a tab shell, a tab-aware `Tabs` primitive, a shared editable code surface, and a single inline problem renderer; the board and the workflow diagram supply the entry tab they open.
- **Host**: the stage write command decides whether a save is an author save and records that decision, so automatic approval happens at the command boundary rather than inside the shared stage-update function that the agent tools and the revision journal also call.
- **Domain**: the workflow parser and writer accept both key spellings and emit the new one; the workflow-edit field vocabulary and the YAML diagnostics follow the same alias; canonical equality and fingerprinting are unchanged, so an unchanged program keeps its approved fingerprint.
- **Data**: stored boards keep `deterministic:` until the stage that authors it is written; nothing is rewritten in bulk and a published workflow keeps loading. Approvals recorded before this change keep applying to the same fingerprint.
- **Rename**: 68 files and roughly 4050 identifiers, 13 specification files, the documentation set, the README, three preset references, and the `DSH_DETERMINISTIC_RUN` execution token, which the guard accepts under both names for one release so a cleanup proof is not lost across an upgrade.
- **Native runtime**: the guard reads the renamed token while still sweeping executions started before the upgrade.
- **Tests**: the browser and client suites and the real-composition templates navigate the editor by tab and seed the new key spelling.