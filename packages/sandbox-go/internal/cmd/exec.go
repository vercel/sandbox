package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
)

type execOptions struct {
	cwd     string
	env     []string
	sudo    bool
	timeout time.Duration
}

func (a *app) newExec() *cobra.Command {
	var options execOptions
	command := &cobra.Command{
		Use:                "exec SANDBOX COMMAND [ARGS...]",
		Short:              "Execute a command in an existing sandbox",
		Args:               cobra.MinimumNArgs(2),
		DisableFlagParsing: false,
		RunE: func(command *cobra.Command, args []string) error {
			return a.exec(command.Context(), args[0], args[1], args[2:], options)
		},
	}
	command.Flags().StringVarP(&options.cwd, "workdir", "w", "", "Working directory")
	command.Flags().StringSliceVarP(&options.env, "env", "e", nil, "Environment variable KEY=VALUE")
	command.Flags().BoolVar(&options.sudo, "sudo", false, "Run with extended privileges")
	command.Flags().DurationVar(&options.timeout, "timeout", 0, "Command timeout")
	return command
}

func (a *app) exec(ctx context.Context, sandboxName, executable string, args []string, options execOptions) error {
	env, err := parsePairs(options.env)
	if err != nil {
		return err
	}
	client, err := a.client(ctx)
	if err != nil {
		return err
	}
	sandbox, err := client.Get(ctx, sandboxName, true)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stderr, "+ %s %s\n", executable, fmt.Sprint(args))
	result, err := client.Run(ctx, sandbox.Session.ID, api.RunOptions{Command: executable, Args: args, CWD: options.cwd, Env: env, Sudo: options.sudo, Timeout: options.timeout, Stdout: a.stdout, Stderr: a.stderr})
	if err != nil {
		return err
	}
	if result.ExitCode != nil && *result.ExitCode != 0 {
		return remoteExitError{code: *result.ExitCode}
	}
	return nil
}
