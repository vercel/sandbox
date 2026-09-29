package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/config"
)

type app struct {
	flags  config.Flags
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
}

func Execute() int {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	root := NewRoot(os.Stdin, os.Stdout, os.Stderr)
	if err := root.ExecuteContext(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		return exitCode(err)
	}
	return 0
}

func NewRoot(stdin io.Reader, stdout, stderr io.Writer) *cobra.Command {
	a := &app{stdin: stdin, stdout: stdout, stderr: stderr}
	root := &cobra.Command{
		Use:           "sandbox",
		Short:         "Interfacing with Vercel Sandbox",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetIn(stdin)
	root.SetOut(stdout)
	root.SetErr(stderr)
	root.PersistentFlags().StringVar(&a.flags.Token, "token", "", "Vercel authentication token")
	root.PersistentFlags().StringVar(&a.flags.Scope, "scope", "", "Vercel team ID or slug")
	root.PersistentFlags().StringVar(&a.flags.Team, "team", "", "Alias for --scope")
	root.PersistentFlags().StringVar(&a.flags.Project, "project", "", "Vercel project ID or name")
	root.AddCommand(a.newCreate(), a.newShell(), a.newList(), a.newExec(), a.newConnect(), a.newStop(), a.newCopy())
	return root
}

func (a *app) client(ctx context.Context) (*api.Client, error) {
	scope, err := a.flags.Resolve(ctx)
	if err != nil {
		return nil, err
	}
	return api.New(scope)
}

type remoteExitError struct{ code int }

func (e remoteExitError) Error() string {
	return fmt.Sprintf("remote command exited with status %d", e.code)
}
func exitCode(err error) int {
	var remote remoteExitError
	if errors.As(err, &remote) {
		return remote.code
	}
	return 1
}

func parsePairs(values []string) (map[string]string, error) {
	output := make(map[string]string, len(values))
	for _, value := range values {
		key, item, ok := strings.Cut(value, "=")
		if !ok || key == "" {
			return nil, fmt.Errorf("expected KEY=VALUE, got %q", value)
		}
		output[key] = item
	}
	return output, nil
}

func durationMilliseconds(value time.Duration) int64 { return value.Milliseconds() }
