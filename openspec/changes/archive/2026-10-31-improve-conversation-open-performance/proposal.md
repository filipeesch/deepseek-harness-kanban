# Proposal

## Why

When several task conversations are running, opening any conversation in the Kanban drawer blocks on a full Session-catalog refresh and then on history opening, so the drawer shows only "Opening native conversation…" while the same conversation opens instantly in the DSH sidebar. The same load also makes the plugin publish a complete Kanban snapshot for nearly every Session event and read complete Session logs to derive attention facts, which saturates the Host and the client and makes every surface slower.

## What Changes

- Opening a task conversation stops depending on the Session catalog. The drawer retains the native Session and renders the host's native conversation surface immediately; history settling and open failures are presented by the native conversation states instead of a plugin blocking placeholder. A catalog refresh happens only when the Session is unknown to the client catalog, followed by a single retry.
- Conversations visited in the open task drawer stay warm for as long as that drawer is mounted: switching conversation tabs or moving between Conversations, Info, Git, and Notes no longer re-opens or re-downloads history. Warmth starts lazily on the first visit, and closing the drawer or the conversation releases it.
- The Host coalesces Kanban snapshot publication (bounded delay with a trailing publish) and ignores Session events that cannot change task surfaces, while structured-question changes keep publishing for any conversation.
- Attention conversation facts for live Sessions come from a host-only incremental Session projection. Full Session inspection remains only as a fallback for Sessions that are not live.
- A snapshot reuses its cached Kanban state until the repository changes instead of cloning every Hub on each publication.
- A narrow memo boundary keeps board snapshot renders from re-rendering the mounted conversation subtree.
- Supporting refactors keep the new behavior out of god components: the conversation lease lifecycle moves into an injected registry, read/attention responsibilities leave the client bridge, and attention fact projection separates from worktree resume in the attention coordinator.

Out of scope: a board-wide render refactor (subscription splitting and card memoization) remains a separate follow-up change; conversation creation, identity, and native DSH behavior stay unchanged; no DSH patch or new DSH release is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: the drawer opens a native conversation without a catalog round-trip, keeps visited conversations warm while the drawer is mounted, and guarantees that coalesced attention updates still present the final state of a burst of activity.

## Impact

- Client conversation surface and drawer: `src/client/conversation-surface.tsx`, `src/client/drawer.tsx`, `src/client/drawer-conversations.tsx`, `src/client.tsx`, and a new conversation-lease module.
- Client feed: `src/client-bridge.ts` loses attention/read-tracking responsibilities to a smaller collaborator.
- Host publication and attention: `src/host/app.ts`, `src/host/attention.ts`, `src/host/hub-repository.ts`, `src/host/native-facts.ts`, and a new host-only Session projection for conversation facts.
- Affects the pinned DSH public surfaces used by the plugin (`ISessions.retain`/`refresh`, Session projections, history inspection); no Host patch, no schema, and no persisted plugin data change.
- Verification is planned separately from this proposal.
