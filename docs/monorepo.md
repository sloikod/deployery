# Monorepo

- Put everything in `packages/*` - apps, shared code, config, and tooling.
- Packages may depend on other packages.
- If code is shared across the codebase, make a new package where appropriate.
- TypeScript/ESLint configs, apps, and shared code all live in `packages/*`; repo-level commands and config stay at the root.
- Keep root commands minimal and easy to remember.
- Internal documentation in /docs, public documentation in /docs/public.
- Every workspace needs a `package.json` with a `name`.
- Only keep small local overrides when a workspace truly needs different behavior from the root.
- Don't import from another workspace using relative paths.
- Don't rely on dependencies of another workspace.
- Root config affects the whole repo. A package change affects anything that depends on it.
