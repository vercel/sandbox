---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
---

Add support for [Drives](https://vercel.com/docs/sandbox/concepts/drives), persistent storage that can store TBs of data and be mounted on sandboxes at a specific path. Drives support point-in-time, read-only snapshots.

Get started by creating a drive, then mount it on a sandbox:

```ts
import { Sandbox, Drive } from '@vercel/sandbox';
 
const drive = await Drive.getOrCreate({ name: 'workspace-cache' });
 
// Mount as read-write once
const sandbox = await Sandbox.create({
  name: 'my-sandbox',
  mounts: {
    '/data': drive
  },
});
```

Create a snapshot to mount the same drive on multiple sandboxes at a time:

```ts
import { Sandbox, Drive } from '@vercel/sandbox';
 
const drive = await Drive.getOrCreate({ name: 'shared' });
 
// Mount many snapshots of the same drive
const firstReader = await Sandbox.create({
  name: 'reader-1',
  mounts: {
    '/data': drive.snapshot()
  },
});
const secondReader = await Sandbox.create({
  name: 'reader-2',
  mounts: {
    '/data': drive.snapshot()
  },
});
```

Read the documentation to learn more: https://vercel.com/docs/sandbox/concepts/drives
