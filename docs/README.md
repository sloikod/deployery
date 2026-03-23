# Deployery Docs

This folder contains the basic documentation for the current Deployery OSS repo.

## Pages

- `getting-started.md`
  - Local setup, build, and first run
- `architecture.md`
  - High-level runtime shape and repo layout
- `commands.md`
  - Commands you will use most often while developing and running Deployery

## Current Product Shape

Deployery currently runs as a self-hosted Docker image that:

- starts directly in `code-server`
- persists a full sandbox filesystem across restarts
- keeps workflow and app state in SQLite via Drizzle
- exposes one public HTTP entrypoint for both the API and `code-server`

The browser UX is the IDE itself. There is no separate dashboard in this repo.
