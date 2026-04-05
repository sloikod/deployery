# Commands

Run repo-wide commands from the root. Run a command in one workspace with `pnpm -F <workspace-name> <command>`.

- `pnpm check` runs the full suite of checks: type checking, linting, formatting, and tests. Run this before pushing - CI runs the same thing.

- `pnpm i` installs package(s).
- Shared project constants (name, repo, registry, URLs) live in `@deployery/constants`. These are developer constants - not user configuration.
- `pnpm outdated` lists packages that have newer versions.
- `pnpm up` updates installed packages using version pins from `package.json` file(s).
  `-r` from root to update the whole monorepo.
  `--latest` move version pins in `package.json` file(s) to latest.
  `<package>` target a specific package, for example `pnpm up -r typescript@6.0.2`.
