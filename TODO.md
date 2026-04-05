# Todo

- Reintroduce Deployery-owned auth once there is an API and DB, then deal with server.ts and proxying. Keep the auth simple and first-party instead of rebuilding around `code-server` auth.
- Revisit the actual managed update and migration strategy once the v0 runtime exists. The current plan only reserves `instance.json` for version/setup bookkeeping and does not yet define migration execution behavior.
- Add a simple version switcher UI (like n8n's) once the API can handle container orchestration. The persistence layer is already in place - this just needs an API endpoint that accepts a target version and triggers container recreation with the same docker volume.

- Consider the following supply chain security hardening once the product has enterprise users. Trivy scanning, SBOM generation, and SLSA L3 provenance are already in place - only this remains:
  - **VEX attestations (Vulnerability Exploitability eXchange)** - pair with the existing SBOM to explicitly flag known CVEs that are present in dependencies but not actually reachable/exploitable. Prevents false-positive vulnerability scanner alerts from blocking enterprise deployments. Low priority until scanner adoption (Trivy, Grype, Wiz, Snyk) is broader and a specific enterprise customer is blocked by a false positive.

Replace `<div class="letterpress"></div>` and `<a class="window-appicon"></a>` branding in code-server with our own.

Add README.md - a good example: https://github.com/n8n-io/n8n.
