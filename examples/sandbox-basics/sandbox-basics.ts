import { Sandbox } from '@vercel/sandbox';

async function main() {

  // Create a new sandbox
  console.log('Creating sandbox...');
  const sandbox = await Sandbox.create({
    timeout: 300000, // 5 minutes
  });

  console.log('Sandbox created successfully!\n');

  // 1. Check current working directory
  const pwdResult = await sandbox.runCommand('pwd');
  console.log(`Current working directory: ${await pwdResult.stdout()}`);

  // 2. List contents of current directory
  console.log('Directory Contents:');
  const lsResult = await sandbox.runCommand('ls', ['-la']);
  console.log(await lsResult.stdout());

  // 3. Check what's on PATH
  console.log('PATH Environment Variable:');
  const pathResult = await sandbox.runCommand('bash', ['-c', 'echo $PATH']);
  const pathValue = await pathResult.stdout();
  console.log(`PATH: ${pathValue}`);
  
  // Display PATH in a more readable format
  console.log('PATH directories:');
  const pathDirs = pathValue.trim().split(':');
  pathDirs.forEach((dir, index) => {
    console.log(`  ${index + 1}. ${dir}`);
  });

  // 4. Check available commands/tools
  console.log('Available Tools:');
  const tools = ['node', 'npm', 'python3', 'git', 'curl', 'wget', 'bash', 'sh'];
  
  for (const tool of tools) {
    const whichResult = await sandbox.runCommand('which', [tool]);
    if (whichResult.exitCode === 0) {
      const toolPath = await whichResult.stdout();
      console.log(`  ✅ ${tool}: ${toolPath.trim()}`);
    } else {
      console.log(`  ❌ ${tool}: not found`);
    }
  }

  // 5. Check system information
  console.log('System Information:');
  const unameResult = await sandbox.runCommand('uname', ['-a']);
  console.log(`System: ${await unameResult.stdout()}`);

  const whoamiResult = await sandbox.runCommand('whoami');
  console.log(`User: ${await whoamiResult.stdout()}`);

  // 6. Set and use environment variables
  console.log('Environment Variables:');
  
  // Demonstrate environment variables using bash -c
  // Note: Environment variables don't persist between separate commands
  const envTestResult = await sandbox.runCommand('bash', ['-c', 'export MY_GREETINGS="Hello from sandbox!" && export EXAMPLE_NUMBER=42 && echo "Greetings string: $MY_GREETINGS" && echo "Number variable: $EXAMPLE_NUMBER"']);
  console.log(await envTestResult.stdout());

  // 7. Create a simple script and run it
  console.log('Creating and Running a Script:');
  
  // Write a simple bash script that sets and uses environment variables
  await sandbox.writeFiles([
    {
      path: 'hello.sh',
      content: Buffer.from(`#!/bin/bash
# Set environment variables within the script
export MY_GREETINGS="Hello from a script in sandbox!"
export EXAMPLE_NUMBER=93

echo "Hello from a script!"
echo "Current directory: $(pwd)"
echo "Script arguments: $@"
echo "Greetings string: $MY_GREETINGS"
echo "Number variable: $EXAMPLE_NUMBER"
`),
    },
  ]);

  // Make script executable
  await sandbox.runCommand('chmod', ['+x', 'hello.sh']);
  
  // Run the script
  const scriptResult = await sandbox.runCommand('./hello.sh', ['arg1', 'arg2']);
  console.log(await scriptResult.stdout());

  // 8. Demonstrate process management and signals
  console.log('Process Management and Signals:');
  
  // Create a long-running process script
  await sandbox.writeFiles([
    {
      path: 'long_process.sh',
      content: Buffer.from(`#!/bin/bash
echo "Starting long process (PID: $$)..."
trap 'echo "Received SIGTERM, cleaning up..."; exit 0' TERM
trap 'echo "Received SIGINT, cleaning up..."; exit 0' INT

for i in {1..10}; do
  echo "Working... step $i"
  sleep 2
done
echo "Process completed normally"
`),
    },
  ]);

  await sandbox.runCommand('chmod', ['+x', 'long_process.sh']);
  
  // Start the long process in detached mode
  console.log('Starting long-running process in background...');
  const longProcess = await sandbox.runCommand({
    cmd: './long_process.sh',
    detached: true,
  });
  
  // Wait a bit to let it start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Send a signal to terminate the process
  console.log('Sending SIGTERM signal to process in background...');
  await longProcess.kill('SIGTERM');
  
  // Wait for the process to complete
  const processResult = await longProcess.wait();
  console.log('Process running in background output:');
  console.log(await processResult.stdout());

  // 9. Working with files and directories
  console.log('File and Directory Operations:');
  
  // Create a directory structure
  await sandbox.runCommand('mkdir', ['-p', 'test/nested/deep']);
  
  // Create some files
  await sandbox.writeFiles([
    {
      path: 'test/file1.txt',
      content: Buffer.from('This is file 1'),
    },
    {
      path: 'test/nested/file2.txt',
      content: Buffer.from('This is file 2 in nested directory'),
    },
  ]);

  // List the directory tree
  const treeResult = await sandbox.runCommand('find', ['test', '-type', 'f']);
  console.log('Created files:');
  console.log(await treeResult.stdout());

  // 10. Check resource usage
  console.log('Resource Usage:');
  
  // Check disk usage
  const dfResult = await sandbox.runCommand('df', ['-h']);
  console.log('Disk usage:');
  console.log(await dfResult.stdout());
  
  // Check memory usage
  const freeResult = await sandbox.runCommand('free', ['-h']);
  console.log('Memory usage:');
  console.log(await freeResult.stdout());

  console.log('Sandbox basics completed!');
  
  // Clean up
  await sandbox.stop();
}

main().catch(console.error); 