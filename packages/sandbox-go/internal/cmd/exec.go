package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
)

type execOptions struct {
	cwd             string
	env             []string
	sudo            bool
	timeout         time.Duration
	interactive     bool
	noExtendTimeout bool
}

func (a *app) newExec() *cobra.Command {
	var options execOptions
	command := &cobra.Command{
		Use:                "exec SANDBOX COMMAND [ARGS...]",
		Short:              "Execute a command in an existing sandbox",
		Args:               cobra.MinimumNArgs(2),
		DisableFlagParsing: false,
		RunE: func(command *cobra.Command, args []string) error {
			if options.interactive && options.timeout > 0 {
				return fmt.Errorf("--timeout cannot be combined with --interactive")
			}
			if options.interactive {
				client, err := a.client(command.Context())
				if err != nil {
					return err
				}
				sandbox, err := client.Get(command.Context(), args[0], true)
				if err != nil {
					return err
				}
				return a.connect(command.Context(), client, sandbox, connectOptions{cwd: options.cwd, env: options.env, sudo: options.sudo, noExtendTimeout: options.noExtendTimeout, command: args[1], args: args[2:]})
			}
			return a.exec(command.Context(), args[0], args[1], args[2:], options)
		},
	}
	command.Flags().SetInterspersed(false)
	command.Flags().StringVarP(&options.cwd, "workdir", "w", "", "Working directory")
	command.Flags().StringSliceVarP(&options.env, "env", "e", nil, "Environment variable KEY=VALUE")
	command.Flags().BoolVar(&options.sudo, "sudo", false, "Run with extended privileges")
	command.Flags().BoolVarP(&options.interactive, "interactive", "i", false, "Run command in an interactive shell")
	command.Flags().BoolP("tty", "t", false, "Allocate a TTY for an interactive command")
	command.Flags().BoolVar(&options.noExtendTimeout, "no-extend-timeout", false, "Do not extend timeout during interactive execution")
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
