# Contributing

## Overview

- `beta` and `stable` are protected branches - no one can push to them directly, not even the repo owner.
- All changes go through pull requests targeting `beta`.
- CI must pass before a PR can be merged.

## If you have collaborator access

1. Create a branch from `beta` following the [branch naming conventions](docs/branch-names.md)
2. Push your branch and open a PR targeting `beta`.
3. CI runs automatically on the PR.
4. Once CI passes (and any required reviews are approved), merge.

## If you are an external contributor

Same flow, but fork the repo first. Open a PR from your fork's branch to `beta` on this repo.

After you open the PR, a bot will post a comment with instructions for signing the CLA. You only need to sign once - your signature is remembered for all future PRs.

## Contributor License Agreement

By submitting a contribution to this repository, you agree to the terms in [CLA.md](CLA.md).

In short: you keep ownership of your work, but you give the Deployery project broad rights to use, distribute, and relicense your contribution, and you confirm that you have the right to submit it.

If you are contributing work created for an employer or client, make sure you have the authority to contribute it under that agreement before opening a PR.

## What you can and cannot do

- Create and push to any branch you own: yes.
- Push directly to `beta` or `stable`: no - blocked by branch protection.
- Open a PR to `beta`: yes.
- Open a PR to `stable`: no; everything goes through `beta` first.
- Cut a beta or stable release: repo owner only (requires merging to `beta` and creating version tags)

## Further reading

- [Monorepo](docs/monorepo.md) - structure, package rules, what goes where.
- [Commands](docs/commands.md) - pnpm commands for day-to-day work.
- [Branch names](docs/branch-names.md) - naming conventions and types.
- [Commit messages](docs/commit-messages.md) - format and types.
- [Releases](docs/releases.md) - how to perform a beta or stable release.
