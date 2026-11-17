# Releases

Nothing publishes a build artifact. The CI pipeline verifies the solution and produces nothing a person could install, so the repository URL is the install address.

## Install address

Document installation from `https://github.com/filipeesch/deepseek-harness-kanban`. Treat that address as a Git dependency: the clone carries no `lib/`, and the profile must allow the manifest `prepare` build for the resolved commit before the installed copy can load. Document the approval step and the unbuilt-clone failure whenever the install guidance changes, and never present an install that reported success as proof that the bundle activates.

## Pinning

Pin a reproducible install with a committish on the same URL. `#<commit sha>` is the only pin that cannot move; a `#v<version>` tag exists for the versions that were released and is created by hand after that, so document a tag as a convenience and never document a branch name as a pin.

## Version

Bump `version` in `package.json` in the pull request that changes the installed artifact, so the plugin manager and the profile can report which build they hold. A change to the published `files` list changes the artifact and therefore needs a bump.

## What not to document

Do not document `releases/latest/download/dsh-kanban.tgz` as the install address. The CI pipeline publishes nothing, so that asset resolves only to the last release published before the pipeline replaced the release workflow.

## Consistency

[Install](../operations/install.md) owns the install, update, pin, and failure-signature procedure, and the [README](../../README.md) states the same install address and pinning rule for a reader arriving from the repository page. Update both in the same change, and confirm the packed file list with `npm pack --dry-run` when `files` changes.
