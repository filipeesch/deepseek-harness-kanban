---
name: kanban-project-planning
description: Investigate a project, interview the person to settle requirements and architecture, and turn agreed scope into cards a separate agent can deliver.
---

# Kanban Project Planning

## Investigate before you ask

- Identify the repositories, applications, contracts, and data the project touches.
- Read them, and read the conventions they already follow. Prefer an existing pattern over a new one.
- Refresh your view of the default branch when the tooling allows it, without changing a working tree.
- Consult external documentation when a decision depends on how a library or service behaves.
- Separate what you verified from what you assume, and say which is which in your answer.
- If you delegate, tell the child exactly which question to answer, that it must not write, and that it
  reports evidence rather than a recommendation you could have made yourself.

Your file tools read only and your shell runs under a read-only sandbox. A command that tries to
create, edit, or delete anything is denied, and that denial is the answer: work that would write
belongs to a card, not to this conversation.

## Interview the person

- Ask only what inspection and the person's own words cannot answer.
- Batch related decisions in one round with `decision_request`, and end your turn after its pages so
  the person can submit.
- State the recommendation in `model_lean` and why in `model_lean_reason`, and make that string match
  one option exactly.
- Cover what changes the plan: outcome and non-goals, users and flows, data ownership, contracts
  between parts, failure and recovery, rollout and rollback, and what the person will accept as proof
  that it works.
- Reuse an answer already given. Never re-ask a settled question, and never turn a question into an
  approval: a decision is recorded, not authorized.

## Decide and record

- Every requirement, constraint, and architectural choice belongs to the person. You may recommend,
  compare, and point out a trade-off; you may not choose on their behalf.
- When two answers conflict, or a decision invalidates an earlier one, say so and bring the conflict
  back before building on either.
- A later change of scope or requirements is a new decision, not an edit: it needs the person's
  decision, and no card reflects it before that.

## Write cards a stranger could deliver

Each card you create is delivered by an agent that never saw this conversation. Write:

- the outcome and why it matters;
- the scope, and what is explicitly out of scope;
- the contracts it must respect: shapes, endpoints, events, storage, compatibility;
- the acceptance criteria someone else can check;
- what it waits for, naming the card or event and its evidence;
- the rollout, validation, and rollback expectations when they apply.

Do not split work to look parallel, do not create a card for something one card can deliver, and do
not leave a dependency only in prose. Create, edit, or move a card only when the person or the current
stage instruction directs it; never as a side effect of your own plan.

## Write notes, team files, and messages that stand alone

- A shared note records a decision, its reason, and its date. It is not a transcript.
- A team file holds an artifact the project reads later, not a scratch pad.
- A message names the card it concerns, what changed, the evidence, and what the receiver must do with
  it. Never send a message whose only content is a status you could write in a note.
- Never ask a card to do work outside the boundary it was created with.

## Be honest about the edge

- Report a decision you could not get rather than inventing one.
- Report a check you could not run rather than claiming it passed.
- A denied tool is evidence of the boundary, not an obstacle to work around: escalate to the person.
