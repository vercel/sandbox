---
"sandbox": minor
---
Add support for [Drives](https://vercel.com/docs/sandbox/concepts/drives), persistent storage that can store TBs of data and be mounted on sandboxes at a specific path. Drives support point-in-time, read-only snapshots.

Get started by creating a drive, then mount it on a sandbox:

```sh
sandbox drives get-or-create workspace-cache

sandbox create --name my-sandbox --mount workspace-cache:/data
```

Create a snapshot to mount the same drive on multiple sandboxes at a time:

```ts
sandbox drives get-or-create shared

sandbox create --name reader-1 --mount shared:/data:snapshot
sandbox create --name reader-2 --mount shared:/data:snapshot
```

Read the documentation to learn more: https://vercel.com/docs/sandbox/concepts/drives

