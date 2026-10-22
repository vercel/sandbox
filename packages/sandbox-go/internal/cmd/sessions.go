package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/output"
)

func (a *app) newSessions() *cobra.Command {
	root := &cobra.Command{Use: "sessions", Short: "Manage sandbox sessions"}
	root.AddCommand(a.newSessionsList())
	return root
}

func (a *app) newSessionsList() *cobra.Command {
	var options api.ResourceListOptions
	var all bool
	command := &cobra.Command{
		Use: "list SANDBOX", Aliases: []string{"ls"}, Short: "List sessions from a sandbox", Args: cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			options.Name = args[0]
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			sessions, pagination, err := client.ListSessions(command.Context(), options)
			if err != nil {
				return err
			}
			rows := make([][]string, 0, len(sessions))
			for _, session := range sessions {
				if !all && session.Status != "running" {
					continue
				}
				rows = append(rows, []string{session.ID, session.Status, output.TimeAgo(session.CreatedAt), session.Region, output.Number(session.Memory), output.Number(session.VCPUs), session.Runtime, output.TimeAgo(session.CreatedAt + session.Timeout), fmt.Sprintf("%dms", session.Duration), session.SourceSnapshotID})
			}
			output.Table(a.stdout, []string{"ID", "STATUS", "CREATED", "REGION", "MEMORY", "VCPUS", "RUNTIME", "TIMEOUT", "DURATION", "SNAPSHOT"}, rows)
			if pagination.Next != nil {
				fmt.Fprintf(a.stdout, "More results: --cursor %s\n", *pagination.Next)
			}
			return nil
		},
	}
	command.Flags().BoolVarP(&all, "all", "a", false, "Show stopped sessions too")
	command.Flags().StringVar(&options.SortOrder, "sort-order", "", "Sort asc or desc")
	command.Flags().IntVar(&options.Limit, "limit", 50, "Maximum results")
	command.Flags().StringVar(&options.Cursor, "cursor", "", "Pagination cursor")
	return command
}
