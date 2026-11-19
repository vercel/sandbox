---
"@vercel/sandbox": major
---

`defineSandboxProxy` now requires the teams and projects whose sandboxes may use the proxy. Its second argument is now an options object: pass `teamId` and `projectId` (a string or an array of strings), and move a custom invalid request handler to `onInvalidRequest`. Requests from other sandboxes are rejected through that handler (403 by default). To accept sandboxes from any team, pass `insecurelyAllowAll: true` instead. `defineSandboxProxy` throws at definition time when neither is passed.

```ts
defineSandboxProxy(handler, {
  teamId: "team_123",
  projectId: "prj_123",
  onInvalidRequest: (request, error) =>
    new Response("Forbidden", { status: 403 }),
});
```
