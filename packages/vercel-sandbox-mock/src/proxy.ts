// The `./proxy` entry point. `defineSandboxProxy` operates on standard
// Request/Response objects and verifies forwarded OIDC tokens, independent of
// how the sandbox itself is backed — so the mock re-exports the real
// implementation unchanged.
export * from "@vercel/sandbox/proxy";
