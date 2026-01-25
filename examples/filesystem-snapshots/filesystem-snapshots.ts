import { Sandbox,Snapshot } from '@vercel/sandbox';

async function main() {
  // Create a new sandbox
  console.log('Creating sandbox...');
  const sandbox = await Sandbox.create();

  console.log('Sandbox created successfully!\n');

  // 1. Write a file to the sandbox filesystem
  await sandbox.writeFiles([{
    path: '/vercel/sandbox/hello-world',
    content: Buffer.from('Hello World from Vercel Sandbox snapshots!'),
  }]);
  console.log('Wrote hello-world file to /vercel/sandbox/');

  // 2. Take a filesystem snapshot
  console.log('Taking filesystem snapshot...');
  const snapshot = await sandbox.snapshot();
  console.log('Created snapshot successfully!\n');

  console.log('Listing all snapshots:');
  const snapshots = await Snapshot.list();
  for (const snapshot of snapshots.json.snapshots) {
    console.log(`- ${snapshot.id}`);
    console.log(`  Created at: ${new Date(snapshot.createdAt).toISOString()}`);
    console.log(`  Size: ${Math.round(snapshot.sizeBytes / 1024 / 1024)} MB\n`);
  }

  // 3. Create a new sandbox from that snapshot
  console.log('Creating new sandbox from snapshot...');
  const newSandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId: snapshot.snapshotId },
  });
  console.log('New sandbox created from snapshot successfully!\n');

  // 4. Read the file from the new sandbox to verify its content
  console.log('Reading hello-world file from new sandbox:');
  const buffer = await newSandbox.readFile({ path: '/vercel/sandbox/hello-world' })
  if (buffer) {
    for await (const chunk of buffer) {
      process.stdout.write(chunk);
    }
  }

  // Clean up
  await newSandbox.stop();
}

main().catch(console.error);
