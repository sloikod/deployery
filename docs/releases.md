# Releases

CI runs automatically on every PR and push. Merging to `beta` publishes a beta Docker image. Stable releases require a version tag.

## Beta

1. Set `version` in root `package.json` to `X.Y.Z-beta` (e.g. `"0.2.0-beta"`)
2. Merge to `beta`.

The CI run number is appended automatically: `0.2.0-beta.1`, `0.2.0-beta.2`, etc. The `beta` tag always points to the latest.

## Stable

1. Merge `beta` into `stable`.
2. Set `version` in root `package.json` to `X.Y.Z` (e.g. `"0.2.0"`) and make a commit.
3. Create a tag `vX.Y.Z` pointing at that new commit - on GitHub.com go to the repo -> Tags -> "Create new tag", or use your git GUI.

The pipeline publishes the image as `0.2.0` and `latest`, and creates a GitHub release with auto-generated release notes. The tag must match `version` in `package.json` exactly - tag `v0.2.0` requires version `0.2.0`, this is enforced.
