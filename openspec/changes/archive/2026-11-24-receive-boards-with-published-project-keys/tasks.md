# Tasks

## 1. Published project identity

- [x] 1.1 Add `publishedKey?: string` to the project types and to `ProjectInput`, and extend the project schema so the field is optional, pattern-checked, and never carried by a placeholder; verify with schema tests that a project with a published key parses and that a placeholder carrying a path is still refused.
- [x] 1.2 Add the published-identity helpers to `src/domain/board-project-scope.ts` (`publishedIdentityOf`, an identity-set check, and the project lookup by identity) and point every scope rule at them; verify in `tests/domain/board-project-scope.test.ts` that a linked project is allowed by its published identity and that a scope naming its local key alone does not allow it.
- [x] 1.3 Enforce published-identity uniqueness and the scope-resolution invariant in the Hub schema, including a placeholder as a holder; verify in `tests/domain/hub-schema.test.ts` that a duplicate published identity is refused and a scope naming an identity no project carries is refused.
- [x] 1.4 Make a project save migrate scopes only when the published identity changes, so a local-key edit on a linked project touches no board; verify in the project save tests that an unbound key edit still rewrites scopes and a linked local-key edit leaves every scope byte-identical.
- [x] 1.5 Preserve the published key across an adoption save and make a save whose requested identity is carried by a placeholder absorb that placeholder instead of refusing; verify in `tests/host/project-scope.test.ts` that adopting keeps both keys and that binding by creating a project removes the placeholder.
- [x] 1.6 Report the published identity from the product tools without changing scope semantics; verify in the tool tests that `list_projects` carries the published key and `get_workflow_summary` keeps reporting the scope's published identities.

## 2. Received-scope policy

- [x] 2.1 Create one pure module for "a received scope meets this Hub" that returns the identities to write, the placeholders to create, and the ignored ones; verify with a new domain test file covering a known identity, an unknown identity, an identity ignored by this installation, and an empty scope.
- [x] 2.2 Add the operation that materializes placeholders for the received identities (local key equal to the identity unless another project holds it, no path, published origin) inside an existing draft; verify in a domain operations test that it creates only the missing ones and is idempotent.
- [x] 2.3 Add the ignore and restore operation on a placeholder, with the mark that hides it from adoption and keeps its identity in every scope; verify in a domain test that ignoring changes no board scope and restoring presents it again.
- [x] 2.4 Prune placeholders no board of the Hub names, without recording an ignore, and never touch a registered project; verify in a domain test that a cited placeholder survives, an uncited one is removed, and a later reception recreates it.
- [x] 2.5 Route the ignore and restore through the host command surface with the Hub revision precondition; verify in a host command test that a stale revision is refused and a successful call is reported in the snapshot.

## 3. Team reception no longer blocks on projects

- [x] 3.1 Route the three board-apply paths (create a received board, adopt a revised scope, resolve to the team version) through one identity write helper that runs the received-scope policy, materializes placeholders, and prunes afterwards; verify the existing per-board sharing suite still passes and that no apply path calls the raw scope write.
- [x] 3.2 Add the regression test for the reported failure: a published log whose scope names two identities the receiving Hub lacks; verify the board is created, its workflow is readable, both placeholders exist, and the apply reports success instead of `INVALID_PROJECT_KEY`.
- [x] 3.3 Add the multi-board read test: two published boards with scopes, applied over a directory-backed layout; verify both boards land with their workflows and each placeholder names both boards.
- [x] 3.4 Keep an ignored identity out of adoption across a later apply, and keep that board out of draft; verify in the sharing suite that the hidden placeholder stays, no new placeholder appears, and the board state is up to date.
- [x] 3.5 Collapse the duplicated local-board projection used by the orphan-column checks into one helper and re-run the sharing suite plus the typecheck; verify `pnpm run typecheck` and the sharing tests pass with the applier smaller than before.

## 4. Workflow import receives its scope

- [x] 4.1 Replace the scope filtering in the transfer plan with the received-scope policy and report the identities awaiting adoption instead of dropped keys; verify the domain plan tests cover a known identity, an unknown identity, an ignored identity, and an empty scope.
- [x] 4.2 Materialize placeholders when an import applies and keep an ignored identity out of the presented adoption list; verify the host import tests assert the placeholders after apply.
- [x] 4.3 Update the import read and result types and their wire schemas to the new plan fields; verify the wire schema tests parse the new plan and reject the removed fields.
- [x] 4.4 Update the import dialog copy from a dropped scope to identities awaiting adoption; verify the dialog component test asserts the new copy and that applying stays available.

## 5. Configuration surfaces

- [x] 5.1 Rebuild the Projects section around the received identities: an awaiting-adoption summary, each placeholder with the boards that name it, and adopt, link, and ignore actions; verify the component tests cover the summary count, the named boards, and each action's command.
- [x] 5.2 Add the ignored group with restore and its empty state to the same section; verify the component test shows the ignored identity with its boards and dispatches the restore command.
- [x] 5.3 Add the link action's confirmation, naming the boards whose scope is rewritten and refusing when the identity is already carried; verify the component test covers both outcomes.
- [x] 5.4 Expose both identities in the project editor, with the team key optional and explained; verify the editor test saves a published key and that an empty field clears it.
- [x] 5.5 Name projects by their published identity in the board project scope form and mark awaiting-adoption and ignored placeholders; verify the form test covers the label and the marks.
- [x] 5.6 Add the Team Settings notice that points to Projects and the configuration section switch it uses; verify the component test shows the notice only while identities await adoption and switches section on activation.
- [x] 5.7 Capture the Projects surface in a browser check with the awaiting-adoption and ignored states; verify `pnpm run test:browser` passes and the screenshot is reviewed in `.verification/`.

## 6. Documentation and gates

- [x] 6.1 Update `docs/user/team-sharing.md`, `docs/user/hubs-and-boards.md`, and `docs/user/workflows.md` for published identities, reception, linking, ignoring, and the import change; verify `pnpm run check` reports no broken link, missing index entry, or version claim.
- [x] 6.2 Run the full verification for the change: `pnpm run typecheck`, `pnpm run test`, `pnpm run check`, and `npx openspec validate receive-boards-with-published-project-keys`; verify every command passes and report the counts.