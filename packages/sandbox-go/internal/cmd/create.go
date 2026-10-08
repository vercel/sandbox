package cmd

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

type createOptions struct {
	name            string
	runtime         string
	image           string
	timeout         time.Duration
	vcpus           int
	ports           []int
	nonPersistent   bool
	snapshot        string
	connect         bool
	silent          bool
	env             []string
	tags            []string
	region          string
	failoverRegions []string
	networkID       string
	networkPolicy   string
	allowedDomains  []string
	allowedCIDRs    []string
	deniedCIDRs     []string
	snapshotExpiry  time.Duration
	keepLast        int
	keepLastFor     time.Duration
	deleteEvicted   bool
	mounts          []string
}

func (a *app) newCreate() *cobra.Command {
	var options createOptions
	command := &cobra.Command{
		Use:   "create [NAME]",
		Short: "Create a sandbox in the specified account and project",
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
				if !options.connect {
					fmt.Fprintf(a.stderr, "Connect with: sandbox connect %s\n", response.Sandbox.Name)
				}
			}
			if options.connect {
				return a.connect(command.Context(), client, response, connectOptions{})
			}
			return nil
		},
	}
	addCreateFlags(command, &options, true)
	return command
}

func createBody(options createOptions) (map[string]any, error) {
	env, err := parsePairs(options.env)
	if err != nil {
		return nil, err
	}
	tags, err := parsePairs(options.tags)
	if err != nil {
		return nil, err
	}
	mounts, err := parseMounts(options.mounts)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"persistent": !options.nonPersistent,
	}
	if options.timeout > 0 {
		body["timeout"] = durationMilliseconds(options.timeout)
	}
	if len(env) > 0 {
		body["env"] = env
	}
	if len(tags) > 0 {
		body["tags"] = tags
	}
	if len(options.ports) > 0 {
		body["ports"] = options.ports
	}
	if options.region != "" {
		body["region"] = options.region
	}
	if len(options.failoverRegions) > 0 {
		body["failoverRegions"] = options.failoverRegions
	}
	if options.networkID != "" {
		body["networkId"] = options.networkID
	}
	if len(mounts) > 0 {
		body["mounts"] = mounts
	}
	if options.name != "" {
		body["name"] = options.name
	}
	if options.runtime != "" {
		body["runtime"] = options.runtime
	}
	if options.image != "" {
		body["image"] = options.image
	}
	if options.vcpus > 0 {
		body["resources"] = map[string]any{"vcpus": options.vcpus}
	}
	if options.snapshot != "" {
		body["source"] = map[string]any{"type": "snapshot", "snapshotId": options.snapshot}
	}
	if options.snapshotExpiry > 0 {
		body["snapshotExpiration"] = durationMilliseconds(options.snapshotExpiry)
	}
	if options.keepLast > 0 {
		retention := map[string]any{"count": options.keepLast, "deleteEvicted": options.deleteEvicted}
		if options.keepLastFor > 0 {
			retention["expiration"] = durationMilliseconds(options.keepLastFor)
		}
		body["keepLastSnapshots"] = retention
	}
	policy, err := networkPolicy(options)
	if err != nil {
		return nil, err
	}
	if policy != nil {
		body["networkPolicy"] = policy
	}
	return body, nil
}

func networkPolicy(options createOptions) (map[string]any, error) {
	mode := options.networkPolicy
	if mode == "" && (len(options.allowedDomains)+len(options.allowedCIDRs)+len(options.deniedCIDRs) > 0) {
		mode = "custom"
	}
	if mode == "" {
		return nil, nil
	}
	if mode != "allow-all" && mode != "deny-all" && mode != "custom" {
		return nil, fmt.Errorf("invalid network policy %q", mode)
	}
	return map[string]any{"mode": mode, "allowedDomains": options.allowedDomains, "allowedCIDRs": options.allowedCIDRs, "deniedCIDRs": options.deniedCIDRs}, nil
}

func parseMounts(values []string) (map[string]any, error) {
	output := map[string]any{}
	for _, value := range values {
		parts := strings.Split(value, ":")
		if len(parts) < 2 || len(parts) > 3 || parts[0] == "" || parts[1] == "" {
			return nil, fmt.Errorf("invalid mount %q", value)
		}
		mode := "read-write"
		if len(parts) == 3 {
			mode = parts[2]
		}
		output[parts[1]] = map[string]string{"drive": parts[0], "mode": mode}
	}
	return output, nil
}
