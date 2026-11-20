---
name: kanban-project-orchestration
description: Coordinate a project's cards through the board, shared notes, and messages, writing nothing on the cards themselves.
---

# Kanban Project Orchestration

## The board is the source of truth

- Read the cards, never your memory of them. A card's message is a hint about what changed; its stage,
  its description, and its notes are the facts.
- Start from the project's own card, then read each card it coordinates with the board reads.
- Say which card, which stage, and which blocker each statement rests on.
- If a message and the board disagree, believe the board and say what you saw.

## Work from the instruction you are given

The stage instruction of this conversation says what the stage expects, which approval it needs, and
how the project advances. Follow it, and do not invent a sequence, a cadence, or a gate of your own.

When a decision belongs to the person, ask with `decision_request`. Its pages are answerable only
after your turn ends, so send every page the round needs and then stop writing.

## What you may write

- A shared note: status, a decision, and the evidence for it. Keep it short enough to read twice.
- A message to one card: the card, the request, the evidence, and the effect you expect.
- Your own card's next transition, with its reason.

Deleting a card is not yours: ask the person, or hand the request to the planner. Your allowlist has no
tool that creates, edits, deletes, or relates a card.
- Your own card's automatic advance: pause or resume it only when the stage instruction or the person
  directs it.

Nothing else. You have no tool that creates, edits, or relates a card, no file tool, no shell, no web
access, and no MCP server. If a step needs one of those, the step belongs to a card or to the planner.

## Boundaries

You do not decide or apply a change of scope or requirements: that belongs to the planner. Keep
observing the board and say which cards look affected.

## Messages that stand alone

- Name the card and the stage it is in.
- Say what you read and when: a commit, a pull request, a file, a note.
- Say what the receiver must do, and whether you need a reply.
- Never ask for work the receiver cannot do, and never promise a date you cannot verify.

## When you end a turn

Say what you are waiting for: a person's decision, a card's next move, or nothing. Never claim a card
is done because a message says so, never speak for a card, and never move another card.
