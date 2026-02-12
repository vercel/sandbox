## `sandbox --help`

```
sandbox 2.3.0

▲ sandbox [options] <command>

For command help, run `sandbox <command> --help`

Commands:

    ls | list                                        List all sandboxes for the specified account and project.
    create                                           Create a sandbox in the specified account and project.
    config                                           Update a sandbox configuration
    cp | copy      <src> <dst>                       Copy files between your local filesystem and a remote sandbox
    exec           <sandbox_id> <command> [...args]  Execute a command in an existing sandbox
    ssh | connect  <sandbox_id>                      Start an interactive shell in an existing sandbox
    rm | stop      <sandbox_id> [...sandbox_id]      Stop one or more running sandboxes
    run            <command> [...args]               Create and run a command in a sandbox
    snapshot       <sandbox_id>                      Take a snapshot of the filesystem of a sandbox
    snapshots                                        Manage sandbox snapshots
    login                                            Log in to the Sandbox CLI
    logout                                           Log out of the Sandbox CLI

Examples:

– Create a sandbox and start a shell

  $ sandbox create --connect

– Run a command in a new sandbox

  $ sandbox run -- node -e "console.log('hello')"

– Execute command in an existing sandbox

  $ sandbox exec <sandbox-id> -- npm test
```

## `sandbox list`

```
list

▲ sandbox list [options]

List all sandboxes for the specified account and project.

Flags:

    --all, -a   Show all sandboxes (default shows just running) [optional]
    --help, -h  show help [optional]

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
```

## `sandbox run`

```
run

▲ sandbox run [options]

Create and run a command in a sandbox

Options:

    --runtime <runtime>                One of 'node22', 'node24', 'python3.13' [default: node24]
    --timeout <num UNIT>               The maximum duration a sandbox can run for. Example: 5m, 1h [default: 5 minutes]
    --publish-port <PORT>, -p=<PORT>   Publish sandbox port(s) to DOMAIN.vercel.run
    --snapshot, -s <snapshot_id>       Start the sandbox from a snapshot ID [optional]
    --network-policy <MODE>            Network policy mode: "allow-all" or "deny-all"
      - allow-all: sandbox can access any website/domain
      - deny-all: sandbox has no network access
    Omit this option and use --allowed-domain / --allowed-cidr / --denied-cidr for custom policies. [optional]
    --allowed-domain <str>             Domain to allow traffic to (creates a custom network policy). Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com'). If used as the first segment, will match any subdomain.
    --allowed-cidr <str>               CIDR to allow traffic to (creates a custom network policy). Takes precedence over 'allowed-domain'.
    --denied-cidr <str>                CIDR to deny traffic to (creates a custom network policy). Takes precedence over allowed domains/CIDRs.
    --workdir, -w <str>                The working directory to run the command in [optional]
    --env <key=value>, -e=<key=value>  Environment variables to set for the command

Flags:

    --silent             Don't write sandbox ID to stdout [optional]
    --connect            Start an interactive shell session after creating the sandbox [optional]
    --sudo               Give extended privileges to the command. [optional]
    --interactive, -i    Run the command in a secure interactive shell [optional]
    --no-extend-timeout  Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions. [optional]
    --tty, -t            Allocate a tty for an interactive command. This is a no-op. [optional]
    --rm                 Automatically remove the sandbox when the command exits. [optional]
    --help, -h           show help [optional]

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

Arguments:

    <command>  The executable to invoke
    [...args]  arguments to pass to the command
```

## `sandbox create`

```
create

▲ sandbox create [options]

Create a sandbox in the specified account and project.

Options:

    --runtime <runtime>               One of 'node22', 'node24', 'python3.13' [default: node24]
    --timeout <num UNIT>              The maximum duration a sandbox can run for. Example: 5m, 1h [default: 5 minutes]
    --publish-port <PORT>, -p=<PORT>  Publish sandbox port(s) to DOMAIN.vercel.run
    --snapshot, -s <snapshot_id>      Start the sandbox from a snapshot ID [optional]
    --network-policy <MODE>           Network policy mode: "allow-all" or "deny-all"
      - allow-all: sandbox can access any website/domain
      - deny-all: sandbox has no network access
    Omit this option and use --allowed-domain / --allowed-cidr / --denied-cidr for custom policies. [optional]
    --allowed-domain <str>            Domain to allow traffic to (creates a custom network policy). Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com'). If used as the first segment, will match any subdomain.
    --allowed-cidr <str>              CIDR to allow traffic to (creates a custom network policy). Takes precedence over 'allowed-domain'.
    --denied-cidr <str>               CIDR to deny traffic to (creates a custom network policy). Takes precedence over allowed domains/CIDRs.

Flags:

    --silent    Don't write sandbox ID to stdout [optional]
    --connect   Start an interactive shell session after creating the sandbox [optional]
    --help, -h  show help [optional]

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

Examples:

– Create and connect to a sandbox without a network access

  $ sandbox run --network-policy=none --connect
```

