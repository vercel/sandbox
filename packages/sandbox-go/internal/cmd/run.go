package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
	vercel "github.com/vercel/go-sdk"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/model"
)

func (a *app) newRun() *cobra.Command {
	var create createOptions
	var exec execOptions
	var removeAfter, stopAfter bool
	command := &cobra.Command{
		Use: "run -- COMMAND [ARGS...]", Short: "Create and run a command in a sandbox", Args: cobra.MinimumNArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			if removeAfter && stopAfter {
				return fmt.Errorf("--rm and --stop are mutually exclusive")
			}
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			var sandbox model.SandboxResponse
			if create.name != "" {
				sandbox, err = client.Get(command.Context(), create.name, true)
				var status *api.StatusError
				var sdkStatus *vercel.APIError
				notFound := errors.As(err, &status) && status.StatusCode == http.StatusNotFound
				notFound = notFound || (errors.As(err, &sdkStatus) && sdkStatus.StatusCode == http.StatusNotFound)
				if err != nil && !notFound {
					return err
				}
			}
			if sandbox.Sandbox.Name == "" {
				body, buildErr := createBody(create)
				if buildErr != nil {
					return buildErr
				}
				if removeAfter {
					body["persistent"] = false
				}
				sandbox, err = client.Create(command.Context(), body)
				if err != nil {
					return err
				}
			}
			defer func() {
				if removeAfter {
					_ = client.Delete(context.WithoutCancel(command.Context()), sandbox.Sandbox.Name)
				} else if stopAfter {
					_, _ = client.Stop(context.WithoutCancel(command.Context()), sandbox.Session.ID)
				}
			}()
			env, err := parsePairs(create.env)
			if err != nil {
				return err
			}
			result, err := client.Run(command.Context(), sandbox.Session.ID, api.RunOptions{Command: args[0], Args: args[1:], CWD: exec.cwd, Env: env, Sudo: exec.sudo, Stdout: a.stdout, Stderr: a.stderr})
			if err != nil {
				return err
			}
			if result.ExitCode != nil && *result.ExitCode != 0 {
				return remoteExitError{code: *result.ExitCode}
			}
			return nil
		},
	}
	addCreateFlags(command, &create, false)
	command.Flags().SetInterspersed(false)
	command.Flags().StringVarP(&exec.cwd, "workdir", "w", "", "Working directory")
	command.Flags().BoolVar(&exec.sudo, "sudo", false, "Run with extended privileges")
	command.Flags().BoolVar(&removeAfter, "rm", false, "Remove sandbox after command exits")
	command.Flags().BoolVar(&stopAfter, "stop", false, "Stop sandbox after command exits")
	return command
}
