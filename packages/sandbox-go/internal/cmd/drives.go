package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/output"
)

func (a *app) newDrives() *cobra.Command {
	root := &cobra.Command{Use: "drives", Short: "Manage sandbox drives"}
	root.AddCommand(a.newDrivesList(), a.newDriveGetOrCreate(), a.newDriveDelete())
	return root
}

func (a *app) newDrivesList() *cobra.Command {
	var options api.ListOptions
	command := &cobra.Command{Use: "list", Aliases: []string{"ls"}, Short: "List drives", RunE: func(command *cobra.Command, _ []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		drives, pagination, err := client.ListDrives(command.Context(), options)
		if err != nil {
			return err
		}
		rows := make([][]string, 0, len(drives))
		for _, drive := range drives {
			size := drive.MaxSizeBytes
			if size == 0 {
				size = drive.MaxSize
			}
			rows = append(rows, []string{drive.Name, drive.Region, output.TimeAgo(drive.CreatedAt), output.TimeAgo(drive.UpdatedAt), output.Bytes(size), dash(drive.CurrentSandboxName), dash(drive.CurrentSessionID)})
		}
		output.Table(a.stdout, []string{"NAME", "REGION", "CREATED", "UPDATED", "SIZE", "ATTACHED SANDBOX", "ATTACHED SESSION"}, rows)
		if pagination.Next != nil {
			fmt.Fprintf(a.stdout, "More results: --cursor %s\n", *pagination.Next)
		}
		return nil
	}}
	command.Flags().StringVar(&options.NamePrefix, "name-prefix", "", "Filter by name prefix")
	command.Flags().StringVar(&options.SortOrder, "sort-order", "", "Sort order")
	command.Flags().IntVar(&options.Limit, "limit", 50, "Maximum results")
	command.Flags().StringVar(&options.Cursor, "cursor", "", "Pagination cursor")
	return command
}

func (a *app) newDriveGetOrCreate() *cobra.Command {
	var maxSize int64
	var region string
	command := &cobra.Command{Use: "get-or-create NAME", Short: "Create a drive if needed, or retrieve it", Args: cobra.ExactArgs(1), RunE: func(command *cobra.Command, args []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		body := map[string]any{}
		if maxSize > 0 {
			body["maxSizeBytes"] = maxSize
		}
		if region != "" {
			body["region"] = region
		}
		drive, err := client.GetOrCreateDrive(command.Context(), args[0], body)
		if err != nil {
			return err
		}
		size := drive.MaxSizeBytes
		if size == 0 {
			size = drive.MaxSize
		}
		fmt.Fprintf(a.stderr, "✔ Drive %s ready.\n   │ region: %s\n   ╰ max size: %s\n", drive.Name, drive.Region, output.Bytes(size))
		return nil
	}}
	command.Flags().Int64Var(&maxSize, "max-size", 0, "Maximum drive size in bytes")
	command.Flags().StringVar(&region, "region", "", "Drive region")
	return command
}

func (a *app) newDriveDelete() *cobra.Command {
	return &cobra.Command{Use: "delete NAME [NAME...]", Aliases: []string{"rm", "remove"}, Short: "Delete drives", Args: cobra.MinimumNArgs(1), RunE: func(command *cobra.Command, args []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		drives, _, err := client.ListDrives(command.Context(), api.ListOptions{Limit: 50})
		if err != nil {
			return err
		}
		for _, name := range unique(args) {
			for _, drive := range drives {
				if drive.Name == name && (drive.CurrentSandboxName != "" || drive.CurrentSessionID != "") {
					return fmt.Errorf("drive %s is attached to a sandbox", name)
				}
			}
			if err := client.DeleteDrive(command.Context(), name); err != nil {
				return err
			}
			fmt.Fprintf(a.stderr, "✔ Deleted drive %s.\n", name)
		}
		return nil
	}}
}
func dash(value string) string {
	if value == "" {
		return "-"
	}
	return value
}
