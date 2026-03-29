# Monorepo

## Overview

- Put runnable apps in `apps/*`.
- Put shared code, config, and tooling in `packages/*`.
- Apps may depend on packages.
- Packages may depend on other packages, but never on apps.
- If code is shared across workspaces, move it to `packages/*`.

## Root

- Root `tsconfig`, ESLint, Vitest, pnpm, and `.gitignore` files are the shared defaults.
- Keep root commands minimal and easy to remember.
- Internal documentation in /docs, public documentation in /docs/public

## Workspace

- Every workspace needs a `package.json` with a `name`.
- Only keep small local overrides when a workspace truly needs different behavior from the root.
- Don't import from another workspace using relative paths.
- Don't rely on dependencies of another workspace.

## Cascade Effects

- Root config affects the whole repo.
- A package change affects anything that depends on it.
