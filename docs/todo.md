# Todo

- Revisit non-UI first-time setup for self-hosted and cloud scenarios. If Deployery needs headless initial password setup later, design it around a deliberate bootstrap token or control-plane flow instead of an unauthenticated open endpoint.
- Revisit the actual managed update and migration strategy once the v0 runtime exists. The current plan only reserves `instance.json` for version/setup bookkeeping and does not yet define migration execution behavior.
