package cmd

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/vercel/sandbox/packages/sandbox-go/internal/output"
)

func (a *app) newConfig() *cobra.Command {
	root := &cobra.Command{Use: "config", Short: "View and update sandbox configuration"}
	root.AddCommand(a.configList(), a.configNumber("vcpus", "resources"), a.configDuration("timeout"), a.configBool("persistent"), a.configString("region"), a.configStrings("failover-regions", "failoverRegions"), a.configString("network-id"), a.configStrings("ports", "ports"), a.configTags())
	return root
}
func (a *app) configList() *cobra.Command {
	return &cobra.Command{Use: "list SANDBOX", Short: "Display sandbox configuration", Args: cobra.ExactArgs(1), RunE: func(command *cobra.Command, args []string) error {
		client, err := a.client(command.Context())
		if err != nil {
			return err
		}
		response, err := client.Get(command.Context(), args[0], false)
		if err != nil {
			return err
		}
		s := response.Sandbox
		output.Table(a.stdout, []string{"NAME", "PERSISTENT", "REGION", "VCPUS", "MEMORY", "RUNTIME", "IMAGE", "TIMEOUT", "SNAPSHOT", "TAGS"}, [][]string{{s.Name, strconv.FormatBool(s.Persistent), s.Region, output.Number(s.VCPUs), output.Number(s.Memory), dash(s.Runtime), dash(s.Image), (time.Duration(s.Timeout) * time.Millisecond).String(), dash(s.CurrentSnapshotID), formatTags(s.Tags)}})
		return nil
	}}
}
func (a *app) configNumber(name, field string) *cobra.Command {
	return &cobra.Command{Use: name + " SANDBOX COUNT", Short: "Update sandbox " + name, Args: cobra.ExactArgs(2), RunE: func(command *cobra.Command, args []string) error {
		value, err := strconv.Atoi(args[1])
		if err != nil {
			return err
		}
		body := map[string]any{field: value}
		if field == "resources" {
			body[field] = map[string]int{"vcpus": value}
		}
		return a.updateConfig(command, args[0], name, body)
	}}
}
func (a *app) configDuration(name string) *cobra.Command {
	return &cobra.Command{Use: name + " SANDBOX DURATION", Short: "Update sandbox " + name, Args: cobra.ExactArgs(2), RunE: func(command *cobra.Command, args []string) error {
		value, err := time.ParseDuration(args[1])
		if err != nil {
			return err
		}
		return a.updateConfig(command, args[0], name, map[string]any{name: value.Milliseconds()})
	}}
}
func (a *app) configBool(name string) *cobra.Command {
	return &cobra.Command{Use: name + " SANDBOX true|false", Short: "Update sandbox " + name, Args: cobra.ExactArgs(2), RunE: func(command *cobra.Command, args []string) error {
		value, err := strconv.ParseBool(args[1])
		if err != nil {
			return err
		}
		return a.updateConfig(command, args[0], name, map[string]any{name: value})
	}}
}
func (a *app) configString(name string) *cobra.Command {
	return &cobra.Command{Use: name + " SANDBOX VALUE", Short: "Update sandbox " + name, Args: cobra.ExactArgs(2), RunE: func(command *cobra.Command, args []string) error {
		field := strings.ReplaceAll(name, "-", "Id")
		if name == "region" {
			field = "region"
		}
		var value any = args[1]
		if args[1] == "none" {
			value = nil
		}
		return a.updateConfig(command, args[0], name, map[string]any{field: value})
	}}
}
func (a *app) configStrings(name, field string) *cobra.Command {
	return &cobra.Command{Use: name + " SANDBOX VALUE...", Short: "Update sandbox " + name, Args: cobra.MinimumNArgs(1), RunE: func(command *cobra.Command, args []string) error {
		return a.updateConfig(command, args[0], name, map[string]any{field: args[1:]})
	}}
}
func (a *app) configTags() *cobra.Command {
	var tags []string
	command := &cobra.Command{Use: "tags SANDBOX", Short: "Replace sandbox tags", Args: cobra.ExactArgs(1), RunE: func(command *cobra.Command, args []string) error {
		values, err := parsePairs(tags)
		if err != nil {
			return err
		}
		return a.updateConfig(command, args[0], "tags", map[string]any{"tags": values})
	}}
	command.Flags().StringSliceVarP(&tags, "tag", "t", nil, "Tag KEY=VALUE")
	return command
}
func (a *app) updateConfig(command *cobra.Command, name, label string, body map[string]any) error {
	client, err := a.client(command.Context())
	if err != nil {
		return err
	}
	if _, err := client.Update(command.Context(), name, body); err != nil {
		return err
	}
	fmt.Fprintf(a.stderr, "✔ Configuration updated for sandbox %s.\n   ╰ %s updated\n", name, label)
	return nil
}
func formatTags(tags map[string]string) string {
	if len(tags) == 0 {
		return "-"
	}
	items := []string{}
	for k, v := range tags {
		items = append(items, k+":"+v)
	}
	return strings.Join(items, ", ")
}
