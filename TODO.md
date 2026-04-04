# Todo

- Reintroduce Deployery-owned auth once there is an API and DB, then deal with server.ts and proxying. Keep the auth simple and first-party instead of rebuilding around `code-server` auth.
- Revisit the actual managed update and migration strategy once the v0 runtime exists. The current plan only reserves `instance.json` for version/setup bookkeeping and does not yet define migration execution behavior.
- Add a simple version switcher UI (like n8n's) once the API can handle container orchestration. The persistence layer is already in place - this just needs an API endpoint that accepts a target version and triggers container recreation with the same docker volume.

- Set up a vulnerability disclosure program so security researchers have a clear way to report issues privately. At minimum, add a `SECURITY.md` at the repo root with a contact email or link and a commitment to respond within a set timeframe. Optionally use GitHub's built-in private vulnerability reporting (Settings -> Security -> Private vulnerability reporting) to avoid exposing issues publicly before a fix is ready - a good example: https://github.com/chenglou/pretext.
- Consider the following supply chain security hardening once the product has enterprise users. Trivy scanning, SBOM generation, and SLSA L3 provenance are already in place - only this remains:
  - **VEX attestations (Vulnerability Exploitability eXchange)** - pair with the existing SBOM to explicitly flag known CVEs that are present in dependencies but not actually reachable/exploitable. Prevents false-positive vulnerability scanner alerts from blocking enterprise deployments. Low priority until scanner adoption (Trivy, Grype, Wiz, Snyk) is broader and a specific enterprise customer is blocked by a false positive.

Go to GitHub repo -> Settings -> Branches -> Add branch protection rule for `beta` and `stable`:

- Require a pull request before merging.
- Require status checks to pass (select the CI check)
- Block direct pushes.
- Add CLA as a required status check.

Replace `<div class="letterpress"></div>` and `<a class="window-appicon"></a>` branding in code-server with our own.

Setup feature requests and issues/PRs/tags properly.

Add README.md - a good example: https://github.com/n8n-io/n8n.
