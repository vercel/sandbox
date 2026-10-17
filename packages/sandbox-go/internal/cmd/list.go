package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/api"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/output"
)

func (a *app) newList() *cobra.Command {
	var all bool
	var options api.ListOptions
	var tags []string
	command := &cobra.Command{
		Use:     "list",
		Aliases: []string{"ls"},
		Short:   "List sandboxes for the specified account and project",
		RunE: func(command *cobra.Command, _ []string) error {
			if options.NamePrefix != "" && options.SortBy != "" && options.SortBy != "name" {
				return fmt.Errorf("--sort-by must be name with --name-prefix")
			}
			if options.NamePrefix != "" {
				options.SortBy = "name"
			}
			for _, tag := range tags {
				key, value, ok := strings.Cut(tag, "=")
				if !ok {
					return fmt.Errorf("expected tag KEY=VALUE, got %q", tag)
				}
				options.Tags = append(options.Tags, key+":"+value)
			}
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			response, err := client.List(command.Context(), options)
			if err != nil {
				return err
			}
			rows := make([][]string, 0, len(response.Sandboxes))
			for _, sandbox := range response.Sandboxes {
				if !all && sandbox.Status != "running" {
					continue
				}
				image := sandbox.Image
				if image == "" {
					image = sandbox.Runtime
				}
				rows = append(rows, []string{sandbox.Name, sandbox.Status, output.TimeAgo(sandbox.CreatedAt), sandbox.Region, output.Number(sandbox.Memory), output.Number(sandbox.VCPUs), image, output.TimeAgo(sandbox.ExpiresAt)})
			}
			output.Table(a.stdout, []string{"NAME", "STATUS", "CREATED", "REGION", "MEMORY", "VCPUS", "IMAGE/RUNTIME", "TIMEOUT"}, rows)
			if response.Pagination.Next != nil {
				fmt.Fprintf(a.stdout, "More results: --cursor %s\n", *response.Pagination.Next)
			}
			return nil
		},
	}
	command.Flags().BoolVarP(&all, "all", "a", false, "Show stopped sandboxes too")
	command.Flags().StringVar(&options.NamePrefix, "name-prefix", "", "Filter by name prefix")
	command.Flags().StringVar(&options.SortBy, "sort-by", "", "Sort by createdAt, name, or statusUpdatedAt")
	command.Flags().StringVar(&options.SortOrder, "sort-order", "", "Sort asc or desc")
	command.Flags().StringSliceVar(&tags, "tag", nil, "Filter tag KEY=VALUE")
	command.Flags().IntVar(&options.Limit, "limit", 50, "Maximum results per page")
	command.Flags().StringVar(&options.Cursor, "cursor", "", "Pagination cursor")
	return command
}
