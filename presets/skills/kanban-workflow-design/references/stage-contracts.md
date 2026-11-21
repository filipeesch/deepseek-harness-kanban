# Stage contracts: description, condition, instruction

Load when you author or review the text of a stage. Each authored text has one job, and a fact lives in one place.

## The three texts

- **Description (at most 300 characters):** the stage's responsibility, the work it owns, written for the agent that reads it. The operator decides which stage owns a piece of work from the descriptions, so say what the stage does and what it hands on; do not summarize the instruction.
- **Transition `when`:** the exit condition, the evidence that makes this destination right. Give every destination of a stage with two or more a condition. The runtime never evaluates it; the agent reads it. A scripted stage's named exits have no condition field, so say what each exit means in its description.
- **Entry instruction:** how the work is done: objective, inputs, bounded actions, output, acceptance evidence, blocked and failure behavior, and what to hand over when it routes. Every delivery already opens with the stage's name, kind, responsibility, and exits with their conditions, so do not repeat them.

## Do not write a prohibition per stage

Whether work belongs to the current stage or to another is the operator's standing rule. Do not add a do-not-do-X-here line to each stage and do not restate neighbors' responsibilities. Make the owner unambiguous instead: one stage owns each piece of work, and its description says so.

## Reasons and routing

A declared reason is at most 200 characters and reaches the next stage with its entry instruction when that stage has one. When an instruction asks for a reason, ask for a handoff: what was done, what remains, where to return. Never ask for logs, diffs, or full results; those belong in the conversation or a note.

Say whether the stage requests a declaration and what evidence justifies each route. Do not tell every stage to declare automatically.

## Check the whole workflow

Review these yourself:

1. Every kind of work has exactly one owning stage: no two descriptions claim it, and none is left unowned.
2. A rework path leads back to the stage that owns the fix.

The write report observes these and never blocks:

3. Every destination of a stage with two or more has a condition.
4. No description exceeds 300 characters, and every scripted or instructed stage has one.

## Example

```yaml
columns:
  - id: draft
    label: Draft
    description: Writes the first version of the deliverable from the brief and records open questions.
    allowed_transitions:
      - to: check
        when: The draft covers every point of the brief.
  - id: check
    label: Check
    description: Verifies the draft against the brief and reports each gap.
    allowed_transitions:
      - to: publish
        when: Every point of the brief is covered.
      - to: draft
        when: A point of the brief is missing or wrong.
    on_enter_prompt: |
      Compare the draft with the brief and list each gap.
      Declare the destination whose condition holds, with a handoff reason of at most 200 characters.
  - id: publish
    label: Publish
    description: Releases the verified draft and confirms that it is available.
```
