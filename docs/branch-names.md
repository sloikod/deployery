# Branch Names

- Format: `<type>/<topic>`.
- Lowercase, hyphens between words.
- Branch from `beta` unless it's specifically for a `stable` hotfix.
- Rename the branch if its main purpose changes significantly.
- Choose the first type that applies when going top to down in the list.

1. `fix` - something is broken and this branch will fix it.
2. `feat` - user will be able to do something they couldn't before.
3. `refactor` - code will change but user won't see a difference.
4. `chore` - tests, tooling, config, deps, scripts, docs, comments will change.
5. `wip` - messy, experimental, or in-progress work not cleanly fitting the types above.
