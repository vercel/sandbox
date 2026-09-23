---
"@vercel/sandbox-mock": minor
"@vercel/sandbox": minor
"sandbox": minor
---

Add support for attaching sandboxes to Secure Compute networks:
- In the CLI, use `sandbox create --network-id ID` with your Secure Compute network id 
- In the SDK, use `Sandbox.create({ networkId: 'ID' })` with your Secure Compute network id 
