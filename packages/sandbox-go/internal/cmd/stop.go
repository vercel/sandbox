package cmd

import (
	"fmt"
	"sync"

	"github.com/spf13/cobra"
)

func (a *app) newStop() *cobra.Command {
	return &cobra.Command{
		Use:   "stop SANDBOX [SANDBOX...]",
		Short: "Stop the current session of one or more sandboxes",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(command *cobra.Command, names []string) error {
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			type result struct {
				name    string
				session string
				err     error
			}
			results := make(chan result, len(names))
			var wait sync.WaitGroup
			semaphore := make(chan struct{}, 4)
			seen := map[string]bool{}
			for _, name := range names {
				if seen[name] {
					continue
				}
				seen[name] = true
				wait.Add(1)
				go func(name string) {
					defer wait.Done()
					semaphore <- struct{}{}
					defer func() { <-semaphore }()
					sandbox, err := client.Get(command.Context(), name, false)
					if err == nil {
						_, err = client.Stop(command.Context(), sandbox.Session.ID)
					}
					results <- result{name: name, session: sandbox.Session.ID, err: err}
				}(name)
			}
			wait.Wait()
			close(results)
			failed := false
			for result := range results {
				if result.err != nil {
					failed = true
					fmt.Fprintf(a.stderr, "✖ %s: %v\n", result.name, result.err)
				} else {
					fmt.Fprintf(a.stderr, "✔ Sandbox stopped.\n   ╰ sandbox: %s  session: %s\n", result.name, result.session)
				}
			}
			if failed {
				return fmt.Errorf("one or more sandboxes could not be stopped")
			}
			return nil
		},
	}
}
