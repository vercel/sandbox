import { Sandbox } from '@vercel/sandbox';
import { setTimeout } from 'timers/promises';
import { spawn } from 'child_process';

async function main() {

  console.log('Creating sandbox from Git repository...');
  const sandbox = await Sandbox.create({
    source: {
      url: 'https://github.com/vercel/sandbox-example-next.git',
      type: 'git',
    },
    timeout: 300000,
    ports: [3000],
  });

  console.log('Installing dependencies...');
  const install = await sandbox.runCommand({
    cmd: 'npm',
    args: ['install', '--loglevel', 'info'],
    stderr: process.stderr,
    stdout: process.stdout,
  });

  console.log('Dependencies installed successfully!\n');

  console.log('Starting the development server...');
  const devServer = await sandbox.runCommand({
    cmd: 'npm',
    args: ['run', 'dev'],
    stderr: process.stderr,
    stdout: process.stdout,
    detached: true,
  });

  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await sandbox.stop();
    process.exit(0);
    });

  console.log(`   URL: ${sandbox.domain(3000)}`);
  console.log('Waiting for server to start...');
  await setTimeout(1000);
  spawn('open', [sandbox.domain(3000)]);
}

main().catch(console.error); 