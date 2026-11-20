---
"@vercel/sandbox": major
---

`defineSandboxProxy` now only accepts requests from sandboxes owned by the proxy's own team and project, read from its Vercel OIDC token. To also accept sandboxes from other teams or projects, pass `teamId` and `projectId` (a string or an array of strings). To accept sandboxes from any team, pass `dangerouslyAllowAll: true`. Requests from other sandboxes are rejected through the invalid request handler (403 by default), and so are all requests when the proxy's own team and project can't be determined and no `teamId`/`projectId` is passed.

The second argument is now an options object, so move a custom invalid request handler to `onInvalidRequest`:

```ts
defineSandboxProxy(handler, {
  onInvalidRequest: (request, error) =>
    new Response("Forbidden", { status: 403 }),
});
```
