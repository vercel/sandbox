import { Sandbox } from '@vercel/sandbox';

async function main() {
  const sandbox = await Sandbox.create();
  
  // Install Go
  console.log('Installing Go...');
  await sandbox.runCommand({
    cmd: 'dnf',
    args: ['install', '-y', 'golang'],
    sudo: true,
  });
  
  // Create a simple Hello World Go program
  console.log('Creating Hello World Go program...');
  await sandbox.writeFiles([
    {
      path: 'hello.go',
      content: Buffer.from(`package main

import "fmt"

func main() {
	fmt.Println("Hello, World from Go in Sandbox!")
}
`)
    }
  ]);
  
  // Run the Go program
  console.log('Running Go program...');
  const runResult = await sandbox.runCommand('go', ['run', 'hello.go']);
  const programOutput = await runResult.stdout();
  
  console.log('Output:', programOutput);
  
  await sandbox.stop();
}

main().catch(console.error); 