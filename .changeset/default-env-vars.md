---
"@vercel/sandbox": minor
---

Add support for default environment variables in `Sandbox.create()`. These environment variables are inherited by all commands unless overridden with the `env` option in `runCommand`.

```ts
const sandbox = await Sandbox.create({
  env: { HELLO: "world" },
});

// All commands will have HELLO=world
await sandbox.runCommand("bash", ["-c", 'echo "Hello $HELLO"']);
```
