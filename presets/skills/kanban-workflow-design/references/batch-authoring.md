# Batch Authoring

Use `preview_workflow_batch` when one change touches more than one authored surface — an agent definition, the stage that binds it, that stage's instruction, its routes, and the layout — and `apply_workflow_batch` to save exactly what you reviewed. A focused tool remains right for one isolated edit; `edit_board_yaml` remains right for a span no structured operation covers.

## Ask first when an answer changes the design

Reuse what the board, the repositories, and the conversation already establish. Ask a short, adaptive `decision_request` batch only while an unresolved answer would change the goal, the stage ownership, or the completion criteria. Do not repeat settled answers, and do not pad a batch to look thorough. An answer settles a choice; it is not permission to write. Dismissal or skipping is not an answer.

## Compose one candidate

1. Read the exact document and its revision with `get_board_yaml`, and the stages you will change with `get_stage`.
2. Send the ordered operations. Each operation sees the result of the previous one, so add an agent before binding it and clear a binding before removing its agent. The supported operations are `set_agent`, `remove_agent`, `set_stage_agent`, `set_stage_prompt`, `set_stage_routes`, and `set_layout`; each keeps the rules, destination checks, and byte preservation of its focused counterpart.
3. A failing operation names its index and the preview returns no handle. Fix the batch and preview again; nothing was stored.

The preview persists nothing. It returns the exact candidate YAML, the textual diff from the exact base, the SHA-256 of the candidate bytes, the Hub revision the base was read at, the validation report, and an impact report.

## Review before asking for approval

- Read the candidate and the diff, not only the report. The report names changed stages and fields; the diff shows the authored text.
- `report.problems` are errors that make the candidate inapplicable; `report.warnings` are advisory. An unavailable preset or model the host reports is a warning, and a roster that cannot be inspected is neither proof of availability nor of absence.
- `impact.changedStages` names stages the candidate changes; `impact.changedAgents` names agent definitions it adds, changes, or removes.
- `impact.cards` lists cards by identity only, under the engine's own routing rules compared before and after. `route-stale` is an ordinary declaration that stops resolving, including when a removed transition list leaves manual moves unrestricted: a declaration needs a configured list. A declaration that was already stale, an exceptional recording, and a scripted entry are not blamed on the batch. `admitted-advance` is an advance the engine already admitted whose destination or instruction the candidate affects, and whose placement permission still holds; permitted placement is not proof of delivery, because a decision, parameter, admission, or busy check can still refuse it. `placement-blocked` is an admitted advance the candidate would make the engine refuse when it places the card, because the route permission is checked again at placement unless the advance carries the stored override or the card already stands at the destination. The report's `affectedCards` uses the same basis, so a card is never listed in one field and cleared in the other.
- `report.scripts` is the reviewed authorization of each scripted stage, from the same snapshot. `scriptAuthorizationInspected: false` means the host could not inspect it — an installed projection without a scripted runtime included — and a stage it cannot check is listed as unverifiable rather than omitted. Retargeting a named exit can revoke an approval the person gave, so show it before asking.
- A first response stays below the tool-result budget. When the reviewed report or impact cannot fit, it trims the listed material, keeps the true counts and omission fields, and sets `reportTruncated` or `impactTruncated`. Read the complete reviewed report or impact from the same preview with `part: report` or `part: impact`, starting at offset 0 and following `nextOffset`; `reportCharacters` and `impactCharacters` give each size.
- Read the candidate or diff again through the same preview with `preview_id`, `part`, `offset`, and `limit`; offsets are characters, every page ends on a character boundary, and concatenating each page from its `nextOffset` reproduces the exact bytes, including one very long line. Never substitute the live board for the preview.
- Measure layout on the returned candidate with `layout_metrics`, including a synthetic card count per stage, to check that the drawing still holds at the size the board will carry.

Then state what you inspected, what you validated, and what you exercised. A valid candidate, a clean layout, and a reported roster prove configuration, not that a stage will run or that an agent will follow an instruction.

## Distinguish three kinds of rule

- Engine-enforced: routing permission, decision gates, orphaned cards, revision checks, scripted exits. These refuse a write or stop an advance.
- Card configuration: agents, stage instructions, routes, layout, automation mode. These are what an authored change edits.
- Agent instructions: prose that asks an agent to declare a route or report a result. Nothing enforces it; an agent can ignore it, and a stage can advance by default.

Say which kind a claim belongs to. Never present prose as enforcement.

## Ask for approval, then apply

Present the candidate change and its impacts in your own words and obtain explicit approval for it. A preview handle is not approval, and an earlier approval does not cover a changed candidate.

`apply_workflow_batch` takes only the preview handle and the candidate digest. It stores exactly the previewed bytes in one local change, refuses a stale Hub revision or a mismatched digest without saving or rebasing, and returns the stored digest and revision with `verified: true` when the stored bytes match. The receipt names its own commit: `committedRevision` is the revision that write reached, and `currentHubRevision` may be later when another write landed after it. Publishing stays a separate manual action.

When the apply reports a stale preview, the base changed after the review: preview again, review the new candidate and its impacts, and ask again. Never retry the same handle expecting a rebase.

## Keep the boundary

Do not widen a preset's tool allowlist to compensate for a missing capability, and do not reproduce a write through shell commands, direct API calls, or storage edits. If the role cannot do something, say so and offer the step the person can take.
