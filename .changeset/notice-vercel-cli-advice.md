---
"sandbox": patch
---

Give Vercel CLI users honest update advice when the bundled Sandbox CLI is stale. The update notice previously always advised `npm i -g sandbox@latest`, which for someone running `vercel sandbox` installs a second, standalone CLI and leaves the bundled copy on the version the Vercel CLI pins. The notice now names the invocation and the mechanism: `vercel sandbox bundles Sandbox CLI 3.4.0, but 4.0.0 is available` / `This copy tracks the Vercel CLI's pinned version, so update with npm i -g vercel@latest, or install the standalone CLI for the latest`. It deliberately stops short of promising that updating the Vercel CLI reaches the newest release, since the bundled copy is capped by the pin and that routinely lags the registry. A standalone install is unaffected.
