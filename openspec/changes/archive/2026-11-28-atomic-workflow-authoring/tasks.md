# Tasks

## 1. Structured composition

- [x] 1.1 Extract reusable side-effect-free operations and input validation for the supported agent, stage, route, and layout edits. Prove focused tool compatibility with the existing board-authoring and agent-tool tests, including the focused tools' revision behavior.
- [x] 1.2 Add ordered batch composition with bounded discriminated inputs and indexed errors. Test successful create-bind-edit order, clear-before-remove, invalid references, and a late invalid operation with no persisted partial state.
- [x] 1.3 Narrow patches to edited YAML spans, including individual agent entries and named layout values. Verify byte preservation with fixtures containing comments, unaffected agents, legacy main defaults, nondefault dimensions, and authored formatting.

## 2. Preview, validation, and exact apply

- [x] 2.1 Add snapshot-based candidate review, textual diff, digest, final validation, and impact reporting. Test errors versus advisory warnings and unknown roster, changed stage and agent impacts, stale declarations versus captured advances, and omission counts without card content or parameter values.
- [x] 2.2 Add bounded conversation-scoped preview retention and exact candidate/diff retrieval through the architect tools. Test large and Unicode payload round trips, expiry, unauthorized access, and zero durable changes during preview.
- [x] 2.3 Add strict apply via the existing reviewed local workflow writer with commit-time Hub revision enforcement, no rebase, and no publishing. With the tool fixture, assert byte-for-byte storage and digest, one attributed local workflow change, no write for bad digest/handle, and no write when a concurrent Hub change lands after review, including when it leaves the YAML unchanged.
- [x] 2.4 Wire the tool registrations and ordinary-chat scope check. Verify both calls are available to the architect in ordinary chat but withheld from other roles and refused for direct and descendant task conversations, without widening role allowlists.

## 3. Architect guidance and integration verification

- [x] 3.1 Update the bundled architect persona, skill, and relevant references to cover material-ambiguity questions, exact read and review, separate approval, strict apply, and honest reporting of configuration versus runtime. Verify packaged guidance and role boundaries in the architect preset tests.
- [x] 3.2 Update the owning user documentation and bump the installed artifact version per release rules. Verify the documentation gate and the package's preset registration, references, and version checks.
- [x] 3.3 Exercise the generic triage fixture end to end through public tool contracts: preview an agent, binding, instruction and route change; verify the exact diff and impacts; measure the candidate with three synthetic cards per stage; apply and compare stored bytes; and check stale and mismatched refusals. Use isolated fixtures and replay-only composition if a native conversation is needed; keep acceptance evidence out of version control. Run `pnpm run check` and `openspec validate atomic-workflow-authoring --strict` before handoff.
