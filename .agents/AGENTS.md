<!-- BEGIN:hard-agent-rules -->
# These are non-negotiable:
0. **Retrieval-led reasoning** - for any library, service, API, or primitive: look up current docs, do not rely on training data
1. **Maximum code consistency** - aggressively search for existing patterns and use them. Applies to naming, functions, file and folder structure, tests, and schema
2. **Propose before deciding** - as an agent, you are the vehicle to clean, perfect, human-readable code. As a human, only the user can know what good naming looks like to other humans - before introducing any new name, file, route, schema field, env var, constant, copy, label, or anything else hand-written: state it + rationale, wait for explicit go-ahead from the user, let them steer you. When task requirements are ambiguous, ask before assuming
3. **No slop** - run `pnpm lint && pnpm check-types && pnpm test` before marking any task done, ensure a test exists and is doing what it's logically supposed to when you encounter anything that could possibly need to have a test or verifiable metric
4. **No bloat** - everything has to be as clean and lean as possible
- No backwards compatibility: this is a dev environment, never preserve bloat unless explicitly requested
- No fallback: bloat that breaks consistency, log failures
- No overdeclaring: scan for existing patterns before locally declaring them. Reuse shared libs, constants, utils, etc. for everything
5. **No magic** - use relative, derived, shared values and approaches whenever possible instead of overdeclaring bloat. Do not scatter incoherent stuff across the codebase
6. **No suppression** - do not silence errors with `any`, `@ts-ignore`, etc.
7. **Never edit "dependencies" or "devDependencies" in package.json** - use the proper install command(s) like `pnpm install` instead
8. **pnpm only** - never use `npm` or `npx`. Use `pnpm` and `pnpm dlx` instead
<!-- END:hard-agent-rules -->
<!-- BEGIN:general-agent-rules -->
## Naming
- Files: `kebab-case` where practical
- Vars/functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- DB fields/enums: `snake_case`

## Testing
- Framework: Vitest
- Colocate `*.test.ts(x)` next to source. No `__tests__/` directories
- Integration tests: `*.integration.test.ts`
- `passWithNoTests` is enabled today, but changed behavior should still come with meaningful tests

## Output style
- No emdashes, no unicode characters, no AI watermarking (`Co-Authored-By`, generated-by footers, `claude.com` links) in commits or PR bodies
- Token efficiency: use `--name-only`, read only what you need, prefer targeted reads and edits
- Instead of '2024 2025', use '2026' or '2025 2026' when researching
<!-- END:general-agent-rules -->
