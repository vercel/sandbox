package cmd

import (
	"fmt"
	"sync"

	"github.com/spf13/cobra"
)

func (a *app) newRemove() *cobra.Command {
	var deleteOrphanSnapshots bool
	command := &cobra.Command{
		Use:     "remove SANDBOX [SANDBOX...]",
		Aliases: []string{"rm"},
		Short:   "Permanently remove one or more sandboxes",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(command *cobra.Command, names []string) error {
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			var wait sync.WaitGroup
			results := make(chan error, len(names))
			seen := map[string]bool{}
			for _, name := range names {
				if seen[name] {
					continue
				}
				seen[name] = true
				wait.Add(1)
				go func(name string) {
					defer wait.Done()
					err := client.DeleteWithSnapshots(command.Context(), name, deleteOrphanSnapshots)
					if err == nil {
						fmt.Fprintf(a.stderr, "✔ Removed sandbox %s.\n", name)
					}
					results <- err
				}(name)
			}
			wait.Wait()
			close(results)
			for err := range results {
				if err != nil {
					return err
				}
			}
			return nil
		},
	}
	command.Flags().BoolVar(&deleteOrphanSnapshots, "delete-orphan-snapshots", false, "Also delete snapshots not used by another sandbox")
	return command
}