## `sandbox exec`

```
exec

▲ sandbox exec [options]

Execute a command in an existing sandbox

Arguments:

    <sandbox_id>  The ID of the sandbox to execute the command in
    <command>     The executable to invoke
    [...args]     arguments to pass to the command

Flags:

    --sudo               Give extended privileges to the command. [optional]
    --interactive, -i    Run the command in a secure interactive shell [optional]
    --no-extend-timeout  Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions. [optional]
    --tty, -t            Allocate a tty for an interactive command. This is a no-op. [optional]
    --help, -h           show help [optional]

Options:

    --workdir, -w <str>                The working directory to run the command in [optional]
    --env <key=value>, -e=<key=value>  Environment variables to set for the command

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
```

## `sandbox stop`

```
stop

▲ sandbox stop [options]

Stop one or more running sandboxes

Arguments:

    <sandbox_id>     a sandbox ID to stop
    [...sandbox_id]  more sandboxes to stop

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

Flags:

    --help, -h  show help [optional]
```

## `sandbox copy`

```
copy

▲ sandbox copy [options]

Copy files between your local filesystem and a remote sandbox

Arguments:

    <src>  The source file to copy from local file system, or or a sandbox_id:path from a remote sandbox
    <dst>  The destination file to copy to local file system, or or a sandbox_id:path to a remote sandbox

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

Flags:

    --help, -h  show help [optional]
```

## `sandbox connect`

```
connect

▲ sandbox connect [options]

Start an interactive shell in an existing sandbox

Arguments:

    <sandbox_id>  The ID of the sandbox to execute the command in

Flags:

    --sudo               Give extended privileges to the command. [optional]
    --no-extend-timeout  Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions. [optional]
    --help, -h           show help [optional]

Options:

    --workdir, -w <str>                The working directory to run the command in [optional]
    --env <key=value>, -e=<key=value>  Environment variables to set for the command

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
```

## `sandbox snapshot`

```
snapshot

▲ sandbox snapshot [options]

Take a snapshot of the filesystem of a sandbox

Flags:

    --stop      Confirm that the sandbox will be stopped when snapshotting [optional]
    --silent    Don't write snapshot ID to stdout [optional]
    --help, -h  show help [optional]

Arguments:

    <sandbox_id>  The ID of the sandbox to execute the command in

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]
```

## `sandbox snapshots`

```
sandbox snapshots

▲ sandbox snapshots [options] <command>

For command help, run `sandbox snapshots <command> --help`

Commands:

    ls | list                                    List snapshots for the specified account and project.
    rm | delete  <snapshot_id> [...snapshot_id]  Delete one or more snapshots.
```

## `sandbox config network-policy`

```
network-policy

▲ sandbox config network-policy [options]

Update the network policy of a sandbox.
  This will fully override the previous configuration.

Arguments:

    <sandbox_id>  The ID of the sandbox to execute the command in

Options:

    --network-policy <MODE>  Network policy mode: "allow-all" or "deny-all"
      - allow-all: sandbox can access any website/domain
      - deny-all: sandbox has no network access
    Omit this option and use --allowed-domain / --allowed-cidr / --denied-cidr for custom policies. [optional]
    --allowed-domain <str>   Domain to allow traffic to (creates a custom network policy). Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com'). If used as the first segment, will match any subdomain.
    --allowed-cidr <str>     CIDR to allow traffic to (creates a custom network policy). Takes precedence over 'allowed-domain'.
    --denied-cidr <str>      CIDR to deny traffic to (creates a custom network policy). Takes precedence over allowed domains/CIDRs.
    --mode <MODE>            Alias for --network-policy. [optional]

Auth & Scope:

    --token <pat_or_oidc>   A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process. [optional]
    --project <my-project>  The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [optional]
    --scope <my-team>       The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team] [optional]

Flags:

    --help, -h  show help [optional]
```

## `sandbox login`

```
login

▲ sandbox login [options]

Log in to the Sandbox CLI

Flags:

    --help, -h  show help [optional]
```

## `sandbox logout`

```
logout

▲ sandbox logout [options]

Log out of the Sandbox CLI

Flags:

    --help, -h  show help [optional]
```
