package cmd

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

func (a *app) newShell() *cobra.Command {
	var options createOptions
	var removeAfterUse bool
	command := &cobra.Command{
		Use:   "sh [NAME]",
		Short: "Create a sandbox and start an interactive shell",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			if len(args) == 1 {
				if options.name != "" && options.name != args[0] {
					return fmt.Errorf("sandbox name provided twice; use either NAME or --name")
				}
				options.name = args[0]
			}
			if options.runtime != "" && options.image != "" {
				return fmt.Errorf("--runtime and --image cannot be used together")
			}
			body, err := createBody(options)
			if err != nil {
				return err
			}
			if removeAfterUse {
				body["persistent"] = false
			}
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			response, err := client.Create(command.Context(), body)
			if err != nil {
				return err
			}
			if !options.silent {
				fmt.Fprintf(a.stderr, "Sandbox created.\n   ╰ sandbox: %s  session: %s  region: %s\n", response.Sandbox.Name, response.Session.ID, response.Sandbox.Region)
			}
			if removeAfterUse {
				defer func() {
					if err := client.Delete(command.Context(), response.Sandbox.Name); err != nil {
						fmt.Fprintf(a.stderr, "Warning: failed to remove sandbox %s: %v\n", response.Sandbox.Name, err)
					}
				}()
			}
			return a.connect(command.Context(), client, response, connectOptions{})
		},
	}
	addCreateFlags(command, &options, false)
	command.Flags().BoolVar(&removeAfterUse, "rm", false, "Remove the sandbox when the shell exits")
	return command
}

func addCreateFlags(command *cobra.Command, options *createOptions, includeConnect bool) {
	flags := command.Flags()
	flags.StringVar(&options.name, "name", "", "User-chosen sandbox name")
	flags.StringVar(&options.runtime, "runtime", "", "Sandbox runtime")
	flags.StringVar(&options.image, "image", "", "VCR image name")
	flags.DurationVar(&options.timeout, "timeout", 5*time.Minute, "Sandbox timeout")
	flags.IntVar(&options.vcpus, "vcpus", 0, "Virtual CPUs")
	flags.IntSliceVarP(&options.ports, "publish", "p", nil, "Ports to publish")
	flags.BoolVar(&options.nonPersistent, "non-persistent", false, "Disable filesystem persistence")
	flags.StringVarP(&options.snapshot, "snapshot", "s", "", "Source snapshot ID")
	if includeConnect {
		flags.BoolVar(&options.connect, "connect", false, "Connect after creation")
	}
	flags.BoolVar(&options.silent, "silent", false, "Suppress creation summary")
	flags.StringSliceVarP(&options.env, "env", "e", nil, "Environment variable KEY=VALUE")
	flags.StringSliceVarP(&options.tags, "tag", "t", nil, "Tag KEY=VALUE")
	flags.StringVar(&options.region, "region", "", "Sandbox region")
	flags.StringSliceVar(&options.failoverRegions, "failover-region", nil, "Failover regions")
	flags.StringVar(&options.networkID, "network-id", "", "Secure Compute network ID")
	flags.StringVar(&options.networkPolicy, "network-policy", "", "Network policy: allow-all, deny-all, or custom")
	flags.StringSliceVar(&options.allowedDomains, "allow-domain", nil, "Allowed domain")
	flags.StringSliceVar(&options.allowedCIDRs, "allow-cidr", nil, "Allowed CIDR")
	flags.StringSliceVar(&options.deniedCIDRs, "deny-cidr", nil, "Denied CIDR")
	flags.DurationVar(&options.snapshotExpiry, "snapshot-expiration", 0, "Snapshot expiration")
	flags.IntVar(&options.keepLast, "keep-last-snapshots", 0, "Snapshots to retain")
	flags.DurationVar(&options.keepLastFor, "keep-last-snapshots-for", 0, "Retention for kept snapshots")
	flags.BoolVar(&options.deleteEvicted, "delete-evicted-snapshots", false, "Delete evicted snapshots")
	flags.StringSliceVar(&options.mounts, "mount", nil, "Drive mount DRIVE:PATH[:MODE]")
}
