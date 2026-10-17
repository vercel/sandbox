package cmd

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/output"
)

func (a *app) newSnapshot() *cobra.Command {
	var stop, silent bool
	var expiration time.Duration
	command := &cobra.Command{
		Use:   "snapshot SANDBOX",
		Short: "Take a snapshot of the filesystem of a sandbox",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			if !stop {
				return fmt.Errorf("snapshotting stops the current session; confirm with --stop")
			}
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			sandbox, err := client.Get(command.Context(), args[0], false)
			if err != nil {
				return err
			}
			if sandbox.Sandbox.Status != "running" {
				return fmt.Errorf("sandbox %s is not available (status: %s)", args[0], sandbox.Sandbox.Status)
			}
			var expires *time.Duration
			if command.Flags().Changed("expiration") {
				expires = &expiration
			}
			snapshot, err := client.Snapshot(command.Context(), sandbox.Session.ID, expires)
			if err != nil {
				return err
			}
			id := snapshot.ID
			if id == "" {
				id = snapshot.SnapshotID
			}
			if !silent {
				fmt.Fprintf(a.stderr, "✔ Snapshot %s created.\n", id)
			}
			return nil
		},
	}
	command.Flags().BoolVar(&stop, "stop", false, "Confirm the sandbox will be stopped")
	command.Flags().BoolVar(&silent, "silent", false, "Suppress snapshot output")
	command.Flags().DurationVar(&expiration, "expiration", 0, "Snapshot expiration; 0 means no expiration")
	return command
}

func (a *app) newSnapshots() *cobra.Command {
	root := &cobra.Command{Use: "snapshots", Short: "Manage sandbox snapshots"}
	root.AddCommand(a.newSnapshotsList(), a.newSnapshotsGet(), a.newSnapshotsDelete())
	return root
}

func (a *app) newSnapshotsList() *cobra.Command {
	var options api.ResourceListOptions
	command := &cobra.Command{
		Use: "list", Aliases: []string{"ls"}, Short: "List snapshots for the specified account and project",
		RunE: func(command *cobra.Command, _ []string) error {
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			snapshots, pagination, err := client.ListSnapshots(command.Context(), options)
			if err != nil {
				return err
			}
			rows := make([][]string, 0, len(snapshots))
			for _, snapshot := range snapshots {
				id := snapshot.ID
				if id == "" {
					id = snapshot.SnapshotID
				}
				regions := snapshot.Region
				if len(snapshot.Regions) > 0 {
					regions = join(snapshot.Regions)
				}
				rows = append(rows, []string{id, snapshot.Status, output.TimeAgo(snapshot.CreatedAt), output.TimeAgo(snapshot.ExpiresAt), output.Bytes(snapshot.SizeBytes), regions, snapshot.SourceSessionID})
			}
			output.Table(a.stdout, []string{"ID", "STATUS", "CREATED", "EXPIRATION", "SIZE", "REGIONS", "SOURCE SESSION"}, rows)
			if pagination.Next != nil {
				fmt.Fprintf(a.stdout, "More results: --cursor %s\n", *pagination.Next)
			}
			return nil
		},
	}
	command.Flags().StringVar(&options.Name, "name", "", "Filter snapshots by sandbox")
	command.Flags().StringVar(&options.SortOrder, "sort-order", "", "Sort asc or desc")
	command.Flags().IntVar(&options.Limit, "limit", 50, "Maximum results")
	command.Flags().StringVar(&options.Cursor, "cursor", "", "Pagination cursor")
	return command
}

func (a *app) newSnapshotsGet() *cobra.Command {
	return &cobra.Command{Use: "get SNAPSHOT", Short: "Get details of a snapshot", Args: cobra.ExactArgs(1), RunE: func(command *cobra.Command, args []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		snapshot, err := client.GetSnapshot(command.Context(), args[0])
		if err != nil {
			return err
		}
		id := snapshot.ID
		if id == "" {
			id = snapshot.SnapshotID
		}
		output.Table(a.stdout, []string{"ID", "STATUS", "CREATED", "EXPIRATION", "SIZE", "SOURCE SESSION"}, [][]string{{id, snapshot.Status, output.TimeAgo(snapshot.CreatedAt), output.TimeAgo(snapshot.ExpiresAt), output.Bytes(snapshot.SizeBytes), snapshot.SourceSessionID}})
		return nil
	}}
}

func (a *app) newSnapshotsDelete() *cobra.Command {
	return &cobra.Command{Use: "delete SNAPSHOT [SNAPSHOT...]", Aliases: []string{"rm", "remove"}, Short: "Delete snapshots", Args: cobra.MinimumNArgs(1), RunE: func(command *cobra.Command, args []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		for _, id := range unique(args) {
			if err := client.DeleteSnapshot(command.Context(), id); err != nil {
				return err
			}
			fmt.Fprintf(a.stderr, "✔ Deleted snapshot %s.\n", id)
		}
		return nil
	}}
}

func join(values []string) string {
	result := ""
	for i, value := range values {
		if i > 0 {
			result += ", "
		}
		result += value
	}
	return result
}
func unique(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}
