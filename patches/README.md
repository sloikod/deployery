# Patches

- `fumadocs-ui@16.7.7.patch` removes the Scira AI entry from the Fumadocs docs page `Open` dropdown while keeping the upstream component and icons intact.
- The patch is wired in `pnpm-workspace.yaml` and reapplied automatically on `pnpm i`.
- If `fumadocs-ui` is upgraded, refresh this patch for the new version and run `pnpm --filter @deployery/docs check`.
