package cmd

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

func (a *app) newFork() *cobra.Command {
	var options createOptions
	command := &cobra.Command{
		Use: "fork SOURCE", Short: "Fork an existing sandbox into a new one", Args: cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, args []string) error {
			if options.runtime != "" || options.image != "" || options.snapshot != "" {
				return fmt.Errorf("fork does not accept runtime, image, or snapshot overrides")
			}
			body, err := createBody(options)
			if err != nil {
				return err
			}
			delete(body, "runtime")
			delete(body, "image")
			delete(body, "source")
			client, err := a.client(command.Context())
			if err != nil {
				return err
			}
			source, err := client.Get(command.Context(), args[0], false)
			if err != nil {
				return err
			}
			if source.Sandbox.Status == "running" {
				fmt.Fprintf(a.stderr, "Warning: %s is running; the fork starts from its latest snapshot, not its live filesystem.\n", args[0])
			}
			forked, err := client.Fork(command.Context(), args[0], body)
			if err != nil {
				return err
			}
			if !options.silent {
				fmt.Fprintf(a.stderr, "Sandbox forked from %s.\n   ╰ sandbox: %s  session: %s\n", args[0], forked.Sandbox.Name, forked.Session.ID)
			}
			if options.connect {
				return a.connect(command.Context(), client, forked, connectOptions{})
			}
			return nil
		},
	}
	addForkFlags(command, &options)
	return command
}

func addForkFlags(command *cobra.Command, options *createOptions) {
	flags := command.Flags()
	flags.StringVar(&options.name, "name", "", "Name for the forked sandbox")
	flags.BoolVar(&options.nonPersistent, "non-persistent", false, "Disable filesystem persistence")
	flags.DurationVar(&options.timeout, "timeout", 0, "Override sandbox timeout")
	flags.IntVar(&options.vcpus, "vcpus", 0, "Virtual CPUs")
	flags.IntSliceVarP(&options.ports, "publish", "p", nil, "Ports to publish")
	flags.BoolVar(&options.silent, "silent", false, "Suppress fork summary")
	flags.BoolVar(&options.connect, "connect", false, "Connect after fork")
	flags.StringSliceVarP(&options.env, "env", "e", nil, "Replacement environment variables")
	flags.StringSliceVarP(&options.tags, "tag", "t", nil, "Replacement tags")
	flags.StringVar(&options.region, "region", "", "Sandbox region")
	flags.StringSliceVar(&options.failoverRegions, "failover-region", nil, "Failover regions")
	flags.StringVar(&options.networkID, "network-id", "", "Secure Compute network ID")
	flags.StringVar(&options.networkPolicy, "network-policy", "", "Network policy")
	flags.StringSliceVar(&options.allowedDomains, "allow-domain", nil, "Allowed domain")
	flags.StringSliceVar(&options.allowedCIDRs, "allow-cidr", nil, "Allowed CIDR")
	flags.StringSliceVar(&options.deniedCIDRs, "deny-cidr", nil, "Denied CIDR")
	flags.DurationVar(&options.snapshotExpiry, "snapshot-expiration", 0, "Snapshot expiration")
	flags.IntVar(&options.keepLast, "keep-last-snapshots", 0, "Snapshots to retain")
	flags.DurationVar(&options.keepLastFor, "keep-last-snapshots-for", time.Duration(0), "Retention for kept snapshots")
	flags.BoolVar(&options.deleteEvicted, "delete-evicted-snapshots", false, "Delete evicted snapshots")
}
