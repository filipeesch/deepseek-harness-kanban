# Decision steps

A decision step is a workflow stage that stops deterministically for a person's explicit choice. It runs no agent turn and no program; the person answers through the task surface, and the host routes the card to the authored destination. It is the durable, authored form of a human gate, not a question the agent asks in conversation.

## Authored shape

```yaml
columns:
  - id: review_gate
    label: Review gate
    description: Decide how the review proceeds.
    decision:
      question: How should this review proceed?
      context: |
        Address any findings before shipping.
      options:
        - id: fix
          title: Fix in place
          description: Return to implementation and address the findings.
          to: in_progress
        - id: ship
          title: Ship it
          to: released
```

- `decision` is exclusive with `on_enter_prompt`, `allowed_transitions`, and `scripted`/`deterministic`. The stage `description` is optional context, separate from `question`.
- `question` is required (up to 2,000 characters); `context` is optional Markdown (up to 8,000).
- One to twelve options. Each has an `id` (a safe identifier up to 64 characters, unique in the stage, and the identity a recorded decision uses), a `title` (up to 200), an optional `description` Markdown (up to 2,000), and `to` naming another existing stage. Several options may share a destination.
- One option is a valid explicit confirmation.
- The option destinations are the stage's authored destinations for the diagram and the workflow summary, but they are not a default route: nothing is chosen until the person confirms.

## The surface

The task drawer presents the gate above its sections, in every section and without requiring a conversation. The question, context, and options use the same presentation as the structured-question surface. The person selects exactly one option and activates **Confirm choice**; selecting alone does not route. An optional observation (up to 776 characters, so the whole accepted observation fits the destination reason) is recorded with the choice.

The card presents the awaiting-input tint, a **Decision needed** mark, and a pending status line. A failure keeps the failure tint while the decision mark and status line remain. The card offers no advance action in a decision stage.

## The five-second window

Confirming starts a cancelable five-second countdown on the card and in the panel. The route is applied only when the window closes. Canceling, reloading, closing the application, or losing the client during the window applies nothing and records nothing; the gate is still waiting when the task is opened again. Only one window is held per task, and confirming another option replaces the previous one.

## Routing and history

The host re-reads the stage entry, the option, and its destination's stable identity before applying the choice. It refuses a stale entry, a busy task, a removed option, a retargeted option, and a destination whose stable identity changed after the person saw it, and changes nothing on a refusal. An accepted choice:

- places the card at the top of the option's destination stage;
- records a stage entry whose origin names the chosen option and carries the observation;
- dispatches the destination's entry instruction with the option title as the transition reason, including the observation and, when it fits, the option description;
- admits a scripted destination's own authorized execution, or only moves for a destination with neither an instruction nor a program.

The transition is durable: before the first placement the drain re-reads the option and its destination, so a workflow edit that removes or retargets the option refuses and records nothing; once the card was placed, only the delivery is recovered, so a later edit cannot invalidate the recorded move. A retried choice does not duplicate the stage entry, the history record, or the destination instruction.

## Routing ownership

A decision stage is the only owner of its routing. A completed turn never advances a task out of it, whether or not auto mode is enabled, and no automatic-mode pause is recorded for that hold. No agent declares the route out of the stage: `set_next_transition` refuses both an ordinary and an exceptional declaration. Every manual move out of the stage is a restricted transition and asks for the existing confirmation, including a move to a stage one of the options names. Arriving in the stage is an ordinary placement, and the gate applies immediately to a card already parked there when the configuration is saved.

The gate is a task surface, not a conversation question: it creates no question round, sends no chat message, and settles no native question or approval. The destination learns the choice through its transition reason, and the task history keeps it.

## Tools, summary, and sharing

`set_stage_decision` (workflow architect only) writes the configuration in parts, replaces the stage's other mode in the same write, clears it, and reports the changed fields. `set_stage_prompt`, `set_stage_routes`, and `set_stage_script` refuse a decision stage until the block is replaced or cleared. Renaming a stage rewrites the option destinations that named it; removing a stage drops the options that named it and refuses when the gate would be left with no option.

`get_workflow_summary` and the task's first-contact context report `type: decision`, the question, and each option's title and destination, without option descriptions. The transition tools report that the stage owns its routing and list the options as informational destinations.

The published board carries the block in a newer event format. An installation that understands an earlier format reports that board as requiring a plugin update and neither applies nor publishes over it; the layout stamp is unchanged, and a board without a decision step keeps writing the earlier format.

## Out of scope

The stage has one question and one authored choice. It does not support multiple pages, free-text or "Other" answers, per-answer notes, or an option without a destination; stopping is an authored final stage. The undo window is client-side by design and there is no undo after the route is applied.