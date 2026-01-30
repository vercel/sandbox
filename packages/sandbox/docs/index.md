## `sandbox --help`

```
sandbox <subcommand>
> Interfacing with Vercel Sandbox

where <subcommand> can be one of:

- list - List all sandboxes for the specified account and project. [alias: ls]
- create - Create a sandbox in the specified account and project.
- config - Update a sandbox configuration
- copy - Copy files between your local filesystem and a remote sandbox [alias: cp]
- exec - Execute a command in an existing sandbox
- connect - Start an interactive shell in an existing sandbox [aliases: ssh, shell]
- stop - Stop one or more running sandboxes [aliases: rm, remove]
- run - Create and run a command in a sandbox
- snapshot - Take a snapshot of the filesystem of a sandbox
- snapshots - Manage sandbox snapshots
- login - Log in to the Sandbox CLI
- logout - Log out of the Sandbox CLI

For more help, try running `sandbox <subcommand> --help`
```

## `sandbox list`

```
sandbox list
> List all sandboxes for the specified account and project.

OPTIONS:
  --token <pat_or_oidc>  - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project> - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>      - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

FLAGS:
  --all, -a  - Show all sandboxes (default shows just running) [optional]
  --help, -h - show help [optional]
```

## `sandbox run`

```
sandbox run
> Create and run a command in a sandbox

OPTIONS:
  --token <pat_or_oidc>             - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project>            - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>                 - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
  --runtime <runtime>               - One of 'node22', 'node24', 'python3.13' [default: node24]
  --timeout <num UNIT>              - The maximum duration a sandbox can run for. Example: 5m, 1h [default: 5 minutes]
  --publish-port <PORT>, -p=<PORT>  - Publish sandbox port(s) to DOMAIN.vercel.run
  --snapshot, -s <snapshot_id>      - Start the sandbox from a snapshot ID [optional]
  --network-policy <MODE>           - Network policy mode: "internet-access", "no-access", or "restricted"
    
internet-access: sandbox can access any website/domain
no-access: sandbox has no network access
restricted: sandbox can only access websites and domains explicitly allowed [optional]
  --allowed-domain <str>            - Domain to allow traffic to (requires --network-policy=restricted)

Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com')
If used as the first segment, will match any subdomain.
  --allowed-cidr <str>              - CIDR to allow traffic to (requires --network-policy=restricted)

Takes precedence over 'allowed-domain'.

  --denied-cidr <str>               - CIDR to deny traffic to (requires --network-policy=restricted)
    
Takes precedence over allowed domains/CIDRs.
  --workdir, -w <str>               - The working directory to run the command in [optional]
  --env <key=value>, -e=<key=value> - Environment variables to set for the command

FLAGS:
  --silent            - Don't write sandbox ID to stdout [optional]
  --connect           - Start an interactive shell session after creating the sandbox [optional]
  --sudo              - Give extended privileges to the command. [optional]
  --interactive, -i   - Run the command in a secure interactive shell [optional]
  --no-extend-timeout - Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions. [optional]
  --tty, -t           - Allocate a tty for an interactive command. This is a no-op. [optional]
  --rm                - Automatically remove the sandbox when the command exits. [optional]
  --help, -h          - show help [optional]

ARGUMENTS:
  <command> - The executable to invoke
  [...args] - arguments to pass to the command
```

## `sandbox create`

```
sandbox create
> Create a sandbox in the specified account and project.

OPTIONS:
  --token <pat_or_oidc>            - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project>           - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>                - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
  --runtime <runtime>              - One of 'node22', 'node24', 'python3.13' [default: node24]
  --timeout <num UNIT>             - The maximum duration a sandbox can run for. Example: 5m, 1h [default: 5 minutes]
  --publish-port <PORT>, -p=<PORT> - Publish sandbox port(s) to DOMAIN.vercel.run
  --snapshot, -s <snapshot_id>     - Start the sandbox from a snapshot ID [optional]
  --network-policy <MODE>          - Network policy mode: "internet-access", "no-access", or "restricted"
    
internet-access: sandbox can access any website/domain
no-access: sandbox has no network access
restricted: sandbox can only access websites and domains explicitly allowed [optional]
  --allowed-domain <str>           - Domain to allow traffic to (requires --network-policy=restricted)

Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com')
If used as the first segment, will match any subdomain.
  --allowed-cidr <str>             - CIDR to allow traffic to (requires --network-policy=restricted)

Takes precedence over 'allowed-domain'.

  --denied-cidr <str>              - CIDR to deny traffic to (requires --network-policy=restricted)
    
Takes precedence over allowed domains/CIDRs.

FLAGS:
  --silent   - Don't write sandbox ID to stdout [optional]
  --connect  - Start an interactive shell session after creating the sandbox [optional]
  --help, -h - show help [optional]
```

## `sandbox exec`

```
sandbox exec
> Execute a command in an existing sandbox

OPTIONS:
  --token <pat_or_oidc>             - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project>            - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>                 - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
  --workdir, -w <str>               - The working directory to run the command in [optional]
  --env <key=value>, -e=<key=value> - Environment variables to set for the command

ARGUMENTS:
  <sandbox_id> - The ID of the sandbox to execute the command in
  <command>    - The executable to invoke
  [...args]    - arguments to pass to the command

FLAGS:
  --sudo              - Give extended privileges to the command. [optional]
  --interactive, -i   - Run the command in a secure interactive shell [optional]
  --no-extend-timeout - Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions. [optional]
  --tty, -t           - Allocate a tty for an interactive command. This is a no-op. [optional]
  --help, -h          - show help [optional]
```

## `sandbox stop`

```
sandbox stop
> Stop one or more running sandboxes

OPTIONS:
  --token <pat_or_oidc>  - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project> - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>      - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

ARGUMENTS:
  <sandbox_id>    - a sandbox ID to stop
  [...sandbox_id] - more sandboxes to stop

FLAGS:
  --help, -h - show help [optional]
```

## `sandbox copy`

```
sandbox copy
> Copy files between your local filesystem and a remote sandbox

OPTIONS:
  --token <pat_or_oidc>  - A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
  --project <my-project> - The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
  --scope <my-team>      - The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

ARGUMENTS:
  <SANDBOX_ID:PATH> - The source file to copy from local file system, or or a sandbox_id:path from a remote sandbox
  <SANDBOX_ID:PATH> - The destination file to copy to local file system, or or a sandbox_id:path to a remote sandbox

FLAGS:
  --help, -h - show help [optional]
```

## `sandbox login`

```
sandbox login
> Log in to the Sandbox CLI

FLAGS:
  --help, -h - show help [optional]
```

## `sandbox logout`

```
sandbox logout
> Log out of the Sandbox CLI

FLAGS:
  --help, -h - show help [optional]
```
