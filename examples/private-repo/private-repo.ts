import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';

async function main() {
  const sandbox = await Sandbox.create({
    source: {
      url: 'https://github.com/vercel/some-private-repo.git',
      type: 'git',
      // For GitHub, you can use a fine grained, classic personal access token or GitHub App installation access token
      username: 'x-access-token',
      password: process.env.GIT_ACCESS_TOKEN!,
    },
    timeout: ms('5m'),
    ports: [3000],
  });

  const ls = await sandbox.runCommand('ls', ['-la']);
  console.log('Repository contents:');
  console.log(await ls.stdout());
  
  await sandbox.stop();
}

main().catch(console.error); 