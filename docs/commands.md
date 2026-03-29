# Commands

## Overview

- Run repo-wide commands from the root.
- Use `pnpm check` as the single repo-wide mistake check command.
- Run a command in one workspace with `pnpm --filter <workspace-name> <command>`.

## List

- `pnpm i` installs package(s).
- `pnpm outdated` lists packages that have newer versions.
- `pnpm up` updates installed packages using version pins from `package.json` file(s).
    `-r` from root to update the whole monorepo.
    `--latest` move version pins in `package.json` file(s) to latest.
    `<package>` target a specific package, for example `pnpm up -r typescript@6.0.2`.
