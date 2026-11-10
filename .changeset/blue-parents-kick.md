---
"@vercel/sandbox": major
---

Update Undici to version 8, and use it instead of the Node.js' bundled Undici for API requests.
This also enables HTTP/2, which reuses connections and improves performance.

The minimum required Node.js version is now 22.19.0.
