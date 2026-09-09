---
"sandbox": patch
---

Give Vercel CLI users correct update advice when the bundled Sandbox CLI is stale, and keep them inside the Vercel CLI. The update notice previously always advised `npm i -g sandbox@latest`, which for someone running `vercel sandbox` installs a second, standalone CLI and leaves the bundled copy on the version the Vercel CLI pins. The notice now detects the invocation and names the mechanism instead: `vercel sandbox bundles Sandbox CLI 3.4.0, but 4.0.0 is available` / `This copy is pinned by the Vercel CLI and updates when it does (npm i -g vercel@latest)`. It deliberately does not offer the standalone CLI as a way out, since routing a Vercel CLI user onto a second CLI is a worse outcome than being a version behind, and it stops short of promising that updating reaches the newest release, because the bundled copy is capped by the pin. A standalone install is unaffected.
