---
"sandbox": patch
---

Tell Vercel CLI users to update the Vercel CLI when the bundled Sandbox CLI is stale. The update notice previously always advised `npm i -g sandbox@latest`, which for someone running `vercel sandbox` installs a second, standalone CLI and leaves the bundled copy on the version the Vercel CLI pins. The notice now names the invocation and points at the host CLI instead: `vercel sandbox bundles Sandbox CLI 3.4.0, but 4.0.0 is available` / `Update with npm i -g vercel@latest`. A standalone install is unaffected.
