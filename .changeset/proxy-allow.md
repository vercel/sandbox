---
"@vercel/sandbox": major
---

`defineSandboxProxy` now accepts only sandboxes of the proxy's own project, read from `VERCEL_PROJECT_ID`. Requests from other sandboxes go to the invalid request handler (403 by default).

Pass `allow` to decide which sandboxes may use the proxy. It replaces the own-project rule, so include every check you need:

```ts
defineSandboxProxy(handler, {
  allow: (sandbox) =>
    sandbox.projectId === "prj_123" || sandbox.teamId === "team_123",
});
```

A proxy with no `VERCEL_PROJECT_ID`, such as one outside Vercel or in a project with system environment variables disabled, rejects every sandbox until it has an `allow`.

The second argument is now an options object, so move a custom invalid request handler to `onInvalidRequest`:

```ts
defineSandboxProxy(handler, {
  onInvalidRequest: (request, error) =>
    new Response("Forbidden", { status: 403 }),
});
```

The default invalid request handler now logs why a request was rejected, and the request passed to the handler no longer includes the `x-vercel-oidc-token` header.
